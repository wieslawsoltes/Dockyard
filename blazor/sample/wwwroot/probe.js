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
  const element = factory({ label: 'Native template context' }); root.append(element);
  return { Dispose() { factory.dispose(element); } };
}
