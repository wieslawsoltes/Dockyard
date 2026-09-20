# Browser-window floating — Dockyard 0.2.0

Dockyard supports two floating hosts over one `DockingManager` and one
`LayoutRoot`. `InPage` is the existing movable DOM window. `BrowserWindow`
opens a real, independently movable browser window and places the actual
pane/group DOM into that window. There is no screenshot, cloned content model,
second manager, network service, or separate application runtime.

## Configuration and API

```js
import {
  DockingManager, LayoutDocument, FloatingWindowMode,
  BrowserWindowCloseBehavior, BrowserWindowFallback
} from '@wieslawsoltes/dockyard';
import '@wieslawsoltes/dockyard/styles.css';

const manager = new DockingManager(host, {
  FloatingWindowMode: FloatingWindowMode.InPage,  // compatibility default
  AllowBrowserWindows: true,
  EnableCrossWindowDocking: true,
  BrowserWindowCloseBehavior: BrowserWindowCloseBehavior.Dock,
  BrowserWindowFallback: BrowserWindowFallback.InPage
});
const editor = manager.AddDocument(new LayoutDocument({
  ContentId: 'editor', Title: 'Editor', Content: textarea
}));

// Each native opening should be requested directly from a user gesture.
openButton.onclick = () => manager.FloatInBrowserWindow(editor, {
  FloatingLeft: 100, FloatingTop: 100,
  FloatingWidth: 720, FloatingHeight: 480
});
inPageButton.onclick = () => manager.FloatInPage(editor);
dockButton.onclick = () => editor.Dock();

// Familiar AvalonDock operations use the configured host too.
manager.FloatingWindowMode = FloatingWindowMode.BrowserWindow;
floatButton.onclick = () => editor.Float();
// Override individual documents/tools without changing the manager default.
editor.FloatingWindowMode = FloatingWindowMode.InPage;
// null restores inheritance from the manager.
editor.FloatingWindowMode = null;
```

A per-operation `FloatingWindowMode` in `Float(subject, options)` overrides a
content override, which overrides the manager default. An already-floating
window keeps its own mode when floated again, unless explicitly overridden.
`FloatInPage` and `FloatInBrowserWindow` are explicit overrides. They return the
`LayoutFloatingWindow` model, or `false` if a capability check/Cancel fallback
rejects the operation. They accept a content item, document/tool pane, nested
pane group or floating-window model. A single-content window is reused when
switching hosts; floating one tab out of a multi-tab window makes a new window.
Pass the floating model to switch the entire grouped window.

`AllowBrowserWindows = false` prevents new native hosts and returns existing
native hosts to in-page presentation. It preserves their desired browser-host
mode, so they may later be resumed. Changing the manager default affects future
Float operations; it does not forcibly relocate existing windows.

`LayoutContent.FloatingWindowMode` is a nullable override.
`LayoutFloatingWindow.FloatingWindowMode` records that window's desired host.
Both are observable PascalCase properties with corresponding `...Property`
tokens, following Dockyard's existing observable-property API. These hosting
settings are **web extensions**, not claims that WPF AvalonDock defines a
browser-mode enum or runs in the browser.

## Models, controls, commands and events

`LayoutRoot.FloatingWindows` remains the authoritative model collection.
`DockingManager.FloatingWindows` exposes floating controls when attached.
`DockingManager.BrowserWindows` contains controls that currently have live
native hosts. `PendingBrowserWindows` contains models with browser intent but
no live native host. Desired mode and actual hosting state are distinct.

`LayoutDocumentFloatingWindowControl` and
`LayoutAnchorableFloatingWindowControl` expose:

| Member | Behavior |
| --- | --- |
| `Model` | The existing floating-window model. |
| `Element` | The actual DOM shell in its owning document. |
| `Window` | The native `Window` handle, or `null` for in-page hosting. |
| `IsBrowserWindow` | Whether a live native window is attached. |
| `Show()`, `Activate()`, `Focus()` | Show/resume and focus the owned window/content. |
| `Dock()`, `Close()` | Existing model operations; Close honors cancelable events. |
| `FloatInPage()`, `FloatInBrowserWindow()` | Explicitly switch the whole host. |
| `Maximize()`, `Restore()` | Request available-screen sizing/restore; see platform limits. |

