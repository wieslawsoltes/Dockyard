"""Verify NuGet.org payloads, allowing only repository signing to change the ZIP.
Every uncompressed member, including the nuspec, must remain byte-identical.
Only the root .signature.p7s is excluded. This script never uses credentials.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import math
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


def download(identity: str, version: str, *, timeout: float = 60) -> bytes | None:
    identity, version = identity.lower(), version.lower()
    url = f'https://api.nuget.org/v3-flatcontainer/{identity}/{version}/{identity}.{version}.nupkg'
    request = urllib.request.Request(url, headers={'User-Agent': 'BlazorPackageValidation/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def positive_seconds(value: str) -> float:
    try:
        seconds = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError('Timeout must be a number of seconds.') from error
    if not math.isfinite(seconds) or not 1 <= seconds <= 3600:
        raise argparse.ArgumentTypeError('Timeout must be between 1 and 3600 seconds.')
    return seconds


def wait_for_package(identity: str, version: str, *, timeout_seconds: float = 720,
                     interval_seconds: float = 10, fetch=None, clock=None, sleep=None) -> bytes:
    """Wait for publication visibility, never converting permanent errors into absence.

    Injected I/O and clock functions let tests exercise long publication delays instantly.
    A downloaded conflicting payload is rejected by compare(), outside this retry loop.
    """
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError('A finite positive timeout is required.')
    if not math.isfinite(interval_seconds) or interval_seconds <= 0:
        raise ValueError('A finite positive retry interval is required.')
    fetch = fetch or download
    clock = clock or time.monotonic
    sleep = sleep or time.sleep
    started = clock()
    deadline = started + timeout_seconds
    attempt = 0
    last = 'HTTP 404: package is not yet downloadable'
    while (remaining := deadline - clock()) > 0:
        attempt += 1
        retry_delay = interval_seconds
        try:
            actual = fetch(identity, version, timeout=min(60, remaining))
            if actual is not None:
                return actual
            last = 'HTTP 404: package is not yet downloadable'
        except urllib.error.HTTPError as error:
            if error.code not in (408, 429, 500, 502, 503, 504):
                raise
            last = f'HTTP {error.code}'
            try:
                retry_after = float(error.headers.get('Retry-After', '0'))
                if math.isfinite(retry_after) and retry_after > 0:
                    retry_delay = max(retry_delay, retry_after)
            except (AttributeError, ValueError):
                pass
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last = type(error).__name__
        remaining = deadline - clock()
        if remaining <= 0:
            break
        pause = min(retry_delay, remaining)
        print(f'{identity} {version}: waiting for public download '
              f'(attempt {attempt}, elapsed {clock() - started:.0f}s, {last}); '
              f'retrying in {pause:.0f}s.', flush=True)
        sleep(pause)
    raise RuntimeError(f'{identity} {version} was not downloadable within '
                       f'{timeout_seconds:g} seconds after publication ({last}). '
                       'Rerun only the publish job to reuse its validated artifacts; '
                       'do not rebuild or replace an existing package version.')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['check', 'verify'])
    parser.add_argument('directory', type=Path)
    parser.add_argument('--timeout-seconds', type=positive_seconds,
                        default=os.environ.get('NUGET_VERIFY_TIMEOUT_SECONDS', '720'),
                        help='Public download wait budget (default: 720 seconds).')
    args = parser.parse_args()
    packages = list(args.directory.glob('*.nupkg'))
    if len(packages) != 1:
        raise ValueError(f'Expected exactly one package; found {len(packages)}.')
    expected = packages[0].read_bytes()
    identity, version, _ = package_info(expected)
    actual = (wait_for_package(identity, version, timeout_seconds=args.timeout_seconds)
              if args.mode == 'verify' else download(identity, version))
    if actual is not None:
        # A successful response alone is not proof of package integrity. Never
        # retry a payload mismatch or accept a different immutable version.
        compare(expected, actual)
    if path := os.environ.get('GITHUB_OUTPUT'):
        with open(path, 'a', encoding='utf-8') as output:
            output.write(f'exists={str(actual is not None).lower()}\n')
    print(f'{identity} {version}: ' + ('public package payload verified' if actual is not None else 'version available for publication'))


if __name__ == '__main__':
    main()
