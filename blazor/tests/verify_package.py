import pathlib, sys, zipfile, xml.etree.ElementTree as ET
folder = pathlib.Path(sys.argv[1])
packages = list(folder.glob('*.nupkg'))
assert packages, 'No NuGet packages were produced'
for path in packages:
    with zipfile.ZipFile(path) as package:
        names = package.namelist()
        assert any(n.startswith('lib/net8.0/') and n.endswith('.dll') for n in names), 'Missing .NET 8 assembly'
        assert any(n.startswith('lib/net10.0/') and n.endswith('.dll') for n in names), 'Missing .NET 10 assembly'
        for asset in ['library.js', 'interop.js']:
            matches = [n for n in names if n.startswith('staticwebassets/') and n.endswith('/' + asset)]
            assert matches, f'Missing packaged static asset: {asset}'
            assert len(package.read(matches[0])) > 100, f'Empty asset: {asset}'
        assert 'README.md' in names, 'Missing NuGet README'
        assert 'LICENSE' in names, 'Missing license'
        assert not any('/node_modules/' in n or n.endswith('.env') for n in names), 'Unexpected development content'
        spec = ET.fromstring(package.read(next(n for n in names if n.endswith('.nuspec'))))
        print(f'Validated {path.name}: {len(names)} entries')
