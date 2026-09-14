# Dockyard.Blazor 0.2.2

This release hardens the visual component and dynamic Razor root lifetimes while retaining all native docking and advanced interop APIs.

- Concurrent visual component disposal shares one completion task, releases all handles even after native cleanup failure, preserves the failure for repeated callers, and suppresses callbacks queued before removal.
- Template removal waits for an in-flight module import before releasing its handle. Circuit registries reject new registrations after disposal.
- Dynamic template factories return an awaitable disposal fence, coalesce rapid updates, preserve roots during same-turn DOM movement, and release late-created roots and context records.
- `BrowserComponent.IsReady` and `IsDisposed` expose lifecycle state.
- Eight new JavaScript lifecycle regressions, managed visual/template lifecycle checks and actual-package browser tests cover moving, updating and recreating real Razor templates in WebAssembly and Interactive Server.

The package targets .NET 8 and .NET 10 and includes local JavaScript/styles, symbols, and runnable sample artifacts. Publication remains gated on validation and complete public NuGet payload comparison. Desktop API, physical GPU, all-browser and WebView qualification are not claimed.
