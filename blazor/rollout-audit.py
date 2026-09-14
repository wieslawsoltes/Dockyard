"""Read-only, reproducible rollout evidence. Never uploads packages or modifies repositories."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

REPOSITORIES = ('Dockyard', 'TreeDataGridWeb', 'DynamicDataWeb', 'RibbonWeb', 'SkiaSharpWeb', 'ReactiveWeb', 'RBushWeb', 'QuikGraphWeb', 'RichTextWeb')
OUT = Path('artifacts/rollout')
OUT.mkdir(parents=True, exist_ok=True)

def api(repo, path):
    return json.loads(subprocess.check_output(['gh', 'api', f'repos/wieslawsoltes/{repo}/{path}'], text=True))

def inspect(repo):
    directory = OUT / repo
    directory.mkdir()
    branch = api(repo, 'branches/main')
    sha = branch['commit']['sha']
    root = Path('audit-checkouts') / repo
    root.mkdir(parents=True)
    subprocess.run(['git', '-C', str(root), 'init', '-q'], check=True)
    subprocess.run(['git', '-C', str(root), 'fetch', '-q', '--depth=1', f'https://github.com/wieslawsoltes/{repo}.git', sha], check=True)
    subprocess.run(['git', '-C', str(root), 'checkout', '-q', '--detach', 'FETCH_HEAD'], check=True)
    assert subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() == sha
    tracked = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z'], text=True).split('\0')
    extensions = {'.js', '.mjs', '.ts', '.cs', '.csproj', '.razor', '.props', '.targets', '.py', '.md', '.json', '.yml', '.yaml', '.html', '.css'}
    for name in tracked:
        path = Path(name)
        source = root / path
        if not name or not source.is_file() or source.is_symlink() or source.stat().st_size > 5_000_000:
            continue
        if path.suffix not in extensions and path.name not in {'.gitignore', '.gitmodules', 'LICENSE', 'NOTICE'}:
            continue
        destination = directory / 'source' / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    metadata = {
        'repository': repo, 'sha': sha, 'tree': branch['commit']['commit']['tree']['sha'],
        'pulls': api(repo, 'pulls?state=all&per_page=30&sort=updated&direction=desc'),
        'runs': api(repo, 'actions/runs?branch=main&per_page=20')['workflow_runs'],
        'releases': api(repo, 'releases?per_page=10'),
    }
    version = ET.parse(root / 'blazor/Version.props').findtext('.//Version')
    metadata['version'] = version
    identity = f'{repo}.Blazor'
    url = f'https://api.nuget.org/v3-flatcontainer/{identity.lower()}/{version}/{identity.lower()}.{version}.nupkg'
    try:
        with urllib.request.urlopen(url, timeout=45) as response:
            payload = response.read()
        (directory / f'{identity}.{version}.nupkg').write_bytes(payload)
        metadata['nuget'] = {'status': 200, 'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
    except (urllib.error.URLError, TimeoutError) as error:
        metadata['nuget'] = {'status': getattr(error, 'code', None), 'error': str(error)}
    (directory / 'metadata.json').write_text(json.dumps(metadata, indent=2))
    print(f'{repo}: main={sha}, version={version}, NuGet={metadata["nuget"]["status"]}', flush=True)
    return {'repository': repo, 'sha': sha, 'version': version, 'nuget': metadata['nuget'], 'open_prs': [p['number'] for p in metadata['pulls'] if p['state'] == 'open'], 'blazor_releases': [r['tag_name'] for r in metadata['releases'] if r['tag_name'].startswith('blazor-')]}

with ThreadPoolExecutor(max_workers=3) as pool:
    summary = list(pool.map(inspect, REPOSITORIES))
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
