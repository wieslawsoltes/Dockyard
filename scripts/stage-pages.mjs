/** Stage only the public application and its documented downloads, not CI internals. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, '_site');
fs.rmSync(site, {recursive: true, force: true});
fs.mkdirSync(site, {recursive: true});
for (const name of ['index.html', 'standalone.html', 'src', 'dist', 'sample', 'docs', 'README.md', 'LICENSE', 'NOTICE.md', '.nojekyll']) {
  fs.cpSync(path.join(root, name), path.join(site, name), {recursive: true});
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
fs.writeFileSync(path.join(site, 'deployment.json'), JSON.stringify({repository: 'wieslawsoltes/Dockyard', commit, builtAt: new Date().toISOString()}, null, 2) + '\n');
const downloads = path.join(site, 'downloads');
fs.mkdirSync(downloads);
execFileSync('git', ['archive', '--format=zip', '--output=' + path.join(downloads, 'dockyard-source.zip'), 'HEAD'], {cwd: root});
execFileSync('npm', ['pack', '--pack-destination', downloads], {cwd: root, stdio: 'inherit'});
console.log(`Staged ${site} from ${commit}`);
