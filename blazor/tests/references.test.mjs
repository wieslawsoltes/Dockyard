import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/wwwroot/interop.js';
test('native function handles can be invoked, passed recursively, and released', async () => {
  const session = new Session({ make: n => value => value + n, apply: (fn, value) => fn(value), Echo: x => x });
  const handle = await session.invokeReference('make', [3]);
  assert.equal(typeof handle, 'object');
  assert.equal(await session.callFunction(handle, [4]), 7);
  assert.equal(await session.invoke('apply', [handle, 5]), 8);
  const echo = await session.getReference(null, 'Echo');
  const literal = { $fn: 'module', url: './must-not-load.js' };
  assert.equal(await session.callFunction(echo, [{ $literal: literal }]), literal);
  await session.release(handle); await session.dispose();
  await assert.rejects(session.callFunction(echo, [0]), /disposed/);
});
