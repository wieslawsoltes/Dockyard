using System.Text.Json;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.JSInterop;

namespace Dockyard.Blazor;

/// <summary>A circuit-scoped registry. Render fragments never cross the JavaScript boundary.</summary>
public sealed class BrowserTemplateRegistry : IDisposable
{
    internal sealed class Registration(object owner, Func<JsonElement, RenderFragment> render)
    {
        internal object? Owner = owner;
        internal Func<JsonElement, RenderFragment>? Render = render;
        internal event Action? Changed;
        internal void Notify() => Changed?.Invoke();
        internal void Stop() { Owner = null; Render = null; Notify(); Changed = null; }
    }
    private readonly Dictionary<string, Registration> _templates = new(StringComparer.Ordinal);
    private readonly object _sync = new();
    internal Registration? Find(string id) { lock (_sync) return _templates.GetValueOrDefault(id); }
    internal void Update(string id, object owner, Func<JsonElement, RenderFragment> render)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 200) throw new ArgumentException("Template IDs must contain 1 to 200 characters.", nameof(id));
        Registration registration;
        lock (_sync)
        {
            if (_templates.TryGetValue(id, out registration!))
            {
                if (!ReferenceEquals(registration.Owner, owner)) throw new InvalidOperationException($"A different template already owns '{id}'. Use a unique ID for each component instance.");
                registration.Render = render;
            }
            else _templates[id] = registration = new(owner, render);
        }
        registration.Notify();
    }
    internal void Remove(string id, object owner)
    {
        Registration? registration;
        lock (_sync)
        {
            if (!_templates.TryGetValue(id, out registration) || !ReferenceEquals(registration.Owner, owner)) return;
            _templates.Remove(id);
        }
        registration.Stop();
    }
    public void Dispose()
    {
        Registration[] registrations;
        lock (_sync) { registrations = _templates.Values.ToArray(); _templates.Clear(); }
        foreach (var registration in registrations) registration.Stop();
    }
}

/// <summary>Declares a typed Razor template for a native DOM factory. Use TItem explicitly in Razor.</summary>
public sealed class BrowserTemplate<TItem> : ComponentBase, IDisposable
{
    [Inject] private BrowserTemplateRegistry Registry { get; set; } = default!;
    [Parameter] public string Id { get; set; } = Guid.NewGuid().ToString("N");
    [Parameter, EditorRequired] public RenderFragment<TItem> ChildContent { get; set; } = default!;
    private string? _registered;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    protected override void OnParametersSet()
    {
        ArgumentNullException.ThrowIfNull(ChildContent);
        if (_registered is not null && _registered != Id) Registry.Remove(_registered, this);
        Registry.Update(Id, this, context => ChildContent(context.Deserialize<TItem>(Json)!));
        _registered = Id;
    }
    protected override bool ShouldRender() => false;
    public void Dispose() { if (_registered is not null) Registry.Remove(_registered, this); _registered = null; }
}

/// <summary>A dynamic root owned by the native host element, not a reparented Blazor render subtree.</summary>
public sealed class BrowserTemplateOutlet : ComponentBase, IAsyncDisposable
{
    [Inject] private BrowserTemplateRegistry Registry { get; set; } = default!;
    [Inject] private IJSRuntime JS { get; set; } = default!;
    [Parameter] public string TemplateId { get; set; } = "";
    [Parameter] public string ContextId { get; set; } = "";
    [Parameter] public int Version { get; set; }
    private BrowserTemplateRegistry.Registration? _registration;
    private IJSObjectReference? _module;
    private JsonElement _context;
    private string? _loadedContext;
    private int _loadedVersion = -1;
    private bool _disposed, _loading;
    protected override void OnParametersSet()
    {
        var next = Registry.Find(TemplateId) ?? throw new InvalidOperationException($"No Razor template is registered as '{TemplateId}' in this circuit.");
        if (ReferenceEquals(next, _registration)) return;
        if (_registration is not null) _registration.Changed -= Refresh;
        _registration = next; next.Changed += Refresh;
    }
    private void Refresh() { if (!_disposed) _ = InvokeAsync(StateHasChanged); }
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        if (_loadedContext is not null && _registration?.Render is { } render) builder.AddContent(0, render(_context));
    }
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (_disposed || _loading || (_loadedContext == ContextId && _loadedVersion == Version)) return;
        _loading = true;
        try
        {
            _module ??= await JS.InvokeAsync<IJSObjectReference>("import", "./_content/Dockyard.Blazor/templates.js");
            var id = ContextId; var version = Version;
            await using var reference = await _module.InvokeAsync<IJSStreamReference>("readContext", id);
            await using var input = await reference.OpenReadStreamAsync(64 * 1024 * 1024);
            using var document = await JsonDocument.ParseAsync(input);
            if (_disposed) return;
            _context = document.RootElement.Clone(); _loadedContext = id; _loadedVersion = version;
        }
        catch (JSDisconnectedException) when (_disposed) { }
        finally { _loading = false; }
        if (!_disposed) StateHasChanged();
    }
    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        if (_registration is not null) _registration.Changed -= Refresh;
        if (_module is not null) { try { await _module.DisposeAsync(); } catch (JSDisconnectedException) { } }
    }
}

public static class DockyardBlazorRegistration
{
    /// <summary>Registers a separate template registry for each WebAssembly app or Server circuit.</summary>
    public static IServiceCollection AddDockyardBlazor(this IServiceCollection services)
    {
        services.TryAddScoped<BrowserTemplateRegistry>(); return services;
    }
    /// <summary>Enables JS-owned Razor roots. Call on WASM RootComponents or Server CircuitOptions.RootComponents.</summary>
    public static void RegisterDockyardBlazor(this IJSComponentConfiguration configuration) => configuration.RegisterForJavaScript<BrowserTemplateOutlet>("Dockyard.Blazor.Template");
}
