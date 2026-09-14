/** Serializes dynamic-root creation, parameter updates and cleanup. No render subtree is reparented. */
export class TemplateLifetime {
  constructor({ connected, create, update, clear, report = () => {} }) {
    Object.assign(this, { connected, create, update, clear, report });
    this.root = null; this.version = 0; this.applied = -1;
    this.disposed = false; this.pending = Promise.resolve();
    this.disposal = null; this.cleanup = null;
  }
  schedule(version = this.version) {
    this.version = version;
    if (this.disposed) return this.disposal ?? this.pending;
    return this.enqueue();
  }
  enqueue() {
    const next = this.pending.catch(() => {}).then(() => this.synchronize());
    this.pending = next;
    // Lifecycle callbacks cannot await. Keep failures observable without unhandled rejections.
    next.catch(error => this.report(error));
    return next;
  }
  disposeRoot() {
    if (!this.cleanup) {
      const root = this.root; this.root = null; this.applied = -1;
      this.cleanup = Promise.resolve().then(() => root?.dispose()).finally(() => this.clear());
    }
    return this.cleanup;
  }
  async synchronize() {
    if (this.disposed || !this.connected()) { await this.disposeRoot(); return; }
    if (this.cleanup) { await this.cleanup; this.cleanup = null; }
    const version = this.version;
    try {
      if (!this.root) this.root = await this.create();
      else if (this.applied !== version) await this.update(this.root);
      this.applied = version;
    } catch (error) {
      if (!this.root) this.clear();
      throw error;
    }
    if (this.disposed || !this.connected()) await this.disposeRoot();
  }
  dispose() {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    return this.disposal = this.enqueue();
  }
}
