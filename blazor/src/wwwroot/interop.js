const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function locationOf(target, path) {
  const parts = String(path).split('.');
  if (parts.some(p => !p || forbidden.has(p))) throw new TypeError(`Invalid member path: ${path}`);
  const key = parts.pop();
  for (const part of parts) {
    if (target == null) throw new TypeError(`Missing member: ${path}`);
    target = target[part];
  }
  if (target == null) throw new TypeError(`Missing member: ${path}`);
  return [target, key];
}
function member(target, path) { const [owner, key] = locationOf(target, path); return owner[key]; }
function baseUrl(url) { return new URL(url, globalThis.document?.baseURI ?? import.meta.url).href; }
async function resolve(value) {
  if (!value || typeof value !== 'object') return value;
  if (Object.hasOwn(value, '$fn')) {
    if (value.$fn === 'property') return item => member(item, value.path);
    if (value.$fn === 'constant') return () => value.value;
    if (value.$fn === 'setter') return (item, next) => { const [owner, key] = locationOf(item, value.path); owner[key] = next; };
    if (value.$fn === 'dotnet') return (...args) => value.receiver.invokeMethodAsync(value.method, ...args);
    if (value.$fn === 'module') {
      const fn = member(await import(baseUrl(value.url)), value.name);
      if (typeof fn !== 'function') throw new TypeError(`Not a function: ${value.name}`);
      return fn;
    }
    throw new TypeError(`Unknown callback kind: ${value.$fn}`);
  }
  if (Array.isArray(value)) {
    const items = await Promise.all(value.map(resolve));
    return items.some((v, i) => v !== value[i]) ? items : value;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const entries = await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await resolve(v)]));
  return entries.some(([k, v]) => value[k] !== v) ? Object.fromEntries(entries) : value;
}
/** Bounded value snapshot, not a serializer for arbitrary live engine/model graphs. */
export function snapshot(value, seen = new WeakSet(), depth = 0, budget = { nodes: 50000, chars: 1048576, native: new WeakSet() }) {
  if (--budget.nodes < 0 || budget.chars <= 0) return { $truncated: true };
  if (value == null || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'string' || typeof value === 'bigint') {
    const text = String(value), result = text.slice(0, Math.max(0, budget.chars)); budget.chars -= result.length + 4; return result;
  }
  if (typeof value === 'number') { budget.chars -= 24; return Number.isFinite(value) ? value : null; }
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (depth > 12 || seen.has(value)) return null;
  if (value instanceof Error) return { name: value.name?.slice(0, 256), message: value.message?.slice(0, 8192), stack: value.stack?.slice(0, 8192) };
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof Node !== 'undefined' && value instanceof Node) return { nodeName: value.nodeName, id: value.id ?? null };
  if (value instanceof DataView) value = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const sequence = Array.isArray(value) || value instanceof Set || ArrayBuffer.isView(value);
  const native = !sequence && !(value instanceof Map) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null;
  if (native && budget.native.has(value)) {
    const result = { $reference: true };
    for (const key of ['Id', 'id', 'ContentId', 'Title']) { try { if (typeof value[key] === 'string') result[key] = value[key].slice(0, 256); } catch { } }
    return result;
  }
  if (native) budget.native.add(value);
  seen.add(value);
  const child = item => snapshot(item, seen, depth + 1, budget);
  let result;
  if (value instanceof Map || sequence) {
    result = [];
    for (const item of value) {
      if (budget.nodes <= 0 || budget.chars <= 0) { result.push({ $truncated: true }); break; }
      result.push(value instanceof Map ? [child(item[0]), child(item[1])] : child(item));
    }
  } else {
    result = {};
    const keys = Object.keys(value).filter(key => !forbidden.has(key) && (!native || !key.startsWith('_')));
    if (native) for (const key of ['Id', 'id', 'ContentId', 'Title', 'Count', 'PropertyName']) if (!keys.includes(key) && key in value) keys.push(key);
    for (const key of keys) {
      if (budget.nodes <= 0 || budget.chars <= 0) { result.$truncated = true; break; }
      budget.chars -= key.length + 4;
      try { const item = child(value[key]); if (item !== undefined) result[key] = item; } catch { }
    }
  }
  seen.delete(value);
  return result;
}
function disposeNative(value) {
  for (const name of ['Dispose', 'dispose', 'unsubscribe', 'delete']) {
    if (typeof value?.[name] === 'function') return value[name]();
  }
}
export class Session {
  constructor(entry) { this.entry = entry; this.api = entry.api ?? entry; this.owned = new Set(); this.released = new WeakSet(); this.subscriptions = new Set(); this.disposed = false; }
  check() { if (this.disposed) throw new Error('The Blazor session has been disposed.'); }
  exports() { this.check(); return Object.keys(this.api).sort(); }
  async construct(name, args = []) {
    this.check(); const Type = member(this.api, name);
    if (typeof Type !== 'function') throw new TypeError(`Not a constructor: ${name}`);
    const result = Reflect.construct(Type, await resolve(args));
    if (this.disposed) { await disposeNative(result); throw new Error('The Blazor session has been disposed.'); }
    this.owned.add(result); return result;
  }
  async invoke(name, args = []) { this.check(); return this.call(this.api, name, args); }
  async call(target, path, args = []) {
    this.check(); const [owner, key] = locationOf(target, path);
    if (typeof owner[key] !== 'function') throw new TypeError(`Not callable: ${path}`);
    const resolved = await resolve(args); this.check();
    return Reflect.apply(owner[key], owner, resolved);
  }
  get(target, path) { this.check(); return member(target ?? this.api, path); }
  async set(target, path, value) {
    this.check(); const [owner, key] = locationOf(target, path); const resolved = await resolve(value); this.check(); owner[key] = resolved;
  }
  async mount(host, options) {
    this.check();
    if (typeof this.entry.mount !== 'function') throw new TypeError('This package does not expose a visual control. Use the engine service.');
    const result = await this.entry.mount(host, await resolve(options ?? {}));
    if (this.disposed) { await disposeNative(result); throw new Error('The Blazor session has been disposed.'); }
    this.owned.add(result);
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        if (!host.isConnected) { observer.disconnect(); void this.release(result).catch(console.error); }
      });
      observer.observe(host.ownerDocument, { childList: true, subtree: true });
      const watcher = { target: result, dispose: () => { observer.disconnect(); this.subscriptions.delete(watcher); } };
      this.subscriptions.add(watcher);
    }
    return result;
  }
  async update(target, options) { this.check(); const values = await resolve(options ?? {}); this.check(); if (this.entry.update) await this.entry.update(target, values); else for (const [k, v] of Object.entries(values)) await this.set(target, k, v); }
  async subscribe(target, path, receiver) {
    this.check(); let active = true, pending = Promise.resolve();
    const send = (...args) => {
      const value = snapshot(args.length > 1 ? args[args.length - 1] : args[0]);
      pending = pending.then(() => active && !this.disposed ? receiver.invokeMethodAsync('Dispatch', value) : undefined).catch(error => console.error('Blazor event callback failed', error));
    };
    let stop;
    if (path.startsWith('dom:')) {
      const name = path.slice(4), handler = event => send(event.detail ?? { type: event.type });
      target.addEventListener(name, handler); stop = () => target.removeEventListener(name, handler);
    } else {
      const signal = path ? member(target, path) : target;
      // Prefer disposable subscription contracts. Some add() APIs return the listener, not an unsubscriber.
      if (typeof signal?.subscribe === 'function') {
        const token = signal.subscribe(send, error => send({ error: snapshot(error) }), () => send({ completed: true }));
        stop = typeof token === 'function' ? token : () => disposeNative(token);
      } else if (typeof signal?.Subscribe === 'function') {
        const token = signal.Subscribe(send); stop = typeof token === 'function' ? token : () => disposeNative(token);
      } else if (typeof signal?.add === 'function' || typeof signal?.Add === 'function') {
        const add = signal.add ?? signal.Add, remove = signal.remove ?? signal.Remove;
        const token = add.call(signal, send);
        if (token === send) {
          if (typeof remove !== 'function') throw new TypeError(`Event ${path} returned its listener but does not provide removal.`);
          stop = () => remove.call(signal, send);
        } else if (typeof token === 'function') stop = token;
        else if (token) stop = () => disposeNative(token);
        else if (typeof remove === 'function') stop = () => remove.call(signal, send);
        else throw new TypeError(`Event ${path} does not provide a disposable subscription.`);
      } else throw new TypeError(`Not an event or observable: ${path}`);
    }
    const subscription = { target, dispose: () => { if (!active) return; active = false; try { stop(); } finally { this.subscriptions.delete(subscription); } } };
    this.subscriptions.add(subscription); return subscription;
  }
  async release(value) {
    this.owned.delete(value);
    for (const sub of [...this.subscriptions]) if (sub.target === value) sub.dispose();
    if (value && (typeof value === 'object' || typeof value === 'function') && !this.released.has(value)) { this.released.add(value); await disposeNative(value); }
  }
  async dispose() {
    if (this.disposed) return; this.disposed = true;
    const errors = [];
    for (const sub of [...this.subscriptions]) { try { await sub.dispose(); } catch (e) { errors.push(e); } }
    this.subscriptions.clear();
    for (const item of [...this.owned].reverse()) { try { await this.release(item); } catch (e) { errors.push(e); } }
    if (errors.length) throw new AggregateError(errors, 'One or more browser resources failed to dispose.');
  }
}
export async function open(url) { return new Session(await import(baseUrl(url))); }
