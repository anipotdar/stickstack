"""End-to-end test: loads the unpacked extension in Chrome and drives every surface.

Requires: pip install playwright ; a Chrome/Chromium that still honours --load-extension
(Chrome for Testing or Chromium). Run: python3 test/browser/run_extension.py [/path/to/chrome]
"""
import base64
import glob
import os
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_EXT = os.environ.get("STICKSTACK_EXT") or os.path.join(ROOT, "extension")


def test_copy(src):
    """Copy the extension with open shadow roots (production uses closed ones) so Playwright can see the UI."""
    import shutil

    dst = os.path.join(tempfile.mkdtemp(prefix="stickstack-ext-"), "extension")
    shutil.copytree(src, dst)
    for rel in ("content/substack.js", "content/voice.js", "content/whatsapp.js"):
        path = os.path.join(dst, rel)
        with open(path, encoding="utf-8") as f:
            code = f.read()
        assert "const SHADOW_MODE = 'closed';" in code, rel
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(code.replace("const SHADOW_MODE = 'closed';", "const SHADOW_MODE = 'open';"))
    return dst


EXT = test_copy(SRC_EXT)
FIX = os.path.join(ROOT, "test", "fixtures")
CHROME = sys.argv[1] if len(sys.argv) > 1 else "/usr/bin/google-chrome"

results = []


def poll(fn, timeout=15, interval=0.2):
    """Poll a Python predicate (extension pages forbid eval, so no wait_for_function there)."""
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception:
            pass
        time.sleep(interval)
    raise TimeoutError("condition not met")


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


SUBSTACK = """<!doctype html><html><head><meta charset=utf-8><title>Mock Substack</title></head>
<body style="font-family:sans-serif;margin:0;background:#fff">
<div id="wrap" style="padding:40px">
 <div id="composer" style="width:600px;border:1px solid #ccc;padding:10px;border-radius:8px">
  <div id="ed" class="ProseMirror" contenteditable="true" style="min-height:80px;outline:none">What's on your mind?</div>
  <div id="attachments"></div>
  <input type="file" id="file" accept="image/*" style="display:none">
 </div>
</div>
<script>
const mode = new URLSearchParams(location.search).get('mode') || 'paste';
window.__got = [];
function attach(f){ window.__got.push({name:f.name,type:f.type,size:f.size}); const img=document.createElement('img'); img.src=URL.createObjectURL(f); img.width=100; document.getElementById('attachments').appendChild(img); }
const ed = document.getElementById('ed');
if (mode==='paste' || mode==='dialog') ed.addEventListener('paste', e => { const f=[...e.clipboardData.files]; if(f.length){ e.preventDefault(); f.forEach(attach);} });
if (mode==='input') document.getElementById('file').addEventListener('change', e => [...e.target.files].forEach(attach));
else document.getElementById('file').remove();
if (mode==='drop') { ed.addEventListener('dragover', e=>e.preventDefault()); ed.addEventListener('drop', e => { e.preventDefault(); [...e.dataTransfer.files].forEach(attach); }); }
if (mode==='dialog') {
  // Modal with a transform (new containing block) and a focus trap, like Radix dialogs.
  const dlg = document.createElement('div');
  dlg.setAttribute('role','dialog'); dlg.setAttribute('aria-modal','true');
  dlg.style.cssText='position:fixed;left:50%;top:80px;transform:translateX(-50%);background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.3);padding:20px;border-radius:12px';
  dlg.appendChild(document.getElementById('composer'));
  document.body.appendChild(dlg);
  document.addEventListener('focusin', e => { if (!dlg.contains(e.target)) { window.__trapFired = (window.__trapFired||0)+1; ed.focus(); } });
  window.__outside = 0;
  document.addEventListener('pointerdown', e => { if (!dlg.contains(e.target)) window.__outside++; });
}
</script></body></html>"""


def wa_page():
    def b64(n):
        return base64.b64encode(open(os.path.join(FIX, n), "rb").read()).decode()

    return f"""<!doctype html><html><head><meta charset=utf-8><title>Mock WhatsApp</title></head><body>
<div id="chat"></div>
<script>
const files = {{"s1": ["{b64('static-lossy.webp')}","image/webp"], "a1": ["{b64('animated.webp')}","image/webp"], "photo": ["{b64('photo.jpg')}","image/jpeg"], "c1": ["{b64('cats.wastickers')}","application/zip"]}};
function blobUrl(k){{ const [b,t]=files[k]; const s=atob(b); const u=new Uint8Array(s.length); for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i); return URL.createObjectURL(new Blob([u],{{type:t}})); }}
for (const k of ['s1','a1','photo']) {{ const i=document.createElement('img'); i.src=blobUrl(k); i.width=120; document.getElementById('chat').appendChild(i); }}
// a sticker that arrives later (lazy loaded tray)
setTimeout(()=>{{ const d=document.createElement('div'); d.style.cssText='width:120px;height:120px;background-size:contain;background-image:url('+blobUrl('s1')+')'; document.body.appendChild(d); }}, 1500);
</script></body></html>"""


