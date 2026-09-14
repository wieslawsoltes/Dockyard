"""Offline tests for immutable NuGet package verification."""
import importlib.util
import io
import unittest
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

path = Path(__file__).resolve().parents[1] / 'nuget-registry.py'
spec = importlib.util.spec_from_file_location('registry', path)
registry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registry)


def package(body=b'validated assembly', signed=False, extra=False, version='0.2.0'):
    buffer = io.BytesIO()
    with ZipFile(buffer, 'w', compression=ZIP_DEFLATED) as archive:
        archive.writestr('Example.nuspec', f'<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd"><metadata><id>Example.Blazor</id><version>{version}</version></metadata></package>')
        archive.writestr('lib/net8.0/Example.Blazor.dll', body)
        if signed:
            archive.writestr('.signature.p7s', b'repository signature')
        if extra:
            archive.writestr('staticwebassets/unexpected.js', b'changed')
    return buffer.getvalue()


class RegistryTests(unittest.TestCase):
    def test_same_payload(self):
        registry.compare(package(), package())
    def test_repository_signature_is_only_allowed_difference(self):
        registry.compare(package(), package(signed=True))
    def test_changed_assembly_rejected(self):
        with self.assertRaises(ValueError):
            registry.compare(package(), package(body=b'other assembly', signed=True))
    def test_extra_member_rejected(self):
        with self.assertRaises(ValueError):
            registry.compare(package(), package(extra=True))
    def test_version_mismatch_rejected(self):
        with self.assertRaises(ValueError):
            registry.compare(package(), package(version='0.3.0'))
    def test_invalid_archive_rejected(self):
        with self.assertRaises(Exception):
            registry.package_info(b'not a package')


if __name__ == '__main__':
    unittest.main()
