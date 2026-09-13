"""Qualify packaged WebAssembly and Interactive Server at non-root paths."""
import argparse, json, pathlib, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright, expect
parser = argparse.ArgumentParser()
parser.add_argument('--wasm', required=True)
parser.add_argument('--server', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
wasm = pathlib.Path(args.wasm).resolve(); server = pathlib.Path(args.server).resolve()
out = pathlib.Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
processes, logs = [], []
def launch(command, cwd, name):
    log = open(out / f'{name}.log', 'w'); logs.append(log)
    processes.append(subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT))
def wait(url):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200: return
        except Exception: pass
        if any(p.poll() is not None for p in processes): raise RuntimeError('A sample process exited before becoming ready')
        time.sleep(.2)
    raise TimeoutError(url)
try:
    launch([sys.executable, '-m', 'http.server', '5081', '--bind', '127.0.0.1'], wasm, 'wasm')
    launch(['dotnet', str(server), '--urls', 'http://127.0.0.1:5080'], server.parent, 'server')
    urls = [('wasm', 'http://127.0.0.1:5081/wwwroot/'), ('server', 'http://127.0.0.1:5080/probe/')]
    for _, url in urls: wait(url)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, url in urls:
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            errors, external, messages = [], [], []
            def report(kind, text):
                messages.append({'kind': kind, 'text': text})
                print(f'[{name}/{kind}] {text}', flush=True)
                if kind in ('error', 'pageerror'): errors.append(text)
            page.on('pageerror', lambda error: report('pageerror', str(error)))
            page.on('console', lambda message: report(message.type, message.text))
            page.on('requestfailed', lambda request: report('requestfailed', f'{request.url}: {request.failure}'))
            page.on('request', lambda request: external.append(request.url) if request.url.startswith(('http:', 'https:')) and not request.url.startswith(('http://127.0.0.1:5080/', 'http://127.0.0.1:5081/')) else None)
            try:
                page.goto(url, wait_until='domcontentloaded')
                expect(page.locator('#status')).to_have_text('Ready', timeout=60000)
                expect(page.locator('#interop-status')).to_have_text('Passed', timeout=60000)
                expect(page.locator('#template-counter')).to_be_visible(timeout=30000)
                page.locator('#template-counter').click()
                expect(page.locator('#template-counter')).to_have_text('Razor count: 1')
                page.locator('#template-input').fill('Razor two-way binding')
                page.locator('#template-input').press('Tab')
                expect(page.locator('#template-value')).to_have_text('Razor two-way binding')
                page.locator('#action').click()
                expect(page.locator('#result')).to_have_text('Passed', timeout=30000)
                page.screenshot(path=str(out / f'{name}.png'), full_page=True)
                page.locator('#toggle').click()
                expect(page.locator('#status')).to_have_text('Unmounted')
                expect(page.locator('#action')).to_be_disabled()
                page.locator('#toggle').click()
                expect(page.locator('#status')).to_have_text('Ready', timeout=60000)
                page.locator('#action').click()
                expect(page.locator('#result')).to_have_text('Passed', timeout=30000)
                assert not errors, f'{name} browser errors: {errors}'
                assert not external, f'{name} unexpectedly required external assets: {external}'
                print(f'{name}: packaged assets, native action, callback, streamed JSON/binary, Razor template, unmount and remount passed', flush=True)
            except Exception:
                page.screenshot(path=str(out / f'{name}-failure.png'), full_page=True)
                (out / f'{name}-failure.html').write_text(page.content())
                raise
            finally:
                (out / f'{name}-console.json').write_text(json.dumps(messages, indent=2))
                page.close()
        browser.close()
finally:
    for process in processes:
        process.terminate()
        try: process.wait(timeout=10)
        except subprocess.TimeoutExpired: process.kill(); process.wait()
    for log in logs: log.close()