def main():
    user_dir = tempfile.mkdtemp(prefix="ss-profile-")
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_dir,
            executable_path=CHROME,
            headless=True,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
            viewport={"width": 1280, "height": 900},
        )
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
        ext_id = sw.url.split("/")[2]
        check("service worker started", ext_id, ext_id)
        errors = []

        def watch(page, label):
            page.on("pageerror", lambda e: errors.append(f"{label}: {e}"))
            page.on("console", lambda m: m.type == "error" and errors.append(f"{label} console: {m.text}"))

        # Welcome tab opens on install


        # ---------- Library import ----------
        lib = ctx.new_page()
        watch(lib, "library")
        lib.goto(f"chrome-extension://{ext_id}/library/library.html")
        lib.wait_for_selector("#btn-import")
        lib.click("#btn-import")
        files = sorted(glob.glob(os.path.join(FIX, "*")))
        lib.set_input_files("#in-files", files)
        lib.wait_for_selector("#result:not([hidden])", timeout=60000)
        res = lib.text_content("#result")
        print("   import result:", res.replace("\n", " | ")[:600])
        n_tiles = lib.locator(".tile").count()
        check("import added stickers", n_tiles >= 12, f"{n_tiles} tiles")
        check("duplicates detected", "already in your library" in res)
        check("unsupported files explained", "Telegram" in res and "HEIC" in res and "Video" in res)
        check("tiny image rejected", "Too small" in res)
        check("corrupted file rejected", "corrupted" in res)
        packs = lib.locator("#packs .pack .nm").all_inner_texts()
        print("   packs:", packs)
        check(".wastickers title became pack", "Desi Cats 😺" in packs)
        check("zip folders became packs", "Funny" in packs and "Love" in packs)

        # Re-import same files → all duplicates, nothing added
        lib.click("#btn-import") if not lib.locator("#dlg-import[open]").count() else None
        lib.set_input_files("#in-files", files)
        poll(lambda: "0 stickers added" in lib.text_content("#result"), timeout=60)
        check("re-import adds nothing", lib.locator(".tile").count() == n_tiles)
        lib.keyboard.press("Escape")

        # Favourite + rename + pack view
        lib.locator(".tile").first.hover()
        lib.locator(".tile .t-fav").first.click()
        poll(lambda: lib.text_content("#n-fav") == "1")
        check("favourite toggled", True)

        # Settings dialog renders a preview
        lib.click("#btn-settings")
        poll(lambda: "×" in lib.text_content("#pv-info"), timeout=20)
        check("settings preview renders", True, lib.inner_text("#pv-info"))
        lib.click("#settings-save")

        # Backup export works (download)
        with lib.expect_download(timeout=30000) as dl:
            lib.click("#btn-more")
            lib.click("[data-act=backup]")
        path = dl.value.path()
        check("backup zip downloaded", path and os.path.getsize(path) > 10000, f"{os.path.getsize(path)} bytes")

        # ---------- Substack insertion ----------
        ctx.route("https://substack.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body=SUBSTACK))
        for mode, expect_ok in [("paste", True), ("input", True), ("drop", True), ("dialog", True), ("none", False)]:
            pg = ctx.new_page()
            watch(pg, f"substack-{mode}")
            pg.goto(f"https://substack.com/home?mode={mode}")
            fab = pg.locator(".fab")
            for _ in range(20):  # content script loads at document_idle
                pg.click("#ed")
                try:
                    fab.wait_for(state="visible", timeout=500)
                    break
                except Exception:
                    pass
            fab.wait_for(state="visible", timeout=3000)
            fb = fab.bounding_box()
            eb = pg.locator("#ed").bounding_box()
            pos_ok = fb and eb and abs((fb["x"] + fb["width"]) - (eb["x"] + eb["width"])) < 40 and abs(fb["y"] - eb["y"]) < 40
            check(f"[{mode}] sticker button anchored to editor", pos_ok, f"fab={fb and (round(fb['x']),round(fb['y']))} ed={eb and (round(eb['x']),round(eb['y']), round(eb['width']))}")
            fab.click()
            pg.locator(".cell img").first.wait_for(timeout=10000)
            ncells = pg.locator(".cell").count()
            # pick an animated one if present for the paste case to exercise GIF path
            if mode in ("paste", "dialog"):
                time.sleep(0.4)
                pg.screenshot(path=f"/tmp/ss-picker-{mode}.png")
            target = pg.locator(".cell:has(.badge)").first if mode == "paste" and pg.locator(".cell:has(.badge)").count() else pg.locator(".cell").first
            target.click()
            if expect_ok:
                try:
                    pg.wait_for_function("window.__got.length > 0", timeout=15000)
                    got = pg.evaluate("window.__got")
                    check(f"[{mode}] sticker attached", True, str(got))
                    if mode == "paste":
                        check("[paste] animated sticker arrives as GIF", got[0]["type"] == "image/gif", got[0]["type"])
                except Exception as e:
                    check(f"[{mode}] sticker attached", False, str(e)[:120])
                check(f"[{mode}] picker closed after insert", pg.locator(".picker").is_hidden())
                if mode == "dialog":
                    check("[dialog] UI mounted inside dialog", pg.evaluate("!!document.querySelector('[role=dialog] [data-stickstack-host]')"))
                    check("[dialog] outside-click handler not triggered by our UI", pg.evaluate("window.__outside") == 0, str(pg.evaluate("window.__outside")))
            else:
                pg.wait_for_selector(".toast", timeout=15000)
                check("[none] graceful fallback message", True, pg.locator(".toast").first.inner_text()[:90])
            if mode == "paste":
                check("picker listed stickers", ncells >= 12, f"{ncells} cells")
                # Keyboard path via the command message
                pg.click("#ed")
                sw.evaluate("""async () => { const [t] = await chrome.tabs.query({url:'https://substack.com/*'}); await chrome.tabs.sendMessage(t.id, {type:'picker:toggle'}); }""")
                pg.locator(".picker").wait_for(state="visible", timeout=5000)
                pg.keyboard.type("cat")
                time.sleep(0.4)
                check("search filters picker", 0 < pg.locator(".cell").count() < ncells, f"{pg.locator('.cell').count()} cells for 'cat'")
                pg.keyboard.press("Escape")
                check("Esc closes picker", pg.locator(".picker").is_hidden())
            pg.close()

        # Recently used tab now populated
        lib.reload()
        lib.wait_for_selector(".tile")
        check("usage tracked (Recently used)", lib.inner_text("#n-recent") != "0", lib.inner_text("#n-recent"))

        # ---------- WhatsApp collector ----------
        before = lib.locator(".tile").count()
        ctx.route("https://web.whatsapp.com/**", lambda r: r.fulfill(status=200, content_type="text/html", body=wa_page()))
        wa = ctx.new_page()
        watch(wa, "whatsapp")
        wa.goto("https://web.whatsapp.com/")
        time.sleep(0.8)
        sw.evaluate("""async () => { const [t] = await chrome.tabs.query({url:'https://web.whatsapp.com/*'}); await chrome.tabs.sendMessage(t.id, {type:'wa:collector', action:'start'}); }""")
        wa.wait_for_function("(() => { const h=document.querySelector('[data-stickstack-wa]'); return h && h.shadowRoot.querySelectorAll('.cell').length >= 2; })()", timeout=10000)
        time.sleep(2.0)  # let the lazy one arrive
        n = wa.evaluate("document.querySelector('[data-stickstack-wa]').shadowRoot.querySelectorAll('.cell').length")
        check("collector found stickers but not photos", n == 2, f"{n} found (expected 2 unique webp; jpeg ignored; repeat deduped)")
        wa.screenshot(path="/tmp/ss-collector.png")
        wa.locator(".pack").fill("From WhatsApp test")
        wa.locator(".save").click()
        wa.wait_for_function("document.querySelector('[data-stickstack-wa]').shadowRoot.querySelector('.stat').textContent.includes('Saved')", timeout=20000)
        stat = wa.evaluate("document.querySelector('[data-stickstack-wa]').shadowRoot.querySelector('.stat').textContent")
        check("collector saved via offscreen ingest", "Saved" in stat, stat)
        time.sleep(0.8)
        lib.reload()
        lib.wait_for_selector(".tile")
        after = lib.locator(".tile").count()
        packs = lib.locator("#packs .pack .nm").all_inner_texts()
        # Both collected stickers already existed from fixtures → dedupe means count unchanged, pack may not be created.
        check("collector respects dedupe", after == before, f"before={before} after={after}")

        # ---------- popup ----------
        pop = ctx.new_page()
        watch(pop, "popup")
        pop.goto(f"chrome-extension://{ext_id}/popup/popup.html")
        poll(lambda: "sticker" in pop.text_content("#count"))
        check("popup shows counts", True, pop.inner_text("#count"))

        # Delete selection
        lib.locator(".tile").first.click()
        lib.click("[data-sel=delete]")
        lib.click("#ask-ok")
        poll(lambda: lib.locator(".tile").count() == after - 1)
        check("delete works", True)

        check("welcome tab opened on install", any("library.html?welcome=1" in pg.url for pg in ctx.pages), str([pg.url for pg in ctx.pages])[:200])
        ignorable = ("favicon", "Failed to load resource")
        real_errors = [e for e in errors if not any(x in e for x in ignorable)]
        check("no page errors", not real_errors, "; ".join(real_errors)[:500])
        lib.reload()
        lib.wait_for_selector(".tile img")
        time.sleep(1.0)
        dims = lib.evaluate("[...document.querySelectorAll('.tile img')].map(i => i.complete ? i.naturalWidth : -1)")
        check("library thumbnails decode", dims and all(d > 0 for d in dims), str(dims))
        lib.screenshot(path="/tmp/ss-library.png", full_page=False)
        ctx.close()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
