import { LayoutContent, LayoutDocument, LayoutPane, LayoutFloatingWindow, LayoutDocumentPane, contents } from './model.js';
import { element, button, moveNode } from './dom.js';

const GEOMETRY = ['FloatingLeft', 'FloatingTop', 'FloatingWidth', 'FloatingHeight'];
const DRAG_TYPE = 'application/x-dockyard-window';
const POPUP_CSS = `
html,body{margin:0;width:100%;height:100%;overflow:hidden}
.ad-popup-shell{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0}
.ad-popup-toolbar{display:flex;align-items:center;flex:0 0 34px;gap:6px;padding:0 8px;border-bottom:1px solid var(--ad-border);background:var(--ad-chrome);font:12px system-ui;user-select:none}
.ad-popup-toolbar strong{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-popup-body{flex:1;min-height:0;min-width:0;display:flex;overflow:hidden}
.ad-popup-body>.ad-group,.ad-popup-body>.ad-pane,.ad-popup-body>.ad-content{flex:1;min-width:0;min-height:0}
.ad-popup-shell .ad-drag-overlay{inset:0}
`;

/** One owner, one logical layout tree, any number of real browser documents.
 * No layout clones, remote scripts or cross-origin postMessage commands are used.
 */
export class BrowserWindowHost {
  constructor(renderer) {
    this.renderer = renderer;
    this.manager = renderer.manager;
    this.owner = renderer.rootSurface;
    this.records = renderer.popups;
    this.disposed = false;
    this.drag = null;
    this.installSurface(this.owner, renderer.abort.signal);
    this.owner.win.addEventListener('pagehide', () => {
      // Preserve the last layout intent before closing owned browsing contexts.
      this.captureAll();
      if (this.manager.StorageKey && this.manager.AutoSave) this.manager.SaveToStorage();
      for (const id of [...this.records.keys()]) this.close(id, { reason: 'OwnerClosed' });
    }, { signal: renderer.abort.signal });
    this.stylesObserver = new this.owner.win.MutationObserver(() => {
      for (const rec of this.records.values()) rec.stylesDirty = true;
      renderer.requestRender();
    });
    this.stylesObserver.observe(this.owner.doc.head, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  find(subject) {
    const model = subject instanceof LayoutFloatingWindow ? subject : subject?.FindParent?.(LayoutFloatingWindow);
    return model ? this.records.get(model.Id) : null;
  }

  reserve(subject, bounds = {}) {
    const existing = subject instanceof LayoutFloatingWindow ? this.records.get(subject.Id) : null;
    if (existing && this.alive(existing)) return existing;
    if (!this.manager.AllowBrowserWindows) return this.blocked(subject, new Error('Browser-window hosting is disabled.'), bounds.BrowserWindowFallback);
    const seed = subject instanceof LayoutContent || subject instanceof LayoutFloatingWindow ? subject : contents(subject)[0];
    const width = Math.max(this.manager.FloatingWindowMinWidth, Math.round(bounds.FloatingWidth ?? seed?.FloatingWidth ?? 640));
    const height = Math.max(this.manager.FloatingWindowMinHeight, Math.round(bounds.FloatingHeight ?? seed?.FloatingHeight ?? 440));
    const native = subject instanceof LayoutFloatingWindow && subject.FloatingWindowMode === 'BrowserWindow';
    const left = Math.round(bounds.FloatingLeft ?? (native ? seed.FloatingLeft : this.owner.win.screenX + 60));
    const top = Math.round(bounds.FloatingTop ?? (native ? seed.FloatingTop : this.owner.win.screenY + 60));
    if (![left, top, width, height].every(Number.isFinite)) throw new TypeError('Floating window bounds must be finite');
    let window;
    try {
      // A unique, unnamed context prevents collisions with unrelated tabs.
      window = this.owner.win.open('about:blank', '_blank', `popup=yes,resizable=yes,scrollbars=no,left=${left},top=${top},width=${width},height=${height}`);
      if (!window || window.closed) throw new Error('The browser blocked this popup. Open one window per user gesture or allow popups for this site.');
      void window.document; // Require same-origin access; never navigate untrusted URLs.
      return { window, reserved: true, initial: { FloatingLeft: left, FloatingTop: top, FloatingWidth: width, FloatingHeight: height } };
    } catch (error) {
      try { window?.close(); } catch { /* Already inaccessible. */ }
      return this.blocked(subject, error, bounds.BrowserWindowFallback);
    }
  }

  blocked(subject, error, fallback = this.manager.BrowserWindowFallback) {
    this.manager._emit('BrowserWindowBlocked', { Model: subject, Error: error, Fallback: fallback });
    this.manager._emit('Error', { Error: error, Operation: 'Open browser window' });
    return null;
  }

  attach(model, reservation) {
    if (!reservation) return null;
    if (!reservation.reserved) {
      reservation.model = model;
      this.focus(model);
      return reservation.window;
    }
    const window = reservation.window, doc = window.document;
    const abort = new window.AbortController();
    const rec = { window, doc, model, modelId: model.Id, abort, closing: false, styles: [], stylesDirty: true, last: null };
    try {
      const base = doc.createElement('base'); base.href = this.owner.doc.baseURI; doc.head.append(base);
      const charset = doc.createElement('meta'); charset.setAttribute('charset', 'utf-8'); doc.head.append(charset);
      const style = doc.createElement('style'); style.textContent = POPUP_CSS;
      // Preserve a CSP nonce when the host application supplies one.
      const nonce = this.owner.doc.querySelector('style[nonce],script[nonce]')?.nonce;
      if (nonce) style.nonce = nonce;
      rec.localStyle = style;
      const shell = element(doc, 'div', 'ad-manager ad-popup-shell'); shell.tabIndex = 0;
      shell.setAttribute('role', 'region'); shell.setAttribute('aria-label', 'Floating docking workspace');
      shell.dataset.floatingId = model.Id;
      const bar = element(doc, 'div', 'ad-popup-toolbar'); bar.draggable = true; bar.dataset.adDrag = model.Id;
      rec.caption = element(doc, 'strong');
      rec.dock = button(doc, 'dock', 'Dock back into workspace', () => this.manager.Dock(this.liveModel(rec)));
      rec.inPage = button(doc, 'restore', 'Move to in-page floating window', () => this.manager.FloatInPage(this.liveModel(rec)));
      rec.closeButton = button(doc, 'close', 'Close floating window', () => this.manager.CloseFloatingWindow(this.liveModel(rec)));
      bar.append(rec.caption, rec.dock, rec.inPage, rec.closeButton);
      const body = element(doc, 'div', 'ad-popup-body');
      const overlay = element(doc, 'div', 'ad-drag-overlay'); overlay.setAttribute('aria-hidden', 'true');
      const parking = element(doc, 'div', 'ad-parking'); parking.hidden = true;
      const live = element(doc, 'div', 'ad-live'); live.setAttribute('aria-live', 'polite');
      shell.append(bar, body, overlay, parking, live); doc.body.replaceChildren(shell);
      Object.assign(rec, { shell, body, surface: { doc, win: window, host: shell, workspace: body, overlay, parking, live, floating: model } });
      this.records.set(model.Id, rec);
      this.syncStyles(rec);
      const opts = { signal: abort.signal };
      this.installSurface(rec.surface, abort.signal);
      shell.addEventListener('keydown', e => this.renderer.onKeyDown(e), opts);
      shell.addEventListener('keyup', e => this.renderer.onKeyUp(e), opts);
      shell.addEventListener('focusin', e => {
        const id = e.target.closest?.('[data-ad-content]')?.dataset.adContent;
        const item = id && this.manager.Find(id); if (item) this.manager.Activate(item);
      }, opts);
      window.addEventListener('focus', () => {
        const liveModel = this.liveModel(rec);
        const items = liveModel ? contents(liveModel) : [];
        const selected = items.find(x => x.IsSelected) || items[0];
        if (selected && !selected.IsActive) this.manager.Activate(selected);
      }, opts);
      window.addEventListener('blur', () => this.renderer.cancelInteraction(), opts);
      doc.addEventListener('pointerdown', e => {
        if (this.renderer.menu && !this.renderer.menu.contains(e.target)) this.renderer.closeMenu();
      }, opts);
      // pagehide does not run for a canceled beforeunload prompt. Heartbeat also
      // catches OS/browser closes and inaccessible navigations without unload.
      window.addEventListener('pagehide', () => this.nativeClosed(rec, 'NavigationOrClose'), opts);
      window.addEventListener('resize', () => this.scheduleCapture(rec), opts);
      if (!this.timer) this.timer = this.owner.win.setInterval(() => this.tick(), 250);
      rec.maximized = false;
      this.capture(rec);
      rec.applied = this.geometry(model);
      this.manager._emit('BrowserWindowOpened', { Model: model, Window: window, Control: this.renderer.controlFor(model) });
      this.renderer.requestRender();
      window.focus();
      return window;
    } catch (error) {
      if (this.records.has(model.Id)) this.close(model.Id, { reason: 'OpenFailed' });
      else { abort.abort(); try { window.close(); } catch {} }
      this.blocked(model, error);
      return null;
    }
  }

  geometry(model) { return Object.fromEntries(GEOMETRY.map(key => [key, model[key]])); }
  liveModel(rec) { const m = this.manager.FindById(rec.modelId); return m instanceof LayoutFloatingWindow ? m : null; }
  alive(rec) { try { return !rec.window.closed && rec.window.document === rec.doc; } catch { return false; } }
  measure(rec) {
    return { FloatingLeft: rec.window.screenX, FloatingTop: rec.window.screenY, FloatingWidth: rec.window.innerWidth, FloatingHeight: rec.window.innerHeight };
  }
  same(a, b) { return a && b && GEOMETRY.every(key => a[key] === b[key]); }

  capture(rec) {
    const model = this.liveModel(rec);
    if (!model || !this.alive(rec) || rec.closing) return;
    const actual = this.measure(rec);
    if (!Object.values(actual).every(Number.isFinite) || actual.FloatingWidth < 1 || actual.FloatingHeight < 1) return;
    if (!this.same(this.geometry(model), actual)) {
      this.manager.Transaction('Move or resize browser window', () => {
        for (const key of GEOMETRY) model[key] = actual[key];
        for (const item of contents(model)) for (const key of GEOMETRY) item[key] = actual[key];
      });
      this.manager._emit('BrowserWindowBoundsChanged', { Model: model, Window: rec.window, Bounds: actual });
    }
    rec.last = actual; rec.applied = this.geometry(model); rec.pending = false;
  }
  scheduleCapture(rec) { rec.pending = true; rec.changedAt = Date.now(); this.renderer.requestRender(); }
  captureAll() { for (const rec of this.records.values()) this.capture(rec); }
  tick() {
    if (this.disposed) return;
    for (const rec of [...this.records.values()]) {
      if (!this.alive(rec)) { this.nativeClosed(rec, 'NativeClose'); continue; }
      const actual = this.measure(rec);
      if (!this.same(rec.observed, actual)) { rec.observed = actual; this.scheduleCapture(rec); }
      else if (rec.pending && Date.now() - rec.changedAt >= 200) this.capture(rec);
    }
  }

  syncStyles(rec) {
    if (!rec.stylesDirty) return;
    const clones = [];
    for (const source of this.owner.doc.querySelectorAll('link[rel="stylesheet"],style')) {
      const clone = source.cloneNode(true);
      if (clone.tagName === 'LINK') clone.href = source.href;
      if (source.nonce) clone.nonce = source.nonce;
      clones.push(clone);
    }
    // Constructed/adopted sheets cannot be shared across documents. Copy their
    // rules when readable; normal cross-origin <link> sheets are cloned above.
    for (const sheet of this.owner.doc.adoptedStyleSheets || []) {
      try { const clone = rec.doc.createElement('style'); clone.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n'); clones.push(clone); } catch {}
    }
    for (const clone of clones) rec.doc.head.append(clone);
    for (const old of rec.styles) old.remove();
    rec.styles = clones; rec.doc.head.append(rec.localStyle); rec.stylesDirty = false;
  }

  render(model, rec) {
    if (!this.alive(rec)) { this.nativeClosed(rec, 'NativeClose'); return false; }
    rec.model = model; rec.surface.floating = model;
    this.syncStyles(rec);
    rec.shell.dataset.theme = this.owner.host.dataset.theme;
    rec.shell.dir = this.owner.host.dir;
    const computed = this.owner.win.getComputedStyle(this.owner.host);
    for (const key of rec.variables || []) rec.shell.style.removeProperty(key);
    rec.variables = [...computed].filter(key => key.startsWith('--'));
    for (const key of rec.variables) rec.shell.style.setProperty(key, computed.getPropertyValue(key));
    const items = contents(model), selected = items.find(x => x.IsActive) || items.find(x => x.IsSelected) || items[0];
    rec.doc.title = selected?.Title || 'Floating window'; rec.caption.textContent = rec.doc.title;
    rec.dock.disabled = !items.every(x => x.CanDock && x.CanMove && x.IsEnabled);
    rec.inPage.disabled = !items.every(x => x.CanFloat && x.CanMove && x.IsEnabled);
    rec.closeButton.disabled = !items.every(x => x instanceof LayoutDocument ? x.CanClose : x.CanHide || x.CanClose);
    const active = rec.doc.activeElement;
    const selection = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    this.renderer.withSurface(rec.surface, () => {
      const node = model.RootPanel ? this.renderer.renderNode(model.RootPanel) : null;
      this.renderer.sync(rec.body, node ? [node] : []);
    });
    if (active?.isConnected && active.ownerDocument === rec.doc && rec.doc.activeElement !== active) {
      try { active.focus({ preventScroll: true }); if (selection?.[0] != null) active.setSelectionRange(...selection); } catch {}
    }
    // Model edits (including history restore) use the same AvalonDock geometry.
    const requested = this.geometry(model);
    if (!this.same(rec.applied, requested)) this.applyBounds(rec, requested);
    if (rec.maximized !== model.IsMaximized) this.maximize(model, model.IsMaximized);
    return true;
  }

  applyBounds(rec, bounds) {
    if (!this.alive(rec)) return false;
    try {
      const current = this.measure(rec);
      if (current.FloatingLeft !== bounds.FloatingLeft || current.FloatingTop !== bounds.FloatingTop) rec.window.moveTo(bounds.FloatingLeft, bounds.FloatingTop);
      if (current.FloatingWidth !== bounds.FloatingWidth || current.FloatingHeight !== bounds.FloatingHeight) {
        rec.window.resizeTo(Math.max(this.manager.FloatingWindowMinWidth, bounds.FloatingWidth) + Math.max(0, rec.window.outerWidth - rec.window.innerWidth), Math.max(this.manager.FloatingWindowMinHeight, bounds.FloatingHeight) + Math.max(0, rec.window.outerHeight - rec.window.innerHeight));
      }
      rec.applied = { ...bounds }; this.scheduleCapture(rec); return true;
    } catch (error) { this.manager._emit('Error', { Error: error, Operation: 'Set browser window bounds' }); return false; }
  }
  maximize(model, maximize = true) {
    const rec = this.records.get(model.Id); if (!rec || !this.alive(rec)) return false;
    if (rec.maximized === maximize) return true;
    if (maximize) {
      rec.restore = this.measure(rec);
      const s = rec.window.screen;
      this.applyBounds(rec, { FloatingLeft: s.availLeft ?? 0, FloatingTop: s.availTop ?? 0, FloatingWidth: s.availWidth, FloatingHeight: s.availHeight - Math.max(0, rec.window.outerHeight - rec.window.innerHeight) });
    } else if (rec.restore) this.applyBounds(rec, rec.restore);
    rec.maximized = maximize;
    // Browser window managers ultimately decide whether move/resize is allowed.
    return true;
  }
  focus(model) { const rec = this.records.get(model?.Id); if (!rec || !this.alive(rec)) return false; rec.window.focus(); return true; }

  nativeClosed(rec, reason) {
    if (rec.closing || this.disposed) return;
    const model = this.liveModel(rec);
    this.close(rec.modelId, { reason });
    if (!model || model.Root !== this.manager.Layout || this.manager._disposed) return;
    this.manager.Transaction('Return closed browser window', () => {
      model.FloatingWindowMode = 'InPage'; model.FloatingLeft = 40; model.FloatingTop = 40; model.IsMaximized = false;
      const behavior = this.manager.BrowserWindowCloseBehavior;
      // A native close cannot be canceled by a layout event. On a veto, retain
      // all content in the owner instead of reopening a popup or losing data.
      if (behavior === 'Dock') this.manager.Dock(model);
      else if (behavior === 'Close') this.manager.CloseFloatingWindow(model);
    });
    this.renderer.requestRender();
  }

  close(id, { reason = 'HostChanged', closeWindow = true } = {}) {
    const rec = this.records.get(id); if (!rec || rec.closing) return;
    rec.closing = true;
    if (this.renderer.frameWindow === rec.window) this.renderer.cancelRenderFrame();
    if (this.renderer.menu?.ownerDocument === rec.doc) this.renderer.closeMenu();
    if (this.renderer.navigator?.ownerDocument === rec.doc) this.renderer.closeNavigator(false);
    this.renderer.cancelInteraction();
    rec.abort.abort();
    // Adopt the original connected DOM back before closing the native document.
    for (const child of [...rec.body.children, ...rec.surface.parking.children]) moveNode(this.owner.parking, child);
    this.records.delete(id);
    if (closeWindow) { try { if (!rec.window.closed) rec.window.close(); } catch {} }
    if (!this.records.size && this.timer) { this.owner.win.clearInterval(this.timer); this.timer = null; }
    this.manager._emit('BrowserWindowClosed', { Model: this.liveModel(rec) || rec.model, Window: rec.window, Reason: reason });
    this.renderer.requestRender();
  }

  reconcile() {
    for (const rec of [...this.records.values()]) {
      const model = this.liveModel(rec);
      if (!model || model.FloatingWindowMode !== 'BrowserWindow' || !this.manager.AllowBrowserWindows) this.close(rec.modelId, { reason: !model ? 'LayoutRemoved' : 'HostChanged' });
    }
  }

  installSurface(surface, signal) {
    const run = fn => event => this.renderer.withSurface(surface, () => fn.call(this, event, surface));
    const opts = { signal };
    surface.doc.addEventListener('visibilitychange', () => { this.renderer.cancelRenderFrame(); this.renderer.requestRender(); }, opts);
    surface.host.addEventListener('dragstart', run(this.dragStart), opts);
    surface.host.addEventListener('dragover', run(this.dragOver), opts);
    surface.host.addEventListener('drop', run(this.drop), opts);
    surface.host.addEventListener('dragend', run(this.dragEnd), opts);
    surface.host.addEventListener('dragleave', e => { if (!surface.host.contains(e.relatedTarget)) surface.overlay.replaceChildren(); }, opts);
    surface.host.addEventListener('keydown', e => { if (e.key === 'Escape') this.clearDrag(); }, opts);
  }
  useNativeDrag(event) { return event.pointerType !== 'touch' && this.manager.EnableCrossWindowDocking && this.records.size > 0; }
  dragStart(event, surface) {
    const target = event.target.closest?.('[data-ad-drag]');
    if (!target || event.target.closest?.('button') || !this.manager.EnableCrossWindowDocking) return;
    const subject = this.manager.FindById(target.dataset.adDrag);
    const items = subject ? this.manager._subjectItems(subject) : [];
    if (!items.length || !items.every(x => x.CanMove && x.IsEnabled) || subject instanceof LayoutContent && subject.Parent instanceof LayoutPane && !subject.Parent.CanRepositionItems) { event.preventDefault(); return; }
    this.renderer.cancelInteraction();
    const token = this.owner.win.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    this.drag = { subject, items, token, source: surface };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_TYPE, token);
    // Text is a label only, never executable or deserialized content.
    event.dataTransfer.setData('text/plain', items[0].Title);
    surface.host.classList.add('ad-dragging');
  }
  dragOver(event) {
    const payload = this.drag;
    if (!payload || payload.subject.Root !== this.manager.Layout || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    const drop = event.ctrlKey ? null : this.renderer.findDrop(payload, event.clientX, event.clientY);
    this.renderer.drawDropGuides(payload, drop, event.clientX, event.clientY, event.ctrlKey);
    if (drop?.position && this.manager.CanDockAt(payload.subject, drop.target, drop.position)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
  }
  drop(event) {
    const payload = this.drag;
    if (!payload || event.dataTransfer.getData(DRAG_TYPE) !== payload.token || payload.subject.Root !== this.manager.Layout) return;
    const drop = event.ctrlKey ? null : this.renderer.findDrop(payload, event.clientX, event.clientY);
    if (!drop?.position || !this.manager.CanDockAt(payload.subject, drop.target, drop.position)) { this.clearDrag(); return; }
    event.preventDefault(); event.stopPropagation();
    this.clearDrag();
    this.manager.Dock(payload.subject, drop.target, drop.position, drop.index);
    this.renderer.focusContent(payload.items[0]);
  }
  dragEnd() { this.clearDrag(); }
  clearDrag() {
    this.drag = null;
    for (const surface of [this.owner, ...[...this.records.values()].map(r => r.surface)]) {
      surface.overlay.replaceChildren(); surface.host.classList.remove('ad-dragging');
    }
  }
  dispose() {
    this.disposed = true; this.clearDrag(); this.stylesObserver.disconnect();
    for (const id of [...this.records.keys()]) this.close(id, { reason: 'Disposed' });
    if (this.timer) this.owner.win.clearInterval(this.timer);
  }
}
