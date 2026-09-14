using Microsoft.JSInterop;
using System.Text.Json.Serialization;
namespace Dockyard.Blazor;

/// <summary>Application data whose reserved-looking keys must not be interpreted as callbacks.</summary>
public sealed record BrowserLiteral([property: JsonPropertyName("$literal")] object? Value);
public static class BrowserValue
{
    public static BrowserLiteral Literal(object? value) => new(value);
}
public partial class BrowserModule
{
    /// <summary>Return native objects or opaque callable references. Dispose handles after use.</summary>
    public async ValueTask<IJSObjectReference> InvokeReferenceAsync(string name, object?[]? arguments = null, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeAsync<IJSObjectReference>("invokeReference", cancellationToken, name, arguments ?? []);
    public async ValueTask<IJSObjectReference> CallReferenceAsync(IJSObjectReference target, string name, object?[]? arguments = null, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeAsync<IJSObjectReference>("callReference", cancellationToken, target, name, arguments ?? []);
    public async ValueTask<IJSObjectReference> GetReferenceAsync(IJSObjectReference? target, string name, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeAsync<IJSObjectReference>("getReference", cancellationToken, target, name);
    public async ValueTask<T> CallFunctionAsync<T>(IJSObjectReference function, object?[]? arguments = null, CancellationToken cancellationToken = default) => await (await SessionAsync(cancellationToken)).InvokeAsync<T>("callFunction", cancellationToken, function, arguments ?? []);
    /// <summary>Call a native function and stream its complete JSON result.</summary>
    public ValueTask<T> CallFunctionJsonAsync<T>(IJSObjectReference function, object?[]? arguments = null, CancellationToken cancellationToken = default) => ReadJsonAsync<T>("function", function, "", arguments, cancellationToken);
}
