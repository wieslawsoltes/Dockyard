# Dockyard

Independent AvalonDock-style docking components for JavaScript and Blazor.

[![CI](https://github.com/wieslawsoltes/Dockyard/actions/workflows/ci.yml/badge.svg)](https://github.com/wieslawsoltes/Dockyard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40wieslawsoltes%2Fdockyard)](https://www.npmjs.com/package/@wieslawsoltes/dockyard)
[![npm downloads](https://img.shields.io/npm/dm/%40wieslawsoltes%2Fdockyard)](https://www.npmjs.com/package/@wieslawsoltes/dockyard)
[![NuGet](https://img.shields.io/nuget/v/Dockyard.Blazor)](https://www.nuget.org/packages/Dockyard.Blazor)
[![NuGet downloads](https://img.shields.io/nuget/dt/Dockyard.Blazor)](https://www.nuget.org/packages/Dockyard.Blazor)
[![Blazor](https://github.com/wieslawsoltes/Dockyard/actions/workflows/blazor.yml/badge.svg)](https://github.com/wieslawsoltes/Dockyard/actions/workflows/blazor.yml)

## JavaScript

```sh
npm install @wieslawsoltes/dockyard
```

The [complete JavaScript guide](README.web.md) preserves the existing API examples, architecture, tests, license notices and native-engine compatibility boundaries. [Open the web demo](https://wieslawsoltes.github.io/Dockyard/).

## Blazor

```sh
dotnet add package Dockyard.Blazor --version 0.2.0
```

The .NET 8/.NET 10 Razor class library supports interactive WebAssembly and Interactive Server, with local JavaScript/CSS assets and no consumer npm/CDN dependency. It includes `DockingManager`, typed `DockContent`, document/tool operations, layout persistence, events and real Razor pane templates.

```razor
@using Dockyard.Blazor
<DockingManager Theme="light" Style="height:600px" />
```

See the [Blazor guide](blazor/README.md), [hosting and interop contract](blazor/INTEGRATION.md), [working sample](blazor/sample/Demo.razor), and [release notes](blazor/RELEASE.md). Native object/function handles and generic interop complement the typed convenience APIs; this is not an exhaustive C# port of a desktop framework.

## Build, samples and releases

```sh
npm ci
npm run build
node blazor/build.mjs
dotnet run --project blazor/sample/Sample.csproj
# Or: dotnet run --project blazor/server/Server.csproj
```

The Server sample is served at `/probe/`. Source builds need the .NET 10 SDK and .NET 8 targeting support. CI packs and inspects the actual nupkg, then tests package-restored consumers in both hosting modes and target frameworks, including native actions, streaming, Razor callbacks and remounting.

`blazor/Version.props` versions NuGet independently of npm. A version-changing main merge publishes after validation using `NUGET_API_KEY` (`NUGET_TOKEN`/`NUGET_KEY` aliases), verifies the public package payload, and creates a `blazor-v*` release with packages, symbols, runnable samples and checksums. Existing npm release behavior is unchanged.

## License

See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and [the JavaScript guide](README.web.md). Native-engine and browser constraints remain applicable.
