/** Opaque handles preserve native functions across both Blazor hosting models. */
const functions = new WeakMap();
export function unwrap(value) { return functions.has(value) ? functions.get(value) : value; }
function reference(value) {
  if (typeof value !== 'function') return value;
  const box = Object.create(null); functions.set(box, value); return box;
}
export function install(Session) {
  Session.prototype.invokeReference = async function(name, args = []) { return reference(await this.invoke(name, args)); };
  Session.prototype.callReference = async function(target, name, args = []) { return reference(await this.call(unwrap(target), name, args)); };
  Session.prototype.getReference = function(target, name) { return reference(this.get(unwrap(target), name)); };
  Session.prototype.callFunction = function(target, args = []) {
    const fn = unwrap(target);
    if (typeof fn !== 'function') throw new TypeError('The reference is not a function.');
    return this.call({ invoke: (...values) => Reflect.apply(fn, undefined, values) }, 'invoke', args);
  };
}
