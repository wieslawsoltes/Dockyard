using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
namespace Dockyard.Blazor;

public sealed class DockContent
{
    [JsonPropertyName("ContentId")] public string? ContentId { get; set; }
    [JsonPropertyName("Title")] public string Title { get; set; } = "Document";
    [JsonPropertyName("Content")] public object? Content { get; set; }
    [JsonPropertyName("CanClose")] public bool CanClose { get; set; } = true;
    [JsonPropertyName("CanFloat")] public bool CanFloat { get; set; } = true;
    [JsonExtensionData] public Dictionary<string, object?>? AdditionalProperties { get; set; }
}
/// <summary>Docking, floating, auto-hide and layout persistence backed by the real Dockyard manager.</summary>
public sealed class DockingManager : BrowserComponent
{
    [Parameter] public string Theme { get; set; } = "light";
    [Parameter] public string FlowDirection { get; set; } = "LeftToRight";
    [Parameter] public bool EnableHistory { get; set; } = true;
    [Parameter] public IJSObjectReference? Layout { get; set; }
    protected override IReadOnlyList<string> DefaultEvents => ["ActiveContentChanged", "LayoutChanged", "DocumentClosed", "ContentMoved", "HistoryChanged", "Error"];
    protected override Dictionary<string, object?> BuildOptions()
    {
        var values = base.BuildOptions(); values["Theme"] = Theme; values["FlowDirection"] = FlowDirection; values["EnableHistory"] = EnableHistory;
        if (Layout is not null) values["Layout"] = Layout;
        return values;
    }
    public ValueTask<IJSObjectReference> AddDocumentAsync(DockContent content) => InvokeAsync<IJSObjectReference>("AddDocument", content);
    public ValueTask<IJSObjectReference> AddAnchorableAsync(DockContent content, string side = "Left") => InvokeAsync<IJSObjectReference>("AddAnchorable", content, side);
    public ValueTask<string> SaveLayoutAsync(string format = "json") => InvokeJsonAsync<string>("SaveLayout", format);
    public ValueTask LoadLayoutAsync(string layout, string format = "json") => InvokeVoidAsync("LoadLayout", layout, format);
    public ValueTask<bool> UndoAsync() => InvokeAsync<bool>("Undo");
    public ValueTask<bool> RedoAsync() => InvokeAsync<bool>("Redo");
    public ValueTask<IJSObjectReference> FindAsync(string contentId) => InvokeAsync<IJSObjectReference>("Find", contentId);
    public ValueTask<bool> CloseAsync(IJSObjectReference item) => InvokeAsync<bool>("Close", item);
    public ValueTask<bool> ActivateAsync(IJSObjectReference item) => InvokeAsync<bool>("Activate", item);
}
public sealed class DockyardModule(IJSRuntime js) : BrowserModule(js);
