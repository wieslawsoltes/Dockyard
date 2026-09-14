using System.Text.Json;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.JSInterop;

namespace Dockyard.Blazor;

/// <summary>Browser-side callbacks. Module callbacks retain synchronous JavaScript semantics without eval.</summary>
public static class BrowserFunction
{
    public static object RazorTemplate(string id, string? contextProperty = null, string[]? fields = null) => new Dictionary<string, object?> { ["$fn"] = "razor", ["id"] = id, ["component"] = "Dockyard.Blazor.Template", ["contextProperty"] = contextProperty, ["fields"] = fields };
    public static object Property(string path) => new Dictionary<string, object?> { ["$fn"] = "property", ["path"] = path };
    public static object Setter(string path) => new Dictionary<string, object?> { ["$fn"] = "setter", ["path"] = path };
    public static object Constant(object? value) => new Dictionary<string, object?> { ["$fn"] = "constant", ["value"] = value };
    public static object Module(string url, string exportName) => new Dictionary<string, object?> { ["$fn"] = "module", ["url"] = url, ["name"] = exportName };
    public static object DotNet<T>(DotNetObjectReference<T> receiver, string method) where T : class => new Dictionary<string, object?> { ["$fn"] = "dotnet", ["receiver"] = receiver, ["method"] = method };
}

/// <summary>A JavaScript event notification. Synchronous cancellation must run in a browser callback.</summary>
public sealed record BrowserEvent(string Name, JsonElement Data);

