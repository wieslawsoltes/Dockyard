# Dockyard 0.2.0 — Real browser-window floating

```sh
npm install @wieslawsoltes/dockyard@0.2.0
```

Real browser windows and existing in-page floating now share one DockingManager,
layout model and retained DOM. In-page remains the default. Configure
`FloatingWindowMode`, override an individual content item, or explicitly call
`FloatInBrowserWindow()` / `FloatInPage()`. Familiar `.Float()`, `.Dock()`,
capabilities, commands and cancelable events remain available.

This release adds multi-window documents and nested pane groups; cross-window
HTML drag-and-drop; child-aware splitters, menus, keyboard and focus; live
styles/theme/direction; actual screen geometry; safe popup fallback; configurable
native-close recovery; host switching; persisted browser intent and explicit
resume; host/collection lifecycle notifications; native Window handles on
floating controls; content-document change hooks and complete cleanup.

The full playground includes hosting controls and a separate
[multi-window example](https://wieslawsoltes.github.io/Dockyard/sample/multi-window.html).
[API, lifecycle and platform contract](https://github.com/wieslawsoltes/Dockyard/blob/main/docs/BROWSER-WINDOWS.md).

The release gate runs 66 core tests, strict TypeScript and installed-package
checks on Node 22/24, 34 existing Chromium interaction groups, 21 new
HTTP-origin browser-window groups, and HTTP sample/persistence checks. Immutable
npm/browser/showcase/source archives include SHA-256 checksums. The existing
workflow publishes GitHub Packages, the GitHub release, the public npm package
with provenance, and the GitHub Pages showcase after verification.

Browser permission and same-origin rules still apply. Native OS window chrome,
privileged monitor placement, arbitrary cross-document framework portals,
iframe state preservation across documents, and independent child runtimes are
not promised. Physical multi-monitor and non-Chromium qualification are not
claimed. No WPF runtime or arbitrary .NET API parity is introduced. The Blazor
package retains its independent version and release cycle.
