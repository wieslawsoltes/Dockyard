/** Reproducible source reuse for sibling Blazor wrappers. A Git submodule pins this implementation. */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const common = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const config = JSON.parse(readFileSync(resolve(root, 'blazor/config.json'), 'utf8'));
if (!/^[A-Za-z][A-Za-z0-9]*$/.test(config.name)) throw new Error('Invalid package name');
const name = config.name, out = 'blazor/src/wwwroot';
const project = config.project ?? `blazor/src/${name}.Blazor.csproj`;
function write(path, text) { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), text); }
function source(path) { return readFileSync(resolve(common, path), 'utf8').replaceAll('Dockyard', name); }
const copies = {
  'src/WebInterop.cs': 'blazor/src/WebInterop.g.cs',
  'src/wwwroot/interop.js': `${out}/interop.js`,
  'sample/Program.cs': 'blazor/sample/Program.cs',
  'sample/_Imports.razor': 'blazor/sample/_Imports.razor',
  'sample/wwwroot/index.html': 'blazor/sample/wwwroot/index.html',
  'server/Program.cs': 'blazor/server/Program.cs',
  'server/App.razor': 'blazor/server/App.razor',
  'server/_Imports.razor': 'blazor/server/_Imports.razor',
  'tests/Managed/Program.cs': 'blazor/tests/Managed/Program.cs',
  'tests/interop.test.mjs': 'blazor/tests/interop.test.mjs',
  'tests/functions.mjs': 'blazor/tests/functions.mjs',
  'tests/smoke.py': 'blazor/tests/smoke.py',
  'tests/verify_package.py': 'blazor/tests/verify_package.py'
};
for (const [from, to] of Object.entries(copies)) write(to, source(from));
for (const path of ['sample/Sample.csproj', 'server/Server.csproj', 'tests/Managed/Managed.csproj']) {
  const destination = `blazor/${path}`;
  const reference = relative(dirname(destination), project).replaceAll('\\', '/');
  write(destination, source(path).replace(/Include="[^"]+\/src\/[^"]+\.csproj"/g, `Include="${reference}"`));
}
if (!config.existingProject) {
  let text = source('src/Dockyard.Blazor.csproj').replace('<PackageLicenseExpression>MIT</PackageLicenseExpression>', `<PackageLicenseExpression>${config.license ?? 'MIT'}</PackageLicenseExpression>`);
  text = text.replace('<GenerateDocumentationFile>', '<EmbedAllSources>true</EmbedAllSources><GenerateDocumentationFile>');
  write(project, text);
}
mkdirSync(resolve(root, out), { recursive: true });
const arguments_ = ['exec', '--yes', '--package=esbuild@0.28.2', '--', 'esbuild', 'blazor/src/entry.js', '--bundle', '--format=esm', '--platform=browser', '--target=es2022', `--outfile=${out}/library.js`, '--legal-comments=eof'];
for (const external of config.external ?? []) arguments_.push(`--external:${external}`);
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', arguments_, { cwd: root, stdio: 'inherit' });
if (config.css) cpSync(resolve(root, config.css), resolve(root, out, 'styles.css'));
for (const [from, to] of config.copy ?? []) cpSync(resolve(root, from), resolve(root, out, to), { recursive: true });
mkdirSync(resolve(root, out, 'licenses'), { recursive: true });
for (const file of ['LICENSE', 'NOTICE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md']) if (existsSync(resolve(root, file))) cpSync(resolve(root, file), resolve(root, out, 'licenses', file));
cpSync(resolve(common, '../LICENSE'), resolve(root, out, 'licenses', 'BlazorRuntime.LICENSE'));
console.log(`Prepared ${name}.Blazor source, consumers and self-contained browser assets from the pinned runtime source.`);
