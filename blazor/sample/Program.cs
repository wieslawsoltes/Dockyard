using global::Dockyard.Blazor;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using global::Dockyard.Blazor.Sample;
var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.Services.AddDockyardBlazor();
builder.RootComponents.RegisterDockyardBlazor();
builder.RootComponents.Add<Demo>("#app");
await builder.Build().RunAsync();
