"""Web converter test: python3 test/browser/run_web.py [/path/to/chrome]"""
import glob, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CHROME = sys.argv[1] if len(sys.argv) > 1 else '/usr/bin/google-chrome'
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
ok = True
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, headless=True)
        for vp, label in [({'width': 1200, 'height': 900}, 'desktop'), ({'width': 390, 'height': 844}, 'mobile')]:
            pg = b.new_page(viewport=vp)
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto('http://127.0.0.1:8766/web/')
            files = [f for f in sorted(glob.glob(os.path.join(ROOT, 'test/fixtures/*')))]
            pg.set_input_files('#in-files', files)
            time.sleep(0.5)
            pg.evaluate('() => window.__stickstack.whenIdle()')
            st = pg.evaluate('() => ({items: window.__stickstack.items.length, ok: window.__stickstack.items.filter(i => i.out).length, gif: window.__stickstack.items.filter(i => i.out && i.out.ext === "gif").length, skipped: window.__stickstack.skipped.length})')
            summary = pg.inner_text('#summary')
            print(label, st, '|', summary, '| errors:', errs)
            ok &= st['ok'] >= 14 and st['gif'] >= 5 and not errs
            # Change a setting → everything re-renders
            pg.select_option('#o-bg', 'white')
            time.sleep(0.3)
            pg.evaluate('() => window.__stickstack.whenIdle()')
            with pg.expect_download() as dl:
                pg.click('#zip-all')
            size = os.path.getsize(dl.value.path())
            print(label, 'zip bytes', size)
            ok &= size > 50000
            pg.screenshot(path=f'/tmp/ss-web-{label}.png', full_page=False)
            pg.close()
        b.close()
finally:
    srv.terminate()
print('WEB OK' if ok else 'WEB FAIL')
sys.exit(0 if ok else 1)
