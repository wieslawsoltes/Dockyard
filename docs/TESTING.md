# Verification report — 0.2.0

## Current release gates

The feature validation runs **66 core tests**, strict TypeScript and actual-package installation checks, **34 existing Chromium interaction groups**, **21 new browser-window groups**, and **four HTTP-served demo entry checks**. All passed in [feature validation](https://github.com/wieslawsoltes/Dockyard/actions/runs/35490707403). The permanent PR/release workflow repeats validation on Node 22 and 24, with the browser tests on Node 24.

The release workflow retains machine-readable `browser-results.json`, `windows-results.json` and `site-results.json` in the `verification-node-24` Actions artifact. Use the artifact from the exact commit being assessed. Older reports checked into `test-results/` are historical evidence, not a substitute for the current workflow result. Test counts are executable tests/grouped scenarios, not percentages of upstream API parity.

## Coverage and method

Core tests run source modules and cover typed trees, cycle/ID checks, properties/events, collections, selection, docking, auto-hide, capabilities, cancellation, commands, serialization, history, source integration and disposal. The ten new cases cover hosting defaults/overrides, atomic validation, saved browser intent, grouped document floating and return locations, commands, stale models, floating-control collection events and group close cancellation.

The existing browser suite exercises the standalone bundle and native ES-module graph, real DOM retention, drag/reorder/splits, auto-hide, resizing, menus/keyboard, sample controls, themes, XML import, custom elements, lazy content, same-document iframe movement and legacy PopOut behavior. Its 500-tab case constructs only the active content body; it does not represent 500 heavy editors or establish an FPS guarantee.

`tests/windows.py` serves an HTTP-origin fixture and opens real Chromium browsing contexts through button gestures. The 21 groups cover simultaneous windows, retained editors/listeners, live host conversion, safe close and cancellation, popup denial, child menus and keyboard, nested splitter mouse input, owner/child/child docking, token and capability checks, native within-child tab reorder, layout replacement, undo/redo and explicit resume, actual geometry, style propagation, disable/dispose cleanup, navigation, HTTP reload/storage, declarative options, content-host events, hidden-owner scheduling and maximize/restore.

Cross-document tests dispatch `DragEvent` objects with a `DataTransfer` on the actual owner/child documents to exercise the shared drag pipeline. They are not an end-to-end native window-manager mouse drag. Within-child reorder uses a complete Playwright mouse drag. Splitters and buttons use browser input. The hidden-owner test controls visibility for deterministic scheduler coverage. Physical multi-monitor placement and OS-frame dragging are not tested.

`scripts/verify-site.py` serves the GitHub Pages project base path and checks `index.html`, `standalone.html`, `sample/minimal.html`, and `sample/multi-window.html`. It verifies HTTP assets, application initialization, origin persistence, actual native-window editor movement and retained edits, nested tools and counter behavior, docking back, and screenshots. The Pages deployment job separately checks the live deployment commit and public asset/download URLs.

## Reproduce

```sh
npm ci
npm run check:all
node scripts/package-test.mjs
python -m pip install -r requirements-test.txt
python -m playwright install chromium
# Set CHROMIUM_EXECUTABLE to the installed Playwright Chromium executable.
npm run test:browser
npm run test:windows
python scripts/verify-site.py
```

CI installs the pinned browser-test requirements and exports Playwright's executable path. Tests do not download tools themselves. Node 22/24 and Python 3.12 are the CI matrix. Each browser JSON report records the actual Chromium version.

Local Chromium in the development container restricts HTTP/file navigation. Local checks used inline about:blank fixtures without altering browser policy: all 34 existing groups and 20 multi-window groups passed on Chromium 144.0.7559.96. `python tests/windows.py --offline` omits only genuine HTTP reload/storage. GitHub runs the full 21-group HTTP suite; the reduced local mode is not its release gate.

## Qualification boundaries

No native .NET AvalonDock process was used to certify XML interchange or desktop event ordering. No full WPF runtime parity, screen-reader/WCAG certification, arbitrary document-delegated framework portals, physical touch/stylus, non-Chromium engine or physical multi-monitor qualification is claimed. Same-document iframe retention does not guarantee cross-document iframe context retention. Popup policy, COOP/CSP and browser window-manager restrictions must also be tested in the embedding application.

The independent Blazor CI builds and tests its .NET 8/10 packages and existing WebAssembly/Interactive Server consumers. Those checks do not certify arbitrary Razor content moved into a different native document. Its NuGet version/release cycle is unchanged by the JavaScript 0.2.0 release.
