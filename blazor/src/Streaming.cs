using System.Text.Json;
using Microsoft.JSInterop;

namespace Dockyard.Blazor;

/// <summary>A sequential native method call in a single interop batch.</summary>
public sealed record BrowserCall(IJSObjectReference Target, string Method, object?[]? Arguments = null);

public partial class BrowserModule
{
    /// <summary>Maximum size accepted by explicit streamed reads. Defaults to 64 MiB.</summary>
    public long MaximumTransferBytes { get; set; } = 64 * 1024 * 1024;
    private static readonly JsonSerializerOptions TransferJson = new(JsonSerializerDefaults.Web);
    private async ValueTask<T> ReadJsonAsync<T>(string operation, IJSObjectReference? target, string member, object?[]? arguments, CancellationToken cancellationToken)
    {
        await using var reference = await (await SessionAsync(cancellationToken)).InvokeAsync<IJSStreamReference>("transfer", cancellationToken, operation, target, member, arguments ?? [], "json", MaximumTransferBytes);
        await using var input = await reference.OpenReadStreamAsync(MaximumTransferBytes, cancellationToken);
        return (await JsonSerializer.DeserializeAsync<T>(input, TransferJson, cancellationToken))!;
    }
    public ValueTask<T> CallJsonAsync<T>(IJSObjectReference target, string method, object?[]? arguments = null, CancellationToken cancellationToken = default) => ReadJsonAsync<T>("call", target, method, arguments, cancellationToken);
    public ValueTask<T> InvokeJsonAsync<T>(string exportName, object?[]? arguments = null, CancellationToken cancellationToken = default) => ReadJsonAsync<T>("invoke", null, exportName, arguments, cancellationToken);
    public ValueTask<T> GetJsonAsync<T>(IJSObjectReference? target, string property, CancellationToken cancellationToken = default) => ReadJsonAsync<T>("get", target, property, null, cancellationToken);
    public ValueTask<JsonElement[]> CallBatchAsync(IReadOnlyList<BrowserCall> calls, CancellationToken cancellationToken = default) => ReadJsonAsync<JsonElement[]>("batch", null, "", [calls], cancellationToken);
    public ValueTask<byte[]> CallBytesAsync(IJSObjectReference target, string method, object?[]? arguments = null, CancellationToken cancellationToken = default) => ReadBytesAsync("call", target, method, arguments, cancellationToken);
    public ValueTask<byte[]> InvokeBytesAsync(string exportName, object?[]? arguments = null, CancellationToken cancellationToken = default) => ReadBytesAsync("invoke", null, exportName, arguments, cancellationToken);
    private async ValueTask<byte[]> ReadBytesAsync(string operation, IJSObjectReference? target, string method, object?[]? arguments, CancellationToken cancellationToken)
    {
        await using var reference = await (await SessionAsync(cancellationToken)).InvokeAsync<IJSStreamReference>("transfer", cancellationToken, operation, target, method, arguments ?? [], "bytes", MaximumTransferBytes);
        await using var input = await reference.OpenReadStreamAsync(MaximumTransferBytes, cancellationToken);
        using var output = new MemoryStream();
        await input.CopyToAsync(output, cancellationToken);
        return output.ToArray();
    }
    /// <summary>Observe JSON DTO values without truncation. Live native object graphs require SubscribeAsync instead.</summary>
    public ValueTask<BrowserSubscription> SubscribeJsonAsync<T>(IJSObjectReference target, string eventName, Func<T, Task> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        return SubscribeCoreAsync(target, eventName, value => callback(value.Deserialize<T>(TransferJson)!), true);
    }
}
