# Dockyard.Blazor 0.2.0

- Add a self-contained .NET 8 / .NET 10 Razor Class Library with DockingManager, typed document options and native engine access.
- Support interactive WebAssembly and Server hosting, prerender-safe initialization, native object references, ordered event callbacks and deterministic disposal.
- Bundle the real Dockyard JavaScript and styles without a consumer npm/CDN requirement.
- Add WebAssembly and Server samples, bridge tests, managed lifecycle checks and actual-package Chromium validation.
- Add independently versioned NuGet and GitHub release publishing after successful validation.

This package wraps the browser engine. Advanced native APIs use the generic interop surface. Razor RenderFragment pane templates and synchronous .NET callbacks into browser-only APIs are not implemented; see the package README for supported callback and ownership patterns.
