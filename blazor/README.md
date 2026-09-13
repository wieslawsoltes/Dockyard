# Dockyard.Blazor

A Razor Class Library for the real Dockyard docking engine, targeting .NET 8 and .NET 10. The NuGet package contains the browser JavaScript, styles, XML API documentation, license and symbols. Consumers do not need npm, a CDN or a global script tag.

```sh
dotnet add package Dockyard.Blazor --version 0.2.0
```

## Component

Use an interactive Blazor WebAssembly or Server render mode. Static prerender emits the host without invoking JavaScript. Initialization occurs after the first interactive render.

```razor
@using Dockyard.Blazor
@using Microsoft.JSInterop
<DockingManager @ref="dock" Theme="light" Ready="Initialize" />
@code {
    private DockingManager dock = default!;
    private async Task Initialize(IJSObjectReference control)
    {
        await using var document = await dock.AddDocumentAsync(new DockContent
        {
            ContentId = "welcome", Title = "Welcome", Content = "Hello from Blazor"
        });
    }
}
```

`Theme`, `FlowDirection`, `EnableHistory`, and native `Layout` references are component parameters. `Options` sets additional native manager properties using their original PascalCase names. `Class`, `Style`, and unmatched HTML attributes configure the host. Use a new options dictionary or increment `Revision` after mutating nested options. Default notifications are `ActiveContentChanged`, `LayoutChanged`, `DocumentClosed`, `ContentMoved`, `HistoryChanged`, and `Error`; replace `Events` to select other native events. `Changed` receives a `BrowserEvent` containing the event name and a JSON-safe snapshot. `Ready` runs only after the native manager exists.

Convenience methods include `AddDocumentAsync`, `AddAnchorableAsync`, `SaveLayoutAsync`, `LoadLayoutAsync`, `UndoAsync`, `RedoAsync`, `FindAsync`, `CloseAsync` and `ActivateAsync`. All other native methods remain accessible through `InvokeAsync<T>` / `InvokeVoidAsync`, with native JavaScript names and argument order. Access `Module` and `Control` after `Ready` for advanced model operations.

## Engine and model interop

`DockyardModule` / `BrowserModule` exposes `GetExportsAsync`, `CreateAsync`, `InvokeAsync<T>`, `CallAsync<T>`, `GetAsync<T>`, `SetAsync`, `SubscribeAsync`, and `ReleaseAsync`. `IJSObjectReference` preserves native object identity and class prototypes; do not replace graph-like layout instances with JSON copies. Use `IJSObjectReference` as the return type for models and `JsonElement` or a serializable DTO for data.

```csharp
await using var pane = await dock.Module!.CreateAsync("LayoutDocumentPane");
await using var children = await dock.Module.GetAsync<IJSObjectReference>(pane, "Children");
await dock.Module.CallVoidAsync(children, "Add", new object?[] { document });
```

The generic bridge gives access to exported JavaScript APIs; it is not an exhaustive strongly typed C# replacement for every JavaScript class. Consult [the native API](../docs/API.md) for complete signatures. Browser-only APIs retain their browser permission and user-activation requirements.

## Callbacks, templates and ownership

`BrowserFunction.Property("id")`, `Setter`, and `Constant` create synchronous browser functions. `BrowserFunction.Module("./callbacks.js", "renderContent")` imports your exported JavaScript function without eval. It can return a DOM node for a native content factory. `BrowserFunction.DotNet` is asynchronous and is suitable only for APIs that explicitly await a promise. Native synchronous cancellation, sorting comparers, and DOM factories cannot synchronously call a Blazor Server circuit; implement those in a JavaScript module. Event notifications observe results and do not implement synchronous event cancellation.

The manager owns its DOM subtree. Do not render Blazor child nodes inside it or move Blazor-owned nodes into floating windows. Razor `RenderFragment` pane templates are not implemented by this wrapper; use a JavaScript content factory or plain text content. Plain model APIs, layout serialization, docking and floating remain available.

Components dispose native resources, event listeners and .NET callback references on unmount, and tolerate disconnected Server circuits. A DOM-removal observer also cleans up an abandoned native control. Services are per component or per circuit, never application singletons. `CreateAsync` and `MountAsync` results are owned by the session. Native objects returned by other calls remain owned by their parent engine unless explicitly released. `IJSObjectReference.DisposeAsync()` releases the interop handle only; `Module.ReleaseAsync()` also invokes native disposal. Retain observable subscription objects and dispose them when no longer needed. Dispose the module to clean up all remaining owned resources.

## Sample applications

Both projects use the same functional docking demo, including document creation, theme changes, native event forwarding and unmount/remount controls.

```sh
npm ci
npm run build
node blazor/build.mjs
dotnet run --project blazor/sample/Sample.csproj
dotnet run --project blazor/server/Server.csproj --urls http://localhost:5080
# Server sample: http://localhost:5080/probe/
```

Serve the published WebAssembly `wwwroot` directory from any static host with a correct base URI and WASM MIME type. The Server example uses `/probe/` intentionally to test subpath asset resolution. Deploy `_content/Dockyard.Blazor` alongside the normal Blazor framework files. A restrictive CSP must permit the scripts, styles and WebAssembly needed by the chosen Blazor hosting model; no eval is used by the wrapper.

## Build, test and release

`dotnet pack blazor/src/Dockyard.Blazor.csproj -c Release -o artifacts/nuget` builds a package after browser assets are prepared. The Blazor workflow validates both target frameworks, runs bridge and managed lifecycle tests, inspects the nupkg, restores the samples from that nupkg instead of a project reference, and drives both samples in Chromium. Browser assertions verify actual document creation and persistence, callback errors, non-root assets and repeated mount/disposal. Artifacts include packages, published samples and screenshots.

The wrapper version is independent of npm and is recorded in `blazor/Version.props`. A version-changing PR merged to main publishes only after all Blazor validation jobs pass. NuGet credentials are read from `NUGET_API_KEY`, falling back to `NUGET_TOKEN` or `NUGET_KEY`; they are never placed in package assets. Releases use `blazor-v<version>` tags to avoid triggering the existing npm tag pipeline. Manual workflow dispatch defaults to validation-only; selecting `publish` retries publication idempotently. GitHub releases attach the package and published WebAssembly sample. Publication failure remains visible as a failed workflow; it is not treated as a successful release.

Existing Dockyard engine compatibility boundaries still apply. Chromium tests do not establish native desktop, assistive-technology, physical touch or all-browser qualification.
