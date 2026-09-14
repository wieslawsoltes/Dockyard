using Dockyard.Blazor;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.JSInterop;

static void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
var js = new FakeRuntime();
var module = new BrowserModule(js);
await Task.WhenAll(module.GetExportsAsync().AsTask(), module.GetExportsAsync().AsTask());
Check(js.Imports == 1 && js.Bridge.Opens == 1, "Concurrent initialization must import exactly once.");
var target = await module.CreateAsync("Model", [1]);
await module.SetAsync(target, "Value", 7);
Check(await module.GetAsync<int>(target, "Value") == 7, "Get/Set must reach the JavaScript session.");
var subscription = await module.SubscribeAsync(target, "Changed", _ => Task.CompletedTask);
await subscription.DisposeAsync(); await subscription.DisposeAsync();
Check(js.Session.Subscription.NativeDisposals == 1, "Event disposal must be idempotent.");
using (var cancellation = new CancellationTokenSource())
{
    cancellation.Cancel();
    try { await module.GetExportsAsync(cancellation.Token); throw new Exception("Expected cancellation."); }
    catch (OperationCanceledException) { }
}
await module.DisposeAsync(); await module.DisposeAsync();
Check(js.Session.NativeDisposals == 1, "Session disposal must be idempotent.");
try { await module.GetExportsAsync(); throw new Exception("Expected ObjectDisposedException."); }
catch (ObjectDisposedException) { }
var cancelledJs = new FakeRuntime();
await using (var cancelledModule = new BrowserModule(cancelledJs))
{
    using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
    try { await cancelledModule.GetExportsAsync(cancelled.Token); throw new Exception("Expected cancellation."); }
    catch (OperationCanceledException) { }
    Check(cancelledJs.Imports == 0, "Pre-cancelled operations must not allocate a browser session.");
}
var blockingJs = new BlockingRuntime();
await using (var blockingModule = new BrowserModule(blockingJs))
{
    using var cancelled = new CancellationTokenSource();
    var waiting = blockingModule.GetExportsAsync(cancelled.Token).AsTask();
    cancelled.Cancel();
    try { await waiting.WaitAsync(TimeSpan.FromSeconds(2)); throw new Exception("Expected cancellation."); }
    catch (OperationCanceledException) { }
    finally { blockingJs.Import.TrySetResult(blockingJs.Bridge); }
    Check((await blockingModule.GetExportsAsync()).Length == 1, "Cancellation must not cancel shared initialization for another caller.");
}
var disposalJs = new FakeRuntime();
var disposalModule = new BrowserModule(disposalJs);
await disposalModule.GetExportsAsync();
disposalJs.Session.DisposeBarrier = new(TaskCreationOptions.RunContinuationsAsynchronously);
var disposalOne = disposalModule.DisposeAsync().AsTask();
var disposalTwo = disposalModule.DisposeAsync().AsTask();
Check(!disposalTwo.IsCompleted, "Concurrent module disposal must await the native cleanup fence.");
disposalJs.Session.DisposeBarrier.SetResult();
await Task.WhenAll(disposalOne, disposalTwo);
Check(disposalJs.Session.NativeDisposals == 1, "Concurrent module disposal must only execute once.");
var subscriptionJs = new FakeRuntime();
await using (var subscriptionModule = new BrowserModule(subscriptionJs))
{
    var native = await subscriptionModule.CreateAsync("Model");
    var subscribed = await subscriptionModule.SubscribeAsync(native, "Changed", _ => Task.CompletedTask);
    subscriptionJs.Session.Subscription.DisposeBarrier = new(TaskCreationOptions.RunContinuationsAsynchronously);
    var first = subscribed.DisposeAsync().AsTask(); var second = subscribed.DisposeAsync().AsTask();
    Check(!second.IsCompleted, "Concurrent subscription disposal must await native cleanup.");
    subscriptionJs.Session.Subscription.DisposeBarrier.SetResult();
    await Task.WhenAll(first, second);
    Check(subscriptionJs.Session.Subscription.NativeDisposals == 1, "Subscription cleanup must run once.");
}
// The visual component must share its completion fence, not just the nonvisual module.
var componentJs = new FakeRuntime();
var component = new InteractiveProbe();
await component.InitializeAsync(componentJs);
Check(component.IsReady, "Ready state must follow a completed mount.");
componentJs.Session.DisposeBarrier = new(TaskCreationOptions.RunContinuationsAsynchronously);
var componentFirst = component.DisposeAsync().AsTask();
var componentSecond = component.DisposeAsync().AsTask();
Check(component.IsDisposed && !component.IsReady && !componentSecond.IsCompleted, "Concurrent visual cleanup must await the same native fence.");
componentJs.Session.DisposeBarrier.SetResult();
await Task.WhenAll(componentFirst, componentSecond);
Check(component.Control is null && componentJs.Session.Mounted.HandleDisposals == 1, "Cleanup must release and clear the visual control handle once.");

