import { snapshot } from './interop.js';
import { stream, jsonText, maximumBytes } from './transport.js';
const contexts = new Map();
const tag = 'Dockyard'.toLowerCase() + '-razor-template';
let nextId = 0;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
function read(value, path) {
  for (const key of path.split('.')) {
    if (!key || forbidden.has(key)) throw new TypeError('Invalid template context path.');
    value = value?.[key];
  }
  return value;
}
function contextOf(value, descriptor) {
  if (descriptor.contextProperty) value = read(value, descriptor.contextProperty);
  if (descriptor.fields) value = Object.fromEntries(descriptor.fields.map(path => [path, read(value, path)]));
  else if (value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) value = snapshot(value);
  const text = jsonText(value);
  if (new Blob([text]).size > maximumBytes) throw new RangeError('Template context exceeds 64 MiB.');
  return text;
}
function register() {
  if (customElements.get(tag)) return;
  class RazorTemplateElement extends HTMLElement {
    constructor() {
      super(); this.contextId = `template-${++nextId}`; this.version = 0; this.pending = Promise.resolve();
      // Native shadow roots don't let ordinary change/submit events reach the Blazor document event delegator.
      for (const type of ['change', 'submit', 'reset']) this.addEventListener(type, event => {
        if (event.composed || !(this.getRootNode() instanceof ShadowRoot)) return;
        const forwarded = new Event(type, { bubbles: event.bubbles, cancelable: event.cancelable, composed: true });
        event.stopPropagation();
        if (!event.target.dispatchEvent(forwarded)) event.preventDefault();
      }, true);
    }
    configure(descriptor, value) { this.descriptor = descriptor; this.update(value); }
    update(value) { this.text = contextOf(value, this.descriptor); this.version++; this.schedule(); }
    connectedCallback() { this.schedule(); }
    disconnectedCallback() { queueMicrotask(() => { if (!this.isConnected) this.schedule(); }); }
    schedule() {
      this.pending = this.pending.then(() => this.synchronize()).catch(error => {
        if (!this.isConnected) return;
        this.setAttribute('data-template-error', String(error.message ?? error));
        this.dispatchEvent(new CustomEvent('blazor-template-error', { detail: { message: String(error.message ?? error) }, bubbles: true, composed: true }));
        console.error('Razor template failed', error);
      });
    }
    async synchronize() {
      if (!this.isConnected) {
        const root = this.root; this.root = null;
        try { if (root) await root.dispose(); } finally { contexts.delete(this.contextId); }
        return;
      }
      if (!this.descriptor) return;
      contexts.set(this.contextId, this.text);
      const parameters = { templateId: this.descriptor.id, contextId: this.contextId, version: this.version };
      if (!this.root) {
        if (!globalThis.Blazor?.rootComponents?.add) throw new Error('Enable the package JS-root registration on the Blazor host before using Razor templates.');
        this.root = await Blazor.rootComponents.add(this, this.descriptor.component, parameters);
      } else if (this.appliedVersion !== this.version) await this.root.setParameters(parameters);
      this.appliedVersion = parameters.version;
      this.removeAttribute('data-template-error');
      if (!this.isConnected) await this.synchronize();
    }
  }
  customElements.define(tag, RazorTemplateElement);
}
/** Synchronous native factory; Blazor owns each factory result as a separate dynamic root. */
export function createFactory(descriptor) {
  if (typeof descriptor.id !== 'string' || !descriptor.id.trim() || descriptor.id.length > 200) throw new TypeError('A valid Razor template ID is required.');
  register();
  const factory = value => {
    const host = document.createElement(tag); host.style.display = 'block'; host.configure(descriptor, value); return host;
  };
  factory.update = (host, value) => host.update(value);
  factory.dispose = host => { host.remove(); host.schedule(); };
  return factory;
}
export function readContext(id) {
  if (!contexts.has(id)) throw new Error('The native template host is no longer connected.');
  return stream(contexts.get(id), 'json-text');
}
