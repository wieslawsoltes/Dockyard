# Blazor integration contract

## Hosting and initialization

Use an interactive WebAssembly or Interactive Server render mode. Static SSR emits a host but cannot run the browser engine. Components defer JS access until `OnAfterRenderAsync`; wait for `Ready` before using `Control` or `Module`. Assets resolve relative to the application base URI under `_content/Dockyard.Blazor/`; the samples test non-root paths. NuGet consumers require no npm installation or CDN.

For optional Razor factories, add `using Dockyard.Blazor;` and register:

```csharp
builder.Services.AddDockyardBlazor();
// WebAssembly:
builder.RootComponents.RegisterDockyardBlazor();
// Alternatively, on Server:
builder.Services.AddRazorComponents().AddInteractiveServerComponents(
    options => options.RootComponents.RegisterDockyardBlazor());
```

The registry is scoped to the app/circuit, not shared across users. Browser sessions must not be singletons on Server.

## Razor templates

```razor
@using Dockyard.Blazor
@using System.Text.Json
<BrowserTemplate TItem="JsonElement" Id="@templateId" Context="item">
    <button @onclick="Increment">Count: @count</button>
    <input @bind="text" />
</BrowserTemplate>
@code {
    private readonly string templateId = Guid.NewGuid().ToString("N");
    private int count;
    private string text = "";
    private void Increment() => count++;
}
```

Pass `BrowserFunction.RazorTemplate(templateId)` to a native DOM factory slot. Docking uses `DockContent.Content`. Select native-model fields explicitly, for example `fields: ["ContentId", "Title"]`, or select a nested DTO using `contextProperty`. Use unique IDs for independent parent instances.

Templates are independent JS-owned Blazor roots, not reparented Blazor subtrees. Nested components, callbacks and two-way input binding work inside them, including shadow DOM. Captured parent state stays in the parent. Outer cascading values do not automatically cross to an independent root: place required `CascadingValue` components inside the template. Virtualized/recreated roots may lose local component state; keep durable state in application models. Ordinary synchronous DOM moves retain connected roots. Permanent removal disposes roots and context resources.

## Native APIs and callbacks

`BrowserModule` exposes `CreateAsync`, `InvokeAsync`, `CallAsync`, `GetAsync`, `SetAsync`, `GetExportsAsync` and subscriptions. Nested member paths retain the native receiver. Use `InvokeReferenceAsync`, `CallReferenceAsync` or `GetReferenceAsync` when an API returns a function, then `CallFunctionAsync<T>`/`CallFunctionJsonAsync<T>` or pass its opaque handle into another native call. Native function identity is preserved without eval or converting functions to JSON.

`BrowserFunction.Property`, `Setter`, `Constant` and app-authored `Module` callbacks execute in the browser. Synchronous engine selectors/comparers must remain synchronous browser functions. `BrowserFunction.DotNet` is asynchronous and is only appropriate for native APIs accepting promises. A Server circuit cannot synchronously call .NET across a network; cancelling an interop wait does not terminate arbitrary synchronous native computation or independent server work.

## Data and large payloads

`CallJsonAsync`, `InvokeJsonAsync` and `GetJsonAsync` return complete JSON DTOs through bounded streams. `CallBytesAsync`/`InvokeBytesAsync` transfer binary results. The explicit default limit is 64 MiB; `MaximumTransferBytes` controls explicit reads. These APIs do not raise the Server circuit message limit. `CallBatchAsync` runs calls sequentially in one interop request; it is not an atomic transaction.

`SubscribeJsonAsync` is for complete JSON DTO notifications. `SubscribeAsync` creates bounded diagnostic snapshots of live native graphs, so it is not a lossless model serialization API. JSON DTOs are copies, unlike native object handles. Apply edits through typed binding or explicit C# callbacks.

Wrap untrusted application values in `BrowserValue.Literal(value)` when calling generic interop. This prevents reserved-looking `$fn` data from being interpreted as callback descriptors. Do not accept user-controlled module URLs for executable callbacks. Keep synchronous edit validation browser-side when the engine requires an immediate result.

## Ownership and disposal

Await `Ready` before native access. Dispose `BrowserModule` and owned services asynchronously. Dispose borrowed `IJSObjectReference` handles without destroying their native objects. Call `Module.ReleaseAsync` only for native resources you own and intend to destroy. Components serialize updates, detach subscriptions and clean disconnected hosts. Anticipated circuit disconnects are handled during teardown; operational exceptions are not reported as success.

Argument graphs retain cycles and shared aliases. Callback descriptors are resolved without modifying caller-owned data. Concurrent BrowserModule, BrowserSubscription, and native session/resource disposal callers await the same cleanup task. Asynchronous unsubscribe fences are awaited; other resources are still cleaned when one fails. Repeated failed disposal reports the original failure. Cancelling an initialization wait does not abort initialization shared by other callers. These guarantees do not preempt synchronous native computation.

## Builds and publishing

```sh
npm ci
npm run build
node blazor/build.mjs
dotnet pack blazor/src/Dockyard.Blazor.csproj -c Release -o artifacts/nuget
```

Sibling wrappers reuse commit-pinned build sources, not a Dockyard runtime dependency. CI restores the actual nupkg into WebAssembly and Server consumers for net8.0/net10.0 and tests native actions, Unicode/binary streams, returned function references, Razor callbacks and unmount/remount. Native-engine tests remain required. Chromium software tests do not establish physical-GPU, hybrid WebView or all-browser qualification.

`Version.props` owns the independent NuGet version. Version-changing main merges publish after validation using `NUGET_API_KEY` (`NUGET_TOKEN`/`NUGET_KEY` aliases). The workflow rejects conflicting immutable versions, downloads the published package for payload comparison and attaches packages, symbols, samples and checksums to `blazor-v*` releases. `--skip-duplicate` alone is not treated as proof of publication.

## Retrying a publication

NuGet can accept an upload before its public download is available. Verification waits up to 720 seconds, retries not-yet-available packages and transient network/rate-limit/server responses, and fails immediately on a downloaded payload mismatch. `NUGET_VERIFY_TIMEOUT_SECONDS` or `--timeout-seconds` can set a different bounded wait; increase the workflow job timeout too when using a longer budget.

When an upload succeeds but public verification times out, rerun only the failed **publish** job from the original Actions run. It reuses the validated artifact, compares any already-published package, skips a duplicate upload when the payload matches, and completes the release. Do not rebuild an already-published version or disable payload verification. Package comparison excludes only NuGet's root repository-signature member, not assemblies, static assets or the nuspec.
