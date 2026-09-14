import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/wwwroot/interop.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('add returning the original listener uses remove, never invokes the callback as cleanup', async () => {
  const listeners = new Set(), values = [];
  const signal = { add(fn) { listeners.add(fn); return fn; }, remove(fn) { listeners.delete(fn); } };
  const session = new Session({});
  const subscription = await session.subscribe(signal, '', { invokeMethodAsync: async (_, value) => values.push(value) });
  for (const fn of listeners) fn(7);
  await tick(); assert.deepEqual(values, [7]);
  subscription.dispose(); await tick();
  assert.equal(listeners.size, 0); assert.deepEqual(values, [7]); await session.dispose();
});
test('a disposable subscribe contract takes precedence over an ambiguous add return value', async () => {
  let subscriptions = 0, removals = 0;
  const signal = { add() { throw new Error('Do not use the lower-level add contract.'); }, subscribe(fn) { subscriptions++; fn(4); return { unsubscribe() { removals++; } }; } };
  const session = new Session({}); const values = [];
  await session.subscribe(signal, '', { invokeMethodAsync: async (_, value) => values.push(value) });
  await tick(); assert.equal(subscriptions, 1); assert.deepEqual(values, [4]);
  await session.dispose(); assert.equal(removals, 1);
});
