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
    private FakeReference? _session, _subscription;
    public FakeReference Session => _session ??= new();
    public FakeReference Subscription => _subscription ??= new();
    public int Opens, NativeDisposals;
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
            case "set": _value = args![2]; break;
            case "get": result = _value; break;
            case "subscribe": result = Subscription; break;
            case "dispose": NativeDisposals++; break;
            default: throw new InvalidOperationException(identifier);
        }
        return ValueTask.FromResult(result is null ? default! : (TValue)result);
    }
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
