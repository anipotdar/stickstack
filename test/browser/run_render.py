import base64, io, json, subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
fails = 0
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True)
        pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:8765/test/browser/render-harness.html')
        pg.wait_for_function('window.ready === true', timeout=10000)
        print('caps', pg.evaluate('window.caps'), errs)
        cases = [
            ('static-lossless.webp', {}, 'image/png', 1),
            ('static-lossy.webp', {'background': 'white', 'padding': 0.1}, 'image/png', 1),
            ('animated.webp', {}, 'image/gif', 12),
            ('animated-10ms.webp', {}, 'image/gif', None),
            ('animated-dupes.webp', {}, 'image/gif', None),
            ('animated.png', {}, 'image/gif', 12),
            ('animated.gif', {}, 'image/gif', 12),
            ('animated.gif', {'padding': 0.2}, 'image/gif', 12),
            ('animated.webp', {'animatedFormat': 'webp'}, 'image/webp', 12),
            ('animated.webp', {'animatedFormat': 'static'}, 'image/png', 1),
            ('animated.webp', {'size': 256, 'background': 'black'}, 'image/gif', 12),
            ('wide-meme.png', {}, 'image/png', 1),
            ('photo.jpg', {}, 'image/png', 1),
            ('truncated.webp', {}, None, None),
            ('not-an-image.webp', {}, None, None),
        ]
        for name, s, want_mime, want_frames in cases:
            r = pg.evaluate('([n, s]) => window.runRender(n, s)', [name, s])
            if not r['ok']:
                ok = want_mime is None
                print(('PASS' if ok else 'FAIL'), name, s, 'error:', r['error'])
                fails += 0 if ok else 1
                continue
            data = base64.b64decode(r['b64'])
            im = Image.open(io.BytesIO(data))
            n = getattr(im, 'n_frames', 1)
            durs = []
            if n > 1:
                for i in range(n):
                    im.seek(i); durs.append(im.info.get('duration'))
                im.seek(0)
            loop = im.info.get('loop')
            transp = im.info.get('transparency') is not None or im.mode in ('RGBA', 'LA', 'PA')
            ok = (r['mime'] == want_mime) and (want_frames is None or n == want_frames)
            fails += 0 if ok else 1
            print(('PASS' if ok else 'FAIL'), name, s, r['mime'], f"{r['w']}x{r['h']}", 'frames', n, 'durs', durs[:13], 'loop', loop, 'alpha', transp, f"{len(data)//1024}KB", f"{r['ms']}ms", r['thumbType'], r['degraded'])
        print('page errors:', errs)
        b.close()
finally:
    srv.terminate()
print('FAILS', fails)
sys.exit(1 if fails else 0)