The existing `FloatCommand` resolves the configured default. Layout items also
expose `FloatInPageCommand` and `FloatInBrowserWindowCommand` with capability
checks. Tab menus offer both explicit modes; in-page title bars expose a native
window button. Child title bars expose dock-back, in-page and Close actions.
The main showcase adds default-host selection, browser floating, pane floating
and pending-window resume. See `sample/multi-window.html` for a focused example.

The existing `LayoutFloatingWindowControlCreated` and
`LayoutFloatingWindowControlClosed` events now include removals caused by docking
and layout replacement, not only explicit close commands.
`LayoutFloatingWindowControlCollectionChanged` carries an AvalonDock-shaped
`LayoutFloatingWindowControlCollectionChangedEventArgs` whose
`CollectionChangedEventArgs` contains `Action`, `NewItems`, and `OldItems`.
The collection reports logical floating windows; switching a host without
changing the model is not a remove/add pair.

Additional host events, also dispatched as `avalondock:<Name>` DOM events on the
manager host:

| Event | Details |
| --- | --- |
| `BrowserWindowOpened` | `Model`, native `Window`, floating `Control`. |
| `BrowserWindowClosed` | `Model`, `Window`, and a `Reason` such as `HostChanged`, `LayoutRemoved`, `NativeClose`, `NavigationOrClose`, `OwnerClosed`, or `Disposed`. |
| `BrowserWindowBlocked` | `Model`, `Error`, effective `Fallback`. The general `Error` event is also emitted. |
| `BrowserWindowBoundsChanged` | `Model`, `Window`, actual `Bounds`. |
| `ContentHostChanged` | Content `Model`, wrapper `Element`, `OldDocument`, new `Document`, and `Window`; emitted after an existing content wrapper changes owner document. |

Content factories remain lazy and retain the existing replacement/release/
disposal lifecycle. Moving a document does not call its disposal callback.
Original DOM nodes, input values and directly attached event listeners move
with the content. Use `ContentHostChanged` for editors that need to rebind
owner-document listeners, focus services or resize observers. Frameworks whose
event delegation or rendering is tied to the original document need their own
portal/document adapter. **This release does not claim native-window qualification
for arbitrary Blazor/Razor, React or third-party editor content.** The existing
Blazor integration and in-page behavior remain unchanged.

## Docking and interaction

Tabs and pane/window headers use native HTML drag-and-drop when at least one
browser window is open. This permits owner-to-child, child-to-owner and
child-to-child docking within the same manager. Center drops tab, edge drops
split, and the tab strip supports ordered insertion. Capabilities are checked
at drag start and again at drop. The private drag payload is an opaque token
belonging to an active session; unrelated external data and forged tokens are
not interpreted as layout commands. Unrelated managers do not share sessions.

Native window-frame dragging belongs to the browser/operating system and does
not produce DOM pointer events. Drag a Dockyard tab or its content-side title
bar to dock, or use Dock back. Dropping on unrelated applications/desktop does
not create a new layout or transfer user data. Touch retains the PointerEvents
path for interaction within the current document; cross-native-window touch
handoff is not claimed. Setting `EnableCrossWindowDocking = false` disables
native cross-document dragging while keeping in-document pointer docking.

Splitters, menus, keyboard navigation, tab lists and focus operate on the
correct child document. F6 and Ctrl+Tab can activate content hosted in another
window. Themes, direction, linked/inline styles and CSS custom properties are
copied/synchronized. Programmatically modified constructed stylesheet rules
may require a host refresh; cross-origin stylesheet rule contents cannot be
read, but their normal `<link>` URLs are retained. Inline popup styles use an
available host CSP nonce; strict CSP applications must permit their own local
styles and same-origin child windows.

Rendering selects a visible document's animation-frame scheduler so a hidden
owner does not inherently stall a visible child's layout. Browser background
throttling still applies. The owner runs a lightweight heartbeat while native
windows exist to observe native closes and geometry changes. Native movement is
coalesced before writing history, rather than recording every mouse pixel.

