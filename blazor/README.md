# Dockyard.Blazor

A .NET 8/.NET 10 Razor class library wrapping the actual Dockyard browser engine. Install `Dockyard.Blazor` version `0.2.2`; runtime JavaScript and styles are included as local static web assets.

## Components

`DockingManager` exposes themes, flow direction, history, native layout references, typed document/tool creation, activation, closing, JSON/XML persistence and undo/redo. Use `Options` and `Module` for additional native properties and APIs. `Ready` signals successful interactive initialization; `Changed` and explicit subscriptions forward native events.

```razor
@using Dockyard.Blazor
<DockingManager @ref="dock" Theme="light" Ready="Initialize" Style="height:600px" />
@code {
    private DockingManager dock = default!;
    private async Task Initialize(Microsoft.JSInterop.IJSObjectReference control)
    {
        await using var handle = await dock.AddDocumentAsync(new DockContent {
            ContentId = "editor", Title = "Editor", Content = "Created from C#"
        });
    }
}
```

`DockContent.Content` accepts `BrowserFunction.RazorTemplate(id, fields: ["Title", "ContentId"])` for interactive Razor pane content. Register `AddDockyardBlazor` and `RegisterDockyardBlazor` on the host before using templates. The [sample](sample/Demo.razor) demonstrates real pane callbacks.

## Integration and qualification

Read [INTEGRATION.md](INTEGRATION.md) for hosting registration, templates, data/streaming protocols, returned function references, ownership and publication. Components initialize after interactive rendering and support both WebAssembly and Server; static SSR only renders a host. NuGet consumers do not need npm or a CDN.

CI restores the produced package into both sample hosts for net8.0 and net10.0, tests actual native operations, managed lifecycle, large JSON/binary transfer, Razor input binding and remounting. It does not qualify physical GPUs, hybrid WebViews or every browser. Native compatibility limits still apply.

## Lifecycle in 0.2.2

`IsReady` and `IsDisposed` expose visual lifecycle state. Concurrent disposal awaits one cleanup operation and retains its failure. Queued callbacks stop after removal; template roots clean up late imports and creation. Factories return awaitable disposal promises and retain roots during synchronous DOM movement. The shared sample tests movement, context updates and recreation in both hosts. Store durable state outside recycled cell components.