var failureJs = new FakeRuntime();
var failedComponent = new InteractiveProbe();
await failedComponent.InitializeAsync(failureJs);
failureJs.Session.DisposeFailure = new InvalidOperationException("native cleanup failed");
for (var attempt = 0; attempt < 2; attempt++)
{
    try { await failedComponent.DisposeAsync(); throw new Exception("Expected cleanup failure."); }
    catch (AggregateException) { }
}
Check(failureJs.Session.NativeDisposals == 1 && failureJs.Session.Mounted.HandleDisposals == 1, "Failure must still release the handle, run once and remain observable.");

var lateJs = new BlockingRuntime();
var outlet = new BrowserTemplateOutlet();
typeof(BrowserTemplateOutlet).GetProperty("JS", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.SetValue(outlet, lateJs);
var loading = (Task)typeof(BrowserTemplateOutlet).GetMethod("OnAfterRenderAsync", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.Invoke(outlet, [true])!;
var outletFirst = outlet.DisposeAsync().AsTask();
var outletSecond = outlet.DisposeAsync().AsTask();
Check(!outletSecond.IsCompleted, "Template disposal must wait for a late module import.");
lateJs.Import.SetResult(lateJs.Bridge);
await Task.WhenAll(loading, outletFirst, outletSecond);
Check(lateJs.Bridge.HandleDisposals == 1, "A removed template must release a module imported after removal exactly once.");

var prerenderJs = new FakeRuntime();
var services = new ServiceCollection().AddLogging().AddSingleton<IJSRuntime>(prerenderJs).BuildServiceProvider();
await using (var renderer = new HtmlRenderer(services, services.GetRequiredService<ILoggerFactory>()))
{
    await renderer.Dispatcher.InvokeAsync(async () =>
    {
        var result = await renderer.RenderComponentAsync<ProbeComponent>();
        Check(result.ToHtmlString().Contains("<div"), "Prerender must produce the host.");
        await renderer.RenderComponentAsync<BrowserProvider>();
    });
}
Check(prerenderJs.Imports == 0, "Static prerender must not call JavaScript.");
Console.WriteLine("Managed lifecycle, cancellation, references, and static prerender passed.");

public sealed class ProbeComponent : BrowserComponent { }
public sealed class InteractiveProbe : BrowserComponent
{
    public Task InitializeAsync(IJSRuntime js) { JS = js; return OnAfterRenderAsync(true); }
}
public sealed class FakeRuntime : IJSRuntime
{
    public int Imports;
    public FakeReference Bridge { get; } = new();
    public FakeReference Session => Bridge.Session;
    public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => InvokeAsync<TValue>(identifier, default, args);
    public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (identifier != "import") throw new InvalidOperationException(identifier);
        Imports++; return ValueTask.FromResult((TValue)(object)Bridge);
    }
}
public sealed class FakeReference : IJSObjectReference
{
    private FakeReference? _session, _subscription, _mounted;
    public FakeReference Mounted => _mounted ??= new();
    public Exception? DisposeFailure;
    public int HandleDisposals;
    public FakeReference Session => _session ??= new();
    public FakeReference Subscription => _subscription ??= new();
    public int Opens, NativeDisposals;
    public TaskCompletionSource? DisposeBarrier;
    private async Task<T> WaitDispose<T>() { await DisposeBarrier!.Task; return default!; }
    private object? _value;
    public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => InvokeAsync<TValue>(identifier, default, args);
    public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
    {
        cancellationToken.ThrowIfCancellationRequested();
        object? result = null;
        switch (identifier)
        {
            case "open": Opens++; result = Session; break;
            case "exports": result = new[] { "Model" }; break;
            case "construct": result = new FakeReference(); break;
            case "mount": result = Mounted; break;
            case "set": _value = args![2]; break;
            case "get": result = _value; break;
            case "subscribe": result = Subscription; break;
            case "dispose": NativeDisposals++; if (DisposeFailure is not null) return ValueTask.FromException<TValue>(DisposeFailure); if (DisposeBarrier is not null) return new ValueTask<TValue>(WaitDispose<TValue>()); break;
            default: throw new InvalidOperationException(identifier);
        }
        return ValueTask.FromResult(result is null ? default! : (TValue)result);
    }
    public ValueTask DisposeAsync() { HandleDisposals++; return ValueTask.CompletedTask; }
}
public sealed class BlockingRuntime : IJSRuntime
{
    public TaskCompletionSource<IJSObjectReference> Import { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public FakeReference Bridge { get; } = new();
    public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => InvokeAsync<T>(identifier, default, args);
    public async ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken cancellationToken, object?[]? args)
    {
        if (identifier != "import") throw new InvalidOperationException(identifier);
        return (T)(object)await Import.Task.WaitAsync(cancellationToken);
    }
}