/// <summary>A per-owner browser session; do not register it as a singleton in Blazor Server.</summary>
public partial class BrowserModule : IAsyncDisposable
{
    private readonly IJSRuntime _js;
    private readonly string _libraryUrl;
    private readonly object _sync = new();
    private readonly HashSet<BrowserSubscription> _subscriptions = new();
    private IJSObjectReference? _bridge;
    private Task<IJSObjectReference>? _initialization;
    private bool _disposed;
    private Task? _disposal;
    public BrowserModule(IJSRuntime js, string? libraryUrl = null)
    {
        _js = js ?? throw new ArgumentNullException(nameof(js));
        _libraryUrl = libraryUrl ?? "./_content/Dockyard.Blazor/library.js";
    }
    private async Task<IJSObjectReference> InitializeAsync()
    {
        _bridge = await _js.InvokeAsync<IJSObjectReference>("import", "./_content/Dockyard.Blazor/interop.js");
        return await _bridge.InvokeAsync<IJSObjectReference>("open", _libraryUrl);
    }
    private async Task<IJSObjectReference> SessionAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Task<IJSObjectReference> task;
        lock (_sync) { ObjectDisposedException.ThrowIf(_disposed, this); task = _initialization ??= InitializeAsync(); }
        var session = await task.WaitAsync(cancellationToken);
        lock (_sync) ObjectDisposedException.ThrowIf(_disposed, this);
        return session;
    }
    public async ValueTask<string[]> GetExportsAsync(CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeAsync<string[]>("exports", cancellationToken);
    public async ValueTask<IJSObjectReference> CreateAsync(string type, object?[]? arguments = null, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeAsync<IJSObjectReference>("construct", cancellationToken, type, arguments ?? []);
    public async ValueTask<T> InvokeAsync<T>(string exportName, object?[]? arguments = null, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeAsync<T>("invoke", cancellationToken, exportName, arguments ?? []);
    public async ValueTask InvokeVoidAsync(string exportName, object?[]? arguments = null, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeVoidAsync("invoke", cancellationToken, exportName, arguments ?? []);
    public async ValueTask<T> CallAsync<T>(IJSObjectReference target, string method, object?[]? arguments = null, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeAsync<T>("call", cancellationToken, target, method, arguments ?? []);
    public async ValueTask CallVoidAsync(IJSObjectReference target, string method, object?[]? arguments = null, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeVoidAsync("call", cancellationToken, target, method, arguments ?? []);
    public async ValueTask<T> GetAsync<T>(IJSObjectReference? target, string property, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeAsync<T>("get", cancellationToken, target, property);
    public async ValueTask SetAsync(IJSObjectReference target, string property, object? value, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeVoidAsync("set", cancellationToken, target, property, value);
    public async ValueTask<IJSObjectReference> MountAsync(ElementReference host, object options) => await (await SessionAsync()).InvokeAsync<IJSObjectReference>("mount", host, options);
    public async ValueTask UpdateAsync(IJSObjectReference target, object options) => await (await SessionAsync()).InvokeVoidAsync("update", target, options);
    public async ValueTask ReleaseAsync(IJSObjectReference target)
    {
        try { await (await SessionAsync()).InvokeVoidAsync("release", target); }
        finally { await target.DisposeAsync(); }
    }
    private void ForgetSubscription(BrowserSubscription subscription) { lock (_sync) _subscriptions.Remove(subscription); }
    public ValueTask<BrowserSubscription> SubscribeAsync(IJSObjectReference target, string eventName, Func<JsonElement, Task> callback) => SubscribeCoreAsync(target, eventName, callback, false);
    private async ValueTask<BrowserSubscription> SubscribeCoreAsync(IJSObjectReference target, string eventName, Func<JsonElement, Task> callback, bool json)
    {
        ArgumentNullException.ThrowIfNull(callback);
        var reference = DotNetObjectReference.Create(new BrowserSubscription.Receiver(callback));
        IJSObjectReference subscription;
        try { subscription = await (await SessionAsync()).InvokeAsync<IJSObjectReference>(json ? "subscribeJson" : "subscribe", target, eventName, reference); }
        catch { reference.Dispose(); throw; }
        var result = new BrowserSubscription(subscription, reference, ForgetSubscription);
        lock (_sync) { if (!_disposed) { _subscriptions.Add(result); return result; } }
        await result.DisposeAsync();
        throw new ObjectDisposedException(GetType().Name);
    }
    public ValueTask DisposeAsync()
    {
        lock (_sync) return new ValueTask(_disposal ??= DisposeCoreAsync());
    }
    private async Task DisposeCoreAsync()
    {
        Task<IJSObjectReference>? task; BrowserSubscription[] subscriptions;
        lock (_sync) { if (_disposed) return; _disposed = true; task = _initialization; subscriptions = _subscriptions.ToArray(); _subscriptions.Clear(); }
        List<Exception> errors = new();
        foreach (var subscription in subscriptions) { try { await subscription.DisposeAsync(); } catch (Exception error) { errors.Add(error); } }
        try
        {
            if (task is not null)
            {
                var session = await task;
                try { await session.InvokeVoidAsync("dispose"); }
                catch (JSDisconnectedException) { }
                finally { try { await session.DisposeAsync(); } catch (JSDisconnectedException) { } }
            }
        }
        catch (JSDisconnectedException) { }
        catch (Exception error) { errors.Add(error); }
        finally { if (_bridge is not null) { try { await _bridge.DisposeAsync(); } catch (JSDisconnectedException) { } } }
        if (errors.Count > 0) throw new AggregateException(errors);
    }
}

/// <summary>Owns both the browser event listener and the .NET callback reference.</summary>
public sealed class BrowserSubscription : IAsyncDisposable
{
    public sealed class Receiver
    {
        private Func<JsonElement, Task>? _callback;
        public Receiver(Func<JsonElement, Task> callback) => _callback = callback;
        [JSInvokable] public Task Dispatch(JsonElement value) => Volatile.Read(ref _callback)?.Invoke(value) ?? Task.CompletedTask;
        [JSInvokable] public async Task DispatchStream(IJSStreamReference reference)
        {
            await using (reference)
            {
                await using var input = await reference.OpenReadStreamAsync(64 * 1024 * 1024);
                using var document = await JsonDocument.ParseAsync(input);
                await Dispatch(document.RootElement.Clone());
            }
        }
        internal void Stop() => Interlocked.Exchange(ref _callback, null);
    }
    private readonly IJSObjectReference _subscription;
    private readonly DotNetObjectReference<Receiver> _receiver;
    private readonly Action<BrowserSubscription> _onDisposed;
    private readonly object _sync = new();
    private Task? _disposal;
    internal BrowserSubscription(IJSObjectReference subscription, DotNetObjectReference<Receiver> receiver, Action<BrowserSubscription> onDisposed) { _subscription = subscription; _receiver = receiver; _onDisposed = onDisposed; }
    public ValueTask DisposeAsync()
    {
        lock (_sync) return new ValueTask(_disposal ??= DisposeCoreAsync());
    }
    private async Task DisposeCoreAsync()
    {
        _receiver.Value.Stop();
        try { await _subscription.InvokeVoidAsync("dispose"); }
        catch (JSDisconnectedException) { }
        finally
        {
            _onDisposed(this); _receiver.Dispose();
            try { await _subscription.DisposeAsync(); } catch (JSDisconnectedException) { }
        }
    }
}

/// <summary>A JS-owned subtree. Initialization is deferred until interactive rendering.</summary>
public abstract class BrowserComponent : ComponentBase, IAsyncDisposable
{
    [Inject] protected IJSRuntime JS { get; set; } = default!;
    [Parameter] public IReadOnlyDictionary<string, object?>? Options { get; set; }
    [Parameter] public long Revision { get; set; }
    [Parameter] public string? Class { get; set; }
    [Parameter] public string Style { get; set; } = "display:block;height:420px;min-height:0";
    [Parameter] public IReadOnlyList<string>? Events { get; set; }
    [Parameter] public EventCallback<BrowserEvent> Changed { get; set; }
    [Parameter] public EventCallback<IJSObjectReference> Ready { get; set; }
    [Parameter(CaptureUnmatchedValues = true)] public IReadOnlyDictionary<string, object>? AdditionalAttributes { get; set; }
    public BrowserModule? Module { get; private set; }
    public IJSObjectReference? Control { get; private set; }
    protected virtual string HostTag => "div";
    protected virtual IReadOnlyList<string> DefaultEvents => [];
    protected virtual IReadOnlyList<string> RequiredEvents => [];
    protected virtual bool IsJsonEvent(string name) => false;
    protected virtual Dictionary<string, object?> BuildOptions() => Options is null ? new() : new(Options);
    protected virtual Task OnBrowserEventAsync(BrowserEvent notification) => Changed.InvokeAsync(notification);
    protected virtual Task OnBrowserReadyAsync(IJSObjectReference control) => Ready.InvokeAsync(control);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly List<BrowserSubscription> _events = new();
    private ElementReference _host;
    private Dictionary<string, object?>? _last;
    private string[] _eventNames = [];
    private long _revision;
    private bool _disposed;
    private int _disposeStarted;
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenElement(0, HostTag); builder.AddMultipleAttributes(1, AdditionalAttributes);
        builder.AddAttribute(2, "class", Class); builder.AddAttribute(3, "style", Style);
        builder.AddElementReferenceCapture(4, value => _host = value); builder.CloseElement();
    }
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        await _gate.WaitAsync(); var ready = false;
        try
        {
            if (_disposed) return;
            Module ??= new BrowserModule(JS);
            var options = BuildOptions();
            if (Control is null) { Control = await Module.MountAsync(_host, options); ready = true; }
            else if (_last is null || _revision != Revision || _last.Count != options.Count || options.Any(p => !_last.TryGetValue(p.Key, out var old) || !Equals(old, p.Value))) await Module.UpdateAsync(Control, options);
            if (_disposed) return;
            _last = options; _revision = Revision;
            var names = RequiredEvents.Concat(Events ?? DefaultEvents).Distinct().ToArray();
            if (!_eventNames.SequenceEqual(names))
            {
                foreach (var subscription in _events) await subscription.DisposeAsync();
                _events.Clear();
                foreach (var name in names)
                {
                    Task Handle(JsonElement data) => _disposed ? Task.CompletedTask : base.InvokeAsync(() => OnBrowserEventAsync(new BrowserEvent(name, data)));
                    _events.Add(IsJsonEvent(name) ? await Module.SubscribeJsonAsync<JsonElement>(Control, name, Handle) : await Module.SubscribeAsync(Control, name, Handle));
                }
                _eventNames = names;
            }
        }
        finally { _gate.Release(); }
        if (ready && !_disposed) await OnBrowserReadyAsync(Control!);
    }
    public ValueTask<T> InvokeAsync<T>(string method, params object?[] arguments) => Module is not null && Control is not null ? Module.CallAsync<T>(Control, method, arguments) : ValueTask.FromException<T>(new InvalidOperationException("Wait for Ready before accessing the control."));
    public ValueTask<T> InvokeJsonAsync<T>(string method, params object?[] arguments) => Module is not null && Control is not null ? Module.CallJsonAsync<T>(Control, method, arguments) : ValueTask.FromException<T>(new InvalidOperationException("Wait for Ready before accessing the control."));
    public ValueTask<byte[]> InvokeBytesAsync(string method, params object?[] arguments) => Module is not null && Control is not null ? Module.CallBytesAsync(Control, method, arguments) : ValueTask.FromException<byte[]>(new InvalidOperationException("Wait for Ready before accessing the control."));
    public ValueTask InvokeVoidAsync(string method, params object?[] arguments) => Module is not null && Control is not null ? Module.CallVoidAsync(Control, method, arguments) : ValueTask.FromException(new InvalidOperationException("Wait for Ready before accessing the control."));
    public virtual async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposeStarted, 1) != 0) return;
        _disposed = true; await _gate.WaitAsync();
        try { if (Module is not null) await Module.DisposeAsync(); }
        finally
        {
            _events.Clear();
            try { if (Control is not null) await Control.DisposeAsync(); } catch (JSDisconnectedException) { }
            _gate.Release();
        }
    }
}

/// <summary>A lifecycle owner and render-fragment provider for a nonvisual browser engine.</summary>
public class BrowserProvider : ComponentBase, IAsyncDisposable
{
    [Inject] protected IJSRuntime JS { get; set; } = default!;
    [Parameter] public RenderFragment<BrowserModule>? ChildContent { get; set; }
    [Parameter] public RenderFragment? Loading { get; set; }
    [Parameter] public EventCallback<BrowserModule> Ready { get; set; }
    public BrowserModule? Module { get; private set; }
    private bool _disposed, _ready;
    protected override void BuildRenderTree(RenderTreeBuilder builder) { if (_ready && Module is not null) builder.AddContent(0, ChildContent?.Invoke(Module)); else builder.AddContent(1, Loading); }
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!firstRender || _disposed) return;
        Module = new BrowserModule(JS);
        try { await Module.GetExportsAsync(); }
        catch (ObjectDisposedException) when (_disposed) { return; }
        catch (JSDisconnectedException) when (_disposed) { return; }
        if (_disposed) { await Module.DisposeAsync(); return; }
        _ready = true; await Ready.InvokeAsync(Module);
        if (!_disposed) StateHasChanged();
    }
    public async ValueTask DisposeAsync() { _disposed = true; if (Module is not null) await Module.DisposeAsync(); }
}
