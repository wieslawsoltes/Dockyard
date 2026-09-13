import './event-protocols.test.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, snapshot } from '../src/wwwroot/interop.js';
class Signal { listeners = new Set(); add(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); } emit(value) { for (const fn of this.listeners) fn(this, value); } }
class Model { constructor(value = 0, key = x => x.id) { this.value = value; this.key = key; this.Changed = new Signal(); this.disposals = 0; } add(n) { this.value += n; return this.value; } Dispose() { this.disposals++; } }
const receiver = values => ({ invokeMethodAsync: async (name, value) => { assert.equal(name, 'Dispatch'); values.push(value); } });
const tick = () => new Promise(r => setTimeout(r, 0));
test('all exports, nested constructors and instance this binding remain accessible', async () => {
  const s = new Session({ api: { Model, Nested: { Model }, sum: (a, b) => a + b } });
  assert.deepEqual(s.exports(), ['Model', 'Nested', 'sum']);
  const m = await s.construct('Nested.Model', [4]);
  assert.equal(await s.call(m, 'add', [3]), 7); await s.set(m, 'value', 10);
  assert.equal(s.get(m, 'value'), 10); assert.equal(await s.invoke('sum', [1, 2]), 3);
  await s.dispose(); assert.equal(m.disposals, 1); assert.throws(() => s.get(m, 'value'), /disposed/);
});
test('reference identity survives recursively resolved arguments', async () => {
  const s = new Session({ api: { identity: v => v } }); const item = { id: 3, nested: { n: 4 } };
  assert.equal(await s.invoke('identity', [item]), item);
  const m = await new Session({ api: { Model } }).construct('Model', [item, { $fn: 'property', path: 'nested.n' }]);
  assert.equal(m.value, item); assert.equal(m.key(item), 4);
});
test('module, property, setter, constant and async .NET callbacks require no eval', async () => {
  const s = new Session({ api: { apply: (fn, ...args) => fn(...args) } }); const item = { id: 1 };
  await s.invoke('apply', [{ $fn: 'setter', path: 'id' }, item, 9]); assert.equal(item.id, 9);
  assert.equal(await s.invoke('apply', [{ $fn: 'constant', value: 2 }]), 2);
  assert.equal(await s.invoke('apply', [{ $fn: 'module', url: new URL('./functions.mjs', import.meta.url).href, name: 'double' }, 4]), 8);
  assert.equal(await s.invoke('apply', [{ $fn: 'dotnet', receiver: { invokeMethodAsync: (name, x) => Promise.resolve(`${name}:${x}`) }, method: 'Run' }, 5]), 'Run:5');
  await assert.rejects(s.invoke('apply', [{ $fn: 'unknown' }]), /Unknown callback/);
});
test('event ordering, unsubscribing and session ownership are deterministic', async () => {
  const s = new Session({ api: { Model } }); const m = await s.construct('Model'); const values = [];
  const sub = await s.subscribe(m, 'Changed', receiver(values)); m.Changed.emit({ n: 1 }); m.Changed.emit({ n: 2 }); await tick();
  assert.deepEqual(values, [{ n: 1 }, { n: 2 }]); sub.dispose(); sub.dispose(); m.Changed.emit({ n: 3 }); await tick(); assert.equal(values.length, 2);
  await s.release(m); await s.release(m); await s.dispose(); assert.equal(m.disposals, 1);
});
test('queued notifications are suppressed after disposal', async () => {
  const s = new Session({ api: { Model } }); const m = await s.construct('Model'); const values = [];
  const sub = await s.subscribe(m, 'Changed', receiver(values)); m.Changed.emit(1); sub.dispose(); await tick(); assert.deepEqual(values, []);
});
test('observable next, error and complete are forwarded and unsubscribed', async () => {
  let observers, disposed = 0; const observable = { subscribe(next, error, complete) { observers = { next, error, complete }; return { unsubscribe() { disposed++; } }; } };
  const s = new Session({}); const values = []; await s.subscribe(observable, '', receiver(values));
  observers.next(4); observers.error(new Error('expected')); observers.complete(); await tick();
  assert.equal(values[0], 4); assert.equal(values[1].error.message, 'expected'); assert.deepEqual(values[2], { completed: true });
  await s.dispose(); assert.equal(disposed, 1);
});
test('DOM event subscriptions forward detail and detach', async () => {
  const s = new Session({}); const target = new EventTarget(); const values = [];
  const sub = await s.subscribe(target, 'dom:change', receiver(values)); target.dispatchEvent(new CustomEvent('change', { detail: { text: 'hello' } })); await tick(); assert.deepEqual(values, [{ text: 'hello' }]);
  sub.dispose(); target.dispatchEvent(new Event('change')); await tick(); assert.equal(values.length, 1);
});
test('session release removes listeners and disposes explicitly returned native resources', async () => {
  const s = new Session({}); const model = new Model(); await s.subscribe(model, 'Changed', receiver([]));
  await s.release(model); assert.equal(model.disposals, 1); assert.equal(model.Changed.listeners.size, 0); await s.release(model); assert.equal(model.disposals, 1);
});
test('late asynchronous mount is cleaned up when its owner is disposed', async () => {
  let complete; const model = new Model(); const s = new Session({ mount: () => new Promise(r => complete = r) });
  const pending = s.mount({}, {}); await tick(); await s.dispose(); complete(model); await assert.rejects(pending, /disposed/); assert.equal(model.disposals, 1);
});
test('snapshot handles cycles, maps, typed arrays and errors without losing sibling values', () => {
  const value = { n: 1 }; value.self = value; assert.deepEqual(snapshot(value), { n: 1, self: null });
  assert.deepEqual(snapshot(new Map([['a', 2]])), [['a', 2]]); assert.deepEqual(snapshot(new Uint8Array([1, 2])), [1, 2]);
  assert.deepEqual(snapshot([value, value]), [{ n: 1, self: null }, { n: 1, self: null }]);
});
test('unsafe prototype paths and non-callable exports fail explicitly', async () => {
  const s = new Session({ api: { value: 1 } }); await assert.rejects(s.set({}, '__proto__.polluted', true), /Invalid member/);
  assert.throws(() => s.get({}, 'constructor'), /Invalid member/); await assert.rejects(s.invoke('value'), /Not callable/);
  await assert.rejects(s.construct('missing'), /Not a constructor/); assert.equal({}.polluted, undefined);
});
test('dispose cleans remaining resources even when one native cleanup fails', async () => {
  class Failing { Dispose() { throw new Error('cleanup'); } }
  const s = new Session({ api: { Failing, Model } }); const m = await s.construct('Model'); await s.construct('Failing');
  await assert.rejects(s.dispose(), AggregateError); assert.equal(m.disposals, 1); await s.dispose();
});
test('shared acyclic graphs have bounded serialization cost', () => {
  let value = { n: 1 }; for (let i = 0; i < 20; i++) value = { a: value, b: value, c: value };
  const text = JSON.stringify(snapshot(value)); assert.ok(text.length < 2000000); assert.ok(text.includes('$truncated'));
});
test('native backing graphs are omitted and repeated native identity is compact', () => {
  class Native { Id = 'native-1'; _parent = this; _children = [this, this]; get Title() { return 'Title'; } }
  const value = new Native(); const result = snapshot({ one: value, two: value });
  assert.deepEqual(result.one, { Id: 'native-1', Title: 'Title' }); assert.equal(result.two.$reference, true);
  assert.ok(JSON.stringify(result).length < 256);
});
test('DataView and invalid Date notifications are JSON-safe', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]); assert.deepEqual(snapshot(new DataView(bytes.buffer, 1, 2)), [2, 3]); assert.equal(snapshot(new Date(NaN)), null);
});
