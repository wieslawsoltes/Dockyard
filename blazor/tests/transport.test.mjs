import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/wwwroot/interop.js';
import { stream, deliver, jsonText } from '../src/wwwroot/transport.js';
let released = 0;
globalThis.DotNet = { createJSStreamReference: blob => ({ blob }), disposeJSObjectReference: () => released++ };
const read = async reference => JSON.parse(await reference.blob.text());
test('JSON streams preserve all Unicode and large values without snapshots', async () => {
  const value = { name: 'Zażółć 🙂'.repeat(100000), items: Array.from({ length: 10000 }, (_, i) => ({ i })) };
  assert.deepEqual(await read(stream(value)), value);
  assert.throws(() => stream('🙂', 'json', 3), /limit/);
});
test('binary views stream only their slice and explicit limits fail', async () => {
  const data = Uint8Array.of(1, 2, 3, 4);
  assert.deepEqual([...new Uint8Array(await stream(data.subarray(1, 3), 'bytes').blob.arrayBuffer())], [2, 3]);
  assert.throws(() => stream(data, 'bytes', 3), /limit/);
});
test('notifications choose small messages or owned streams; failed dispatch releases its stream', async () => {
  const received = [];
  const receiver = { invokeMethodAsync: async (method, payload) => received.push([method, method === 'DispatchStream' ? await read(payload) : payload]) };
  await deliver(receiver, jsonText(3)); await deliver(receiver, jsonText('x'.repeat(50000)));
  assert.equal(received[0][0], 'Dispatch'); assert.equal(received[1][0], 'DispatchStream'); assert.equal(received[1][1].length, 50000);
  await assert.rejects(deliver({ invokeMethodAsync: () => Promise.reject(Error('closed')) }, jsonText('x'.repeat(5000))), /closed/);
  assert.equal(released, 1);
});
test('transfer calls preserve this, batch order, and reject unsafe members', async () => {
  const target = { value: 2, Add(n) { return this.value += n; } }, session = new Session({ target });
  assert.equal(await read(await session.transfer('call', target, 'Add', [3], 'json', 1000)), 5);
  assert.deepEqual(await read(await session.transfer('batch', null, '', [[{ target, method: 'Add', arguments: [2] }, { target, method: 'Add', arguments: [4] }]], 'json', 1000)), [7, 11]);
  await assert.rejects(session.transfer('call', target, '__proto__.x', []), /Invalid/);
  await assert.rejects(session.transfer('unknown', target, '', []), /Unknown/);
  await session.dispose(); await assert.rejects(session.transfer('get', target, 'value'), /disposed/);
});
test('native asynchronous disposal is awaited and invoked only once', async () => {
  let closed = 0;
  class Native { async DisposeAsync() { await new Promise(resolve => setTimeout(resolve, 2)); closed++; } Dispose() { throw Error('Use the async fence.'); } }
  const session = new Session({ Native }); const value = await session.construct('Native');
  await session.release(value); assert.equal(closed, 1); await session.dispose(); assert.equal(closed, 1);
});
