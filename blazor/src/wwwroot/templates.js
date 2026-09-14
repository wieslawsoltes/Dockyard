import { snapshot } from './interop.js';
import { stream, jsonText, maximumBytes } from './transport.js';
import { TemplateLifetime } from './template-lifetime.js';
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
      super(); this.contextId = `template-${++nextId}`; this.version = 0;
      this.lifetime = new TemplateLifetime({
        connected: () => this.isConnected,
        create: async () => {
          if (!globalThis.Blazor?.rootComponents?.add) throw new Error('Register the package JS roots on the Blazor host before using Razor templates.');
          contexts.set(this.contextId, this.text);
          return Blazor.rootComponents.add(this, this.descriptor.component, this.parameters());
        },
        update: root => { contexts.set(this.contextId, this.text); return root.setParameters(this.parameters()); },
        clear: () => contexts.delete(this.contextId),
        report: error => {
          if (!this.isConnected) return;
          this.setAttribute('data-template-error', String(error.message ?? error));
          this.dispatchEvent(new CustomEvent('blazor-template-error', { detail: { message: String(error.message ?? error) }, bubbles: true, composed: true }));
          console.error('Razor template failed', error);
        }
      });
      // Blazor finds handlers using composedPath, but builds ChangeEventArgs from target.
      // Preserve the originating input instead of the shadow host exposed at Document.
      for (const type of ['input', 'change', 'submit', 'reset']) this.addEventListener(type, event => {
        if (!(this.getRootNode() instanceof ShadowRoot)) return;
        const target = event.composedPath()[0];
        if (!target || target === this) return;
        if (event.composed) {
          Object.defineProperty(event, 'target', { value: target, configurable: true });
          return;
        }
        const forwarded = new Event(type, { bubbles: event.bubbles, cancelable: event.cancelable, composed: true });
        Object.defineProperty(forwarded, 'target', { value: target, configurable: true });
        if ('submitter' in event) Object.defineProperty(forwarded, 'submitter', { value: event.submitter });
        event.stopPropagation();
        if (!target.dispatchEvent(forwarded)) event.preventDefault();
      }, true);
    }
    configure(descriptor, value) { this.descriptor = descriptor; this.update(value); }
    parameters() { return { templateId: this.descriptor.id, contextId: this.contextId, version: this.version }; }
    update(value) {
      if (this.lifetime.disposed) throw new Error('The Razor template has been disposed.');
      this.text = contextOf(value, this.descriptor); this.version++;
      return this.lifetime.schedule(this.version);
    }
    connectedCallback() { if (this.descriptor) this.lifetime.schedule(this.version); }
    disconnectedCallback() { queueMicrotask(() => this.lifetime.schedule(this.version)); }
    dispose() { const pending = this.lifetime.dispose(); this.remove(); return pending; }

  }
  customElements.define(tag, RazorTemplateElement);
}
/** Synchronous native factory; Blazor owns each result as an independent dynamic root. */
export function createFactory(descriptor) {
  if (typeof descriptor.id !== 'string' || !descriptor.id.trim() || descriptor.id.length > 200) throw new TypeError('A valid Razor template ID is required.');
  register();
  const factory = value => {
    const host = document.createElement(tag); host.style.display = 'block'; host.configure(descriptor, value); return host;
  };
  factory.templateKey = JSON.stringify(descriptor);
  factory.update = (host, value) => host.update(value);
  factory.dispose = host => host.dispose();
  return factory;
}
export function readContext(id) {
  if (!contexts.has(id)) throw new Error('The native template host is no longer connected.');
  return stream(contexts.get(id), 'json-text');
}
