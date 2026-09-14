"""Offline tests for immutable NuGet verification and bounded publication retries."""
import argparse
import importlib.util
import io
import unittest
import urllib.error
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


class PublicationWaitTests(unittest.TestCase):
    def wait(self, responses, budget=720, interval=10):
        now = [0.0]
        waits, timeouts = [], []
        values = iter(responses)
        def sleep(seconds):
            waits.append(seconds)
            now[0] += seconds
        def fetch(identity, version, *, timeout):
            self.assertEqual((identity, version), ('Example.Blazor', '0.2.1'))
            timeouts.append(timeout)
            result = next(values, None)
            if isinstance(result, Exception):
                raise result
            return result
        result = registry.wait_for_package('Example.Blazor', '0.2.1',
                    timeout_seconds=budget, interval_seconds=interval,
                    fetch=fetch, clock=lambda: now[0], sleep=sleep)
        return result, waits, timeouts

    def test_publication_beyond_old_four_minute_budget(self):
        actual = package()
        result, waits, timeouts = self.wait([None] * 45 + [actual])
        self.assertEqual(result, actual)
        self.assertEqual(sum(waits), 450)
        self.assertTrue(all(0 < value <= 60 for value in timeouts))

    def test_deadline_exhaustion_is_explicit(self):
        with self.assertRaisesRegex(RuntimeError, 'Rerun only the publish job'):
            self.wait([], budget=21)

    def test_transient_http_and_network_errors_retry(self):
        unavailable = urllib.error.HTTPError('https://api.nuget.org/', 503, 'Unavailable', {}, None)
        network = urllib.error.URLError('Temporary network failure')
        expected = package()
        result, waits, _ = self.wait([unavailable, network, TimeoutError(), expected])
        self.assertEqual(result, expected)
        self.assertEqual(waits, [10, 10, 10])

    def test_rate_limit_retry_after_is_honored(self):
        limited = urllib.error.HTTPError('https://api.nuget.org/', 429, 'Limited', {'Retry-After': '25'}, None)
        _, waits, _ = self.wait([limited, package()])
        self.assertEqual(waits, [25])

    def test_permanent_http_error_is_not_retried(self):
        forbidden = urllib.error.HTTPError('https://api.nuget.org/', 403, 'Forbidden', {}, None)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.wait([forbidden, package()])
        self.assertIs(caught.exception, forbidden)

    def test_mismatched_payload_is_not_hidden_by_retries(self):
        result, waits, _ = self.wait([package(body=b'conflicting')])
        self.assertEqual(waits, [])
        with self.assertRaisesRegex(ValueError, 'different payloads'):
            registry.compare(package(), result)

    def test_request_and_sleep_budget_are_bounded(self):
        _, waits, timeouts = self.wait([None, package()], budget=11)
        self.assertEqual(waits, [10])
        self.assertEqual(timeouts, [11, 1])

    def test_timeout_arguments_are_validated(self):
        for value in ('nan', 'inf', '-1', '0', '3601', 'not a number'):
            with self.assertRaises(argparse.ArgumentTypeError):
                registry.positive_seconds(value)
        self.assertEqual(registry.positive_seconds('720'), 720)
        with self.assertRaises(ValueError):
            registry.wait_for_package('Example', '0.2.1', timeout_seconds=float('inf'))
        with self.assertRaises(ValueError):
            registry.wait_for_package('Example', '0.2.1', interval_seconds=0)


if __name__ == '__main__':
    unittest.main()
