"""Exercise the same packaged wrapper in WASM and Interactive Server, including non-root hosting."""
import argparse, pathlib, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright, expect
parser = argparse.ArgumentParser()
parser.add_argument('--wasm', required=True)
parser.add_argument('--server', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
wasm = pathlib.Path(args.wasm).resolve()
server = pathlib.Path(args.server).resolve()
out = pathlib.Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
processes, logs = [], []
def launch(command, cwd, name):
    log = open(out / f'{name}.log', 'w'); logs.append(log)
    process = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT)
    processes.append(process)
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
            errors, external = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.on('request', lambda request: external.append(request.url) if request.url.startswith(('http:', 'https:')) and not request.url.startswith(('http://127.0.0.1:5080/', 'http://127.0.0.1:5081/')) else None)
            page.goto(url, wait_until='domcontentloaded')
            expect(page.locator('#status')).to_have_text('Ready', timeout=120000)
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
            print(f'{name}: packaged assets, native action, callback, unmount and remount passed')
            page.close()
        browser.close()
finally:
    for process in processes:
        process.terminate()
        try: process.wait(timeout=10)
        except subprocess.TimeoutExpired: process.kill(); process.wait()
    for log in logs: log.close()
