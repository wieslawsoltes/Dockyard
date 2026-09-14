import { unwrap, install } from './references.js';
import { stream, jsonText, deliver } from './transport.js';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function locationOf(target, path) {
  target = unwrap(target);
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
async function callback(value) {
  if (value.$fn === 'razor') return (await import('./templates.js')).createFactory(value);
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
/** Resolve configuration graphs without mutating native data, breaking aliases, or recursing through cycles. */
async function resolve(input) {
  const records = new Map(), work = [], callbacks = new Map();
  const container = value => value !== null && typeof value === 'object' &&
    (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
  const record = value => {
    if (!records.has(value)) {
      const item = { value, output: value, entries: [], parents: new Set(), changed: false };
      records.set(value, item); work.push(item);
    }
    return records.get(value);
  };
  const root = record({ value: input });
  for (let index = 0; index < work.length; index++) {
    const item = work[index];
    for (const [key, original] of Object.entries(item.value)) {
      let value = unwrap(original), child = null, literal = value !== original;
      if (value && typeof value === 'object' && Object.hasOwn(value, '$literal')) {
        value = value.$literal; literal = true;
      } else if (value && typeof value === 'object' && Object.hasOwn(value, '$fn')) {
        if (!callbacks.has(value)) callbacks.set(value, callback(value));
        value = await callbacks.get(value); literal = true;
      }
      if (!literal && container(value)) { child = record(value); child.parents.add(item); }
      item.entries.push({ key, value, child });
      if (value !== original) item.changed = true;
    }
  }
  // Only paths leading to a transformed descriptor need copies. Unchanged native
  // graphs keep their original identity, even when they contain cycles or aliases.
  const changed = work.filter(item => item.changed);
  for (let index = 0; index < changed.length; index++) {
    for (const parent of changed[index].parents) if (!parent.changed) {
      parent.changed = true; changed.push(parent);
    }
  }
  for (const item of changed) item.output = Array.isArray(item.value) ? new Array(item.value.length) : {};
  for (const item of changed) for (const { key, value, child } of item.entries)
    Object.defineProperty(item.output, key, { value: child ? child.output : value, writable: true, enumerable: true, configurable: true });
  return root.output.value;
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
  for (const name of ['DisposeAsync', 'Dispose', 'dispose', 'unsubscribe', 'delete']) {
    if (typeof value?.[name] === 'function') return value[name]();
  }
}
export class Session {
  constructor(entry) { this.entry = entry; this.api = entry.api ?? entry; this.owned = new Set(); this.released = new WeakMap(); this.pendingReleases = new Set(); this.disposal = null; this.subscriptions = new Set(); this.disposed = false; }
  check() { if (this.disposed) throw new Error('The Blazor session has been disposed.'); }
  exports() { this.check(); return Object.keys(this.api).sort(); }
  async construct(name, args = []) {
    this.check(); const Type = member(this.api, name);
    if (typeof Type !== 'function') throw new TypeError(`Not a constructor: ${name}`);
    const values = await resolve(args); this.check();
    const result = Reflect.construct(Type, values);
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
    const values = await resolve(options ?? {}); this.check();
    const result = await this.entry.mount(host, values);
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
  async update(target, options) { target = unwrap(target); this.check(); const values = await resolve(options ?? {}); this.check(); if (this.entry.update) await this.entry.update(target, values); else for (const [k, v] of Object.entries(values)) await this.set(target, k, v); }
  async transfer(operation, target, path, args = [], format = 'json', limit) {
    this.check();
    let result;
    if (operation === 'call') result = await this.call(target, path, args);
    else if (operation === 'invoke') result = await this.invoke(path, args);
    else if (operation === 'get') result = this.get(target, path);
    else if (operation === 'function') result = await this.callFunction(target, args);
    else if (operation === 'batch') {
      result = [];
      for (const call of args[0]) result.push(await this.call(call.target, call.method, call.arguments ?? []));
    } else throw new TypeError(`Unknown transfer operation: ${operation}`);
    this.check(); return stream(result, format, limit);
  }
  subscribeJson(target, path, receiver) { return this.subscribe(target, path, receiver, true); }
  async subscribe(target, path, receiver, json = false) {
    this.check(); target = unwrap(target); let active = true, pending = Promise.resolve();
    const send = (...args) => {
      if (!active || this.disposed) return;
      const item = args.length > 1 ? args[args.length - 1] : args[0];
      let text;
      try { text = jsonText(json ? item : snapshot(item)); }
      catch (error) { text = jsonText({ error: snapshot(error) }); }
      pending = pending.then(() => active && !this.disposed ? deliver(receiver, text) : undefined).catch(error => { if (active && !this.disposed) console.error('Blazor event callback failed', error); });
    };
    let stop;
    if (path.startsWith('dom:')) {
      const name = path.slice(4), handler = event => send(event.detail ?? { type: event.type });
      target.addEventListener(name, handler); stop = () => target.removeEventListener(name, handler);
    } else {
      const signal = path ? member(target, path) : target;
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
    let disposal;
    const subscription = { target, dispose: () => {
      if (disposal) return disposal;
      active = false; this.subscriptions.delete(subscription);
      try { disposal = Promise.resolve(stop()); } catch (error) { disposal = Promise.reject(error); }
      return disposal;
    } };
    this.subscriptions.add(subscription); return subscription;
  }
  release(value) {
    value = unwrap(value);
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return Promise.resolve();
    const previous = this.released.get(value);
    if (previous) return previous;
    this.owned.delete(value);
    const task = Promise.resolve().then(async () => {
      const errors = [];
      for (const sub of [...this.subscriptions]) if (sub.target === value) {
        try { await sub.dispose(); } catch (error) { errors.push(error); }
      }
      try { await disposeNative(value); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Browser resource cleanup failed.');
    });
    this.released.set(value, task); this.pendingReleases.add(task);
    task.then(() => this.pendingReleases.delete(task), () => this.pendingReleases.delete(task));
    return task;
  }
  dispose() {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    const inFlight = [...this.pendingReleases];
    this.disposal = Promise.resolve().then(async () => {
      const errors = new Set();
      for (const sub of [...this.subscriptions]) { try { await sub.dispose(); } catch (error) { errors.add(error); } }
      this.subscriptions.clear();
      for (const item of [...this.owned].reverse()) { try { await this.release(item); } catch (error) { errors.add(error); } }
      for (const task of inFlight) { try { await task; } catch (error) { errors.add(error); } }
      if (errors.size) throw new AggregateError([...errors], 'One or more browser resources failed to dispose.');
    });
    return this.disposal;
  }
}
install(Session);
export async function open(url) { return new Session(await import(baseUrl(url))); }
