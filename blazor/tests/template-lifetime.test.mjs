import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TemplateLifetime } from '../src/wwwroot/template-lifetime.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function fixture(overrides = {}) {
  const state = { connected: true, creates: 0, updates: 0, closes: 0, clears: 0, errors: [] };
  const root = { dispose: async () => { state.closes++; } };
  const lifetime = new TemplateLifetime({ connected: () => state.connected, create: async () => { state.creates++; return root; }, update: async () => { state.updates++; }, clear: () => { state.clears++; }, report: error => state.errors.push(error), ...overrides });
  return { state, root, lifetime };
}
test('consecutive parameter changes coalesce and preserve the native root', async () => {
  const { state, lifetime } = fixture();
  await Promise.all(Array.from({length:100}, (_,i) => lifetime.schedule(i)));
  assert.equal(state.creates,1); assert.equal(state.updates,0);
  await Promise.all([lifetime.schedule(101),lifetime.schedule(102)]);
  assert.equal(state.updates,1); assert.equal(lifetime.applied,102); await lifetime.dispose();
});
test('dispose before first render prevents creating a dynamic root', async () => {
  const { state,lifetime }=fixture(); const queued=lifetime.schedule(1); await lifetime.dispose(); await queued;
  assert.equal(state.creates,0); assert.equal(state.closes,0); assert.ok(state.clears>0);
});
test('removal during asynchronous creation awaits the late root and its disposal', async () => {
  const barrier=deferred(), cleanup=deferred(); let closed=0;
  const { lifetime }=fixture({create:() => barrier.promise});
  const mounted=lifetime.schedule(1); await Promise.resolve(); await Promise.resolve();
  const first=lifetime.dispose(), second=lifetime.dispose(); assert.equal(first,second);
  let done=false; first.then(() => done=true); await Promise.resolve(); assert.equal(done,false);
  barrier.resolve({dispose:async()=>{closed++; await cleanup.promise;}});
  await new Promise(r=>setTimeout(r,0)); assert.equal(done,false); cleanup.resolve();
  await Promise.all([first,second,mounted]); assert.equal(closed,1);
});
test('a temporary disconnect releases resources and reconnection creates a new root', async () => {
  const {state,lifetime}=fixture(); await lifetime.schedule(1); state.connected=false; await lifetime.schedule();
  assert.equal(state.closes,1); state.connected=true; await lifetime.schedule(2);
  assert.equal(state.creates,2); await lifetime.dispose(); assert.equal(state.closes,2);
});
test('same-turn DOM movement retains the existing root', async () => {
  const {state,lifetime}=fixture(); await lifetime.schedule(1); state.connected=false; const move=lifetime.schedule(); state.connected=true;
  await move; assert.equal(state.creates,1); assert.equal(state.closes,0); await lifetime.dispose();
});
test('failed native cleanup remains a failure for repeated disposal and still clears context', async () => {
  const {state,root,lifetime}=fixture(); root.dispose=async()=>{state.closes++; throw Error('cleanup failed');};
  await lifetime.schedule(1); await assert.rejects(lifetime.dispose(),/cleanup failed/);
  await assert.rejects(lifetime.dispose(),/cleanup failed/); assert.equal(state.closes,1); assert.equal(state.clears,1);
});
test('failed creation clears its context and permits an explicit retry', async () => {
  let count=0; const {state,lifetime}=fixture({create:async()=>{if(count++===0)throw Error('load failed'); return {dispose(){}};}});
  await assert.rejects(lifetime.schedule(1),/load failed/); assert.equal(state.clears,1);
  await lifetime.schedule(2); assert.equal(count,2); await lifetime.dispose();
});
test('updates stop after disposal and retain its completion task', async () => {
  const {state,lifetime}=fixture(); await lifetime.schedule(1); const closing=lifetime.dispose(); await closing;
  assert.equal(lifetime.schedule(2),closing); assert.equal(state.updates,0); assert.equal(state.closes,1);
});
