# Blazor 0.2.1 — interop lifetime and identity corrections

- Preserve shared and cyclic native argument graphs without recursive stack overflow or mutation.
- Await asynchronous listener cleanup, and continue cleanup after an individual listener fails.
- Make concurrent native and managed module/subscription disposal calls await the same completion fence; repeated failed disposal retains its error.
- Resolve native callable handles consistently for property access, method invocation and disposal.
- Cancel initialization waits without cancelling another caller's shared initialization; pre-cancelled calls allocate nothing.
- Prevent late constructors and mounts from starting after their owning session is disposed.
- Add `CallFunctionJsonAsync<T>` for complete streamed callable results.

Validation includes regression tests, package inspection, managed lifecycle tests and package-restored .NET 8/.NET 10 WebAssembly/Interactive Server browser consumers. Existing engine behavior and compatibility limits are unchanged.
