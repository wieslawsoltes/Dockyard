using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Dockyard.Blazor.Sample;
var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<Demo>("#app");
await builder.Build().RunAsync();
