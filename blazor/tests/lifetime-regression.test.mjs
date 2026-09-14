import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/wwwroot/interop.js';
const delay = () => new Promise(resolve => setTimeout(resolve, 5));
test('concurrent native releases share the asynchronous disposal fence', async () => {
  let disposed = false, calls = 0;
  const native = { async DisposeAsync() { calls++; await delay(); disposed = true; } };
  const session = new Session({});
  const first = session.release(native);
  await session.release(native);
  assert.equal(disposed, true);
  await first; assert.equal(calls, 1);
});
test('session disposal awaits asynchronous subscription cleanup', async () => {
  let stopped = false;
  const source = { subscribe() { return { async DisposeAsync() { await delay(); stopped = true; } }; } };
  const session = new Session({});
  await session.subscribe(source, '', { invokeMethodAsync() {} });
  await session.dispose();
  assert.equal(stopped, true);
});
test('native function handles expose properties, methods and native disposal', async () => {
  let disposed = false;
  const fn = Object.assign(value => value, { count: 2, Read() { return this.count; }, Dispose() { disposed = true; } });
  const session = new Session({ make: () => fn });
  const handle = await session.invokeReference('make');
  assert.equal(session.get(handle, 'count'), 2);
  await session.set(handle, 'count', 4);
  assert.equal(await session.call(handle, 'Read'), 4);
  await session.release(handle); assert.equal(disposed, true);
});
test('disposal during argument resolution does not invoke a late constructor or mount', async () => {
  let constructions = 0, mounts = 0;
  const session = new Session({ T: class { constructor() { constructions++; } }, mount() { mounts++; return {}; } });
  const constructed = session.construct('T'); const mounted = session.mount({}, {});
  await session.dispose();
  await assert.rejects(constructed, /disposed/); await assert.rejects(mounted, /disposed/);
  assert.equal(constructions, 0); assert.equal(mounts, 0);
});
test('callback-containing argument graphs preserve shared aliases', async () => {
  const shared = { callback: { $fn: 'constant', value: 3 } };
  const session = new Session({ inspect: value => value.left === value.right && value.left.callback() === 3 });
  assert.equal(await session.invoke('inspect', [{ left: shared, right: shared }]), true);
});
test('cyclic and very deep plain native references retain identity without stack recursion', async () => {
  const value = { id: 1 }; value.self = value; value.children = [value];
  const session = new Session({ identity: value => value });
  assert.equal(await session.invoke('identity', [value]), value);
  let deep = { end: true }; for (let i = 0; i < 20000; i++) deep = { next: deep };
  assert.equal(await session.invoke('identity', [deep]), deep);
});
test('transformed cyclic configurations preserve aliases without mutating their input', async () => {
  const value = { callback: { $fn: 'constant', value: 7 } }; value.self = value;
  const session = new Session({ identity: value => value });
  const result = await session.invoke('identity', [value]);
  assert.notEqual(result, value); assert.equal(result.self, result);
  assert.equal(result.callback(), 7); assert.equal(value.callback.$fn, 'constant');
});
test('concurrent session disposal also awaits an already-running native release', async () => {
  let done = false;
  const native = { async DisposeAsync() { await delay(); done = true; } };
  const session = new Session({});
  const released = session.release(native); const first = session.dispose();
  await session.dispose(); assert.equal(done, true); await first; await released;
});
test('a failed asynchronous unsubscribe does not skip other listeners or native teardown', async () => {
  let detached = false, disposed = false;
  const value = {
    first: { subscribe() { return { async DisposeAsync() { throw Error('unsubscribe'); } }; } },
    second: { subscribe() { return { Dispose() { detached = true; } }; } },
    Dispose() { disposed = true; }
  };
  const session = new Session({}); const receiver = { invokeMethodAsync() {} };
  await session.subscribe(value, 'first', receiver); await session.subscribe(value, 'second', receiver);
  await assert.rejects(session.release(value), AggregateError);
  assert.equal(detached, true); assert.equal(disposed, true); assert.equal(session.subscriptions.size, 0);
});
test('callable results support complete streamed JSON values', async () => {
  const session = new Session({ make: () => value => value });
  const fn = await session.invokeReference('make'); const text = 'Unicode 🙂'.repeat(20000);
  const blob = await session.transfer('function', fn, '', [text], 'json');
  assert.equal(JSON.parse(await blob.text()), text);
});
