# Contributing to StickStack

Thanks for helping. This project is intentionally simple: plain JavaScript modules, no bundler, no framework.

## Setup
1. Clone the repo and load `extension/` via `chrome://extensions` → Developer mode → **Load unpacked**.
2. After editing, click the reload icon on the extension card and refresh Substack tabs.
3. Web converter: `npx serve .` (or `python3 -m http.server`) at the repo root and open `/web/`.

## Tests
```bash
npm test                                  # Node unit tests
python3 scripts/make_fixtures.py test/fixtures
python3 test/browser/run_render.py        # conversion in real Chrome
python3 test/browser/run_extension.py     # extension end-to-end
python3 test/browser/run_web.py           # web converter
```
Please add a fixture + test for any new format or edge case.

## Reporting a Substack breakage
Substack's editor changes over time. Please include:
- browser + version, OS
- the page (e.g. Notes home, a note reply, a post comment, post editor)
- what happened (no button? button but nothing attached? fallback toast?)
- if you can: in DevTools, the HTML around the editor (`[contenteditable]`) and any `input[type=file]` nearby

## Code map
| File | What it does |
|---|---|
| `extension/lib/sniff.js` | Format detection + WebP/PNG/GIF header parsing (pure, unit-tested) |
| `extension/lib/unpack.js` | Zip / .wastickers / backup / folder expansion with safety limits |
| `extension/lib/render.js` | Decoding, PNG output, animated → GIF (timing, alpha, size budget) |
| `extension/lib/ingest.js` | Import pipeline with dedupe |
| `extension/content/substack.js` | Button, picker, insertion strategies |
| `extension/content/whatsapp.js` | WhatsApp Web collector |

## Style
- Keep it dependency-free at runtime. Vendored libs live in `extension/lib/vendor/` with licenses.
- Everything must work offline and locally. No network calls, no telemetry.
- User-facing errors should say what happened and what to do next.