## Bounds, persistence, close and cleanup

In `BrowserWindow` mode, `FloatingLeft`/`FloatingTop` are screen coordinates and
`FloatingWidth`/`FloatingHeight` are the content viewport dimensions. In-page
mode uses workspace-relative positions. Switching back to in-page resets
position to a visible workspace origin instead of using potentially negative
multi-monitor coordinates. Native changes synchronize the model and its
contained content; model edits request native move/resize. Actual measurements
win when the browser clamps or refuses a requested geometry.

JSON snapshots preserve grouped layouts, host intent and geometry. The existing
XML serializer preserves those attributes on supported shapes, with the usual
AvalonDock-shaped schema limitations; floating multiple documents/groups is a
web extension, so use JSON for general web layouts. Native .NET interchange
qualification is not implied.

Loading a snapshot keeps existing browser hosts whose IDs still exist and
rebinds them to the new live models. Undoing a Float closes the removed native
host; redoing restores **intent**, not an unsolicited popup. After reload, saved
browser windows render as usable in-page windows with a dashed title separator.
Resume them from a button:

```js
resumeButton.onclick = () => {
  const windows = manager.RestoreBrowserWindows();
  console.log(windows.length, manager.PendingBrowserWindows.length);
};
```

Resume leaves blocked requests pending and never repeatedly opens popups from
render. Most browsers require one opening per gesture unless the site has
popup permission. To resume individually, call
`FloatInBrowserWindow(model, { BrowserWindowFallback: 'Cancel' })`.

Native close policy is configurable:

| `BrowserWindowCloseBehavior` | Result of the browser frame's Close/navigation |
| --- | --- |
| `Dock` (default) | Restore content to remembered dock containers. |
| `InPage` | Keep the grouped floating model in the main browser document. |
| `Close` | Run document close/tool hide operations with the existing cancellation events. |

A native frame already closed by the browser cannot be resurrected by setting
`Cancel`. If Close is vetoed, or Dock is prohibited, content is retained in-page.
The Dockyard **in-app** Close button checks cancellation before closing the
native host and therefore can leave that host open. Native close/navigation
salvages original nodes into the owner's parking area. Disabling hosting,
removing the model, Detach, Dispose and owner navigation close owned windows,
abort listeners and stop heartbeat timers. Owner lifetime still owns all child
windows: they are not independently reloadable applications or crash recovery
replicas. Persist application content separately from layout for durable edits.

## Browser boundaries and validation

Popup policy, same-origin/COOP rules, browser decisions to open a tab instead of
a window, native chrome, window movement, monitor access, and native OS maximize
are not under a DOM library's control. `Maximize()` is an available-screen
move/resize request, not a privileged OS maximize call. Arbitrary cross-origin
pages cannot be hosted as shared layout documents. Moving an iframe between
documents can recreate its browsing context; retain its state through the
iframe's own application contract. A killed renderer or owner crash cannot
reliably run cleanup events.

The release adds 10 core tests and 21 browser-window test groups. Browser tests
exercise actual independent Chromium pages, real button gestures, retained
inputs/listeners, menus/keyboard, pane resizing, native tab reordering, policy
fallback, geometry, maximization, close/navigation, layout replacement,
undo/redo, stylesheet updates, custom elements and cleanup. Cross-document
Dockyard drag events are dispatched on actual child documents to validate the
shared drag pipeline; only the within-child reorder test uses a full browser
mouse drag. The hidden-owner scheduler test controls document visibility to
exercise scheduling deterministically. These are not physical multi-monitor,
OS-titlebar drag, Safari/Firefox or physical touch qualification claims.

Run `npm run test:windows` for full HTTP-origin coverage. Environments with
restricted URL navigation can run `python tests/windows.py --offline`; it
inlines the same fixture in about:blank and omits only the HTTP reload/storage
case. CI uses the full HTTP-origin suite, not this reduced offline mode.

Primary platform references:
[Window.open](https://developer.mozilla.org/en-US/docs/Web/API/Window/open),
[Window.moveTo](https://developer.mozilla.org/en-US/docs/Web/API/Window/moveTo),
[Document.adoptNode](https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptNode).
