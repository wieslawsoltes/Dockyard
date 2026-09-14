"""Verify NuGet.org payloads, allowing only repository signing to change the ZIP.
Every uncompressed member, including the nuspec, must remain byte-identical.
Only the root .signature.p7s is excluded. This script never uses credentials.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import os
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile


def package_info(data: bytes) -> tuple[str, str, dict[str, str]]:
    with ZipFile(io.BytesIO(data)) as archive:
        names = [item.filename for item in archive.infolist() if not item.is_dir()]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate package members are not accepted.')
        manifests = [name for name in names if '/' not in name and name.endswith('.nuspec')]
        if len(manifests) != 1:
            raise ValueError('Expected one root nuspec.')
        root = ET.fromstring(archive.read(manifests[0]))
        def field(name: str) -> str:
            element = root.find(f'.//{{*}}metadata/{{*}}{name}')
            if element is None or not element.text:
                raise ValueError(f'Missing package {name}.')
            return element.text
        identity, version = field('id'), field('version')
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', identity):
            raise ValueError('Invalid package identity.')
        if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version):
            raise ValueError('Use a normalized three-part NuGet version.')
        payload = {name: hashlib.sha256(archive.read(name)).hexdigest()
                   for name in names if name != '.signature.p7s'}
        return identity, version, payload


def compare(expected: bytes, actual: bytes) -> None:
    local_id, local_version, local = package_info(expected)
    remote_id, remote_version, remote = package_info(actual)
    if (local_id.lower(), local_version.lower()) != (remote_id.lower(), remote_version.lower()):
        raise ValueError('Public package identity/version differs from the validated package.')
    if local != remote:
        changed = sorted(name for name in local.keys() | remote.keys() if local.get(name) != remote.get(name))
        raise ValueError('Immutable NuGet version has different payloads: ' + ', '.join(changed[:20]))


def download(identity: str, version: str) -> bytes | None:
    identity, version = identity.lower(), version.lower()
    url = f'https://api.nuget.org/v3-flatcontainer/{identity}/{version}/{identity}.{version}.nupkg'
    request = urllib.request.Request(url, headers={'User-Agent': 'BlazorPackageValidation/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['check', 'verify'])
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    packages = list(args.directory.glob('*.nupkg'))
    if len(packages) != 1:
        raise ValueError(f'Expected exactly one package; found {len(packages)}.')
    expected = packages[0].read_bytes()
    identity, version, _ = package_info(expected)
    attempts = 24 if args.mode == 'verify' else 1
    for attempt in range(attempts):
        actual = download(identity, version)
        if actual is not None:
            compare(expected, actual)
            break
        if attempt + 1 < attempts:
            time.sleep(10)
    if actual is None and args.mode == 'verify':
        raise RuntimeError(f'{identity} {version} was not downloadable after publication.')
    if path := os.environ.get('GITHUB_OUTPUT'):
        with open(path, 'a', encoding='utf-8') as output:
            output.write(f'exists={str(actual is not None).lower()}\n')
    print(f'{identity} {version}: ' + ('public package payload verified' if actual is not None else 'version available for publication'))


if __name__ == '__main__':
    main()
