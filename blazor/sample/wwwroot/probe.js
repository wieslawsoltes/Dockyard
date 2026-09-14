/** Actual-package integration fixtures; not part of the component package. */
export class Probe {
  constructor() {
    this.value = null; this.handlers = new Set();
    this.Changed = { subscribe: handler => { this.handlers.add(handler); return () => this.handlers.delete(handler); } };
  }
  Set(value) { this.value = value; for (const handler of this.handlers) handler(value); }
  Echo(value) { return value; }
  Bytes() { return Uint8Array.from({ length: 100000 }, (_, i) => i % 251); }
  Dispose() { this.handlers.clear(); }
}
export function MountTemplate(host, factory) {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const left = document.createElement('div'), right = document.createElement('div');
  root.append(left, right);
  let element = factory({ label: 'Native template context' }); left.append(element);
  return {
    Move() { (element.parentElement === left ? right : left).append(element); },
    Update() { return factory.update(element, { label: 'Updated native template context' }); },
    async Recreate() { await factory.dispose(element); element = factory({ label: 'Recreated native template context' }); left.append(element); },
    async Dispose() { try { await factory.dispose(element); } finally { left.remove(); right.remove(); } }
  };
}

export function CreateFunction(increment) { return value => value + increment; }
export function ApplyFunction(fn, value) { return fn(value); }
