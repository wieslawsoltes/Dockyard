import * as engine from '../../src/index.js';
export const api = engine;
let style;
function loadStyles() {
  return style ??= new Promise((resolve, reject) => {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./styles.css', import.meta.url).href;
    link.onload = resolve; link.onerror = () => { style = null; link.remove(); reject(new Error('Could not load Dockyard styles.')); }; document.head.append(link);
  });
}
export async function mount(host, options) { await loadStyles(); return new engine.DockingManager(host, options); }
export function update(manager, options) { for (const [key, value] of Object.entries(options)) if (manager[key] !== value) manager[key] = value; }
