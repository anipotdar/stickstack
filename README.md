<p align="center"><img src="extension/icons/icon128.png" width="96" alt="StickStack"></p>

<h1 align="center">StickStack</h1>
<p align="center"><b>Your WhatsApp stickers, on Substack.</b><br>
Import your sticker collection once, then drop stickers into Substack Notes and replies with one click.</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#get-your-whatsapp-stickers">Get your stickers</a> ·
  <a href="https://anipotdar.github.io/stickstack/web/">Web converter</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="https://buymeacoffee.com/whiplash07">☕ Buy me a coffee</a>
</p>

---

Substack Notes accept images, but there's no sticker picker, and your best reactions are stuck in WhatsApp. StickStack fixes that:

- **Sticker button inside Substack.** Click into any Note, reply or comment and a ☺ button appears. Pick a sticker and it's attached like a normal upload. You can also press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>.
- **Animated stickers stay animated.** WhatsApp's animated WebP stickers are converted to GIFs, with the frame timing, looping and transparency preserved.
- **Imports everything.** You can import loose `.webp` files, the whole Android *WhatsApp Stickers* folder, `.zip` archives, `.wastickers` packs, PNG, GIF, JPEG and AVIF. Folders and packs become sticker packs automatically, and duplicates are skipped.
- **One-click collector for WhatsApp Web.** It works for iPhone users too: open web.whatsapp.com, scroll your sticker tray, and save what StickStack finds.
- **A proper library.** It has packs, favourites, recently used, search, drag-to-organise, rename, backup and restore.
- **Private by design.** Everything stays in your browser. There's no account, no server and no analytics.
- **Voice notes in DMs.** Click the 🎙 button in a Substack message, talk, and attach. Other StickStack users get a player; everyone else sees a waveform card. *(Beta.)*
- **Free web converter** for phones and other browsers. It turns stickers into PNG and GIF files you can attach from the Substack app.

> Not affiliated with Substack, WhatsApp or Meta.

## Install

**Chrome Web Store:** *coming soon.*

**Manual (developer mode), about 1 minute:**

1. Download this repo (**Code → Download ZIP**) and unzip it.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.
4. The library opens. Import your stickers, then open [substack.com](https://substack.com).

This works in Chrome, Edge, Brave, Arc, Opera and other Chromium browsers (version 116 or later).

## Get your WhatsApp stickers

| You have… | Do this |
|---|---|
| **Android** | In the Files app go to `Android › media › com.whatsapp › WhatsApp › Media › WhatsApp Stickers` (older phones: `WhatsApp › Media › WhatsApp Stickers`). Send the folder to your computer (Drive, Nearby Share, USB) and drop it into StickStack. |
| **iPhone** (or any phone) | Open **web.whatsapp.com** in Chrome → click the StickStack icon → **Start collecting** → open the 😊 → **Stickers** tray and scroll. Untick anything you don't want and press **Save**. |
| **Sticker-maker apps** | Export a `.wastickers` file and drop it in. It becomes a pack named after the pack's title. |
| **Telegram** | Static `.webp` stickers work. Animated `.tgs` and video `.webm` stickers aren't supported yet. |

## Using it on Substack

1. Click into a Note, a reply or a comment box. A small sticker button appears in its top-right corner.
2. Click it (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>). Search, or browse **Recent**, **Favourites** and your packs.
3. **Click** a sticker to attach it. **Shift+click** to add several, or **drag** a sticker into the box.
4. Post. Substack allows up to **6 images per note**.

**How attaching works:** StickStack hands the file to Substack's own upload handler. It tries, in order, a paste event, the composer's file input, and a drop event, and checks that an attachment preview actually appeared. If Substack ever changes its editor and none of those work, StickStack copies the sticker to your clipboard (PNG) or offers a download, so you're never stuck.

**Custom-domain publications** (e.g. `news.example.com`): open the site, click the StickStack icon, then **Enable on this site**.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Sticker size | 512 px | WhatsApp's native size |
| Margin | 0% | Adds empty space so the sticker looks smaller in the Note |
| Background | Transparent | White, black or a custom colour if you prefer |
| Animated stickers | GIF | Or keep the original WebP (smaller, may not animate), or use a still frame |
| GIF edge colour | White | GIFs have no soft transparency; this is blended into the edges (WhatsApp stickers have white outlines) |
| Max GIF size | 4 MB | StickStack shrinks or drops frames to stay under it |

## Web converter (no install)

`web/` is a static page using the same engine. Drop stickers in and download PNG and GIF files, or use **Share** on mobile to save them to your camera roll, then attach them in the Substack app. Hosted on GitHub Pages: **https://anipotdar.github.io/stickstack/web/**

## FAQ

**Why do stickers show up as an image attachment rather than inline?** Substack Notes only support image attachments, so a sticker appears in the note's image area. Set a margin in Settings if you want them to look smaller.

**Does this work in the Substack mobile app?** No, browser extensions can't run inside apps. Use the web converter and attach the files from your camera roll.

**What about posts and DMs?** The button appears in any Substack editor that accepts images. It should work in the post editor too. If a box doesn't take images, StickStack tells you and copies the sticker instead.

**Is it safe? Will WhatsApp ban me?** The collector only reads images your browser has already downloaded and displayed. It never sends messages, clicks anything or calls WhatsApp's servers. Nothing leaves your computer.

**Where's my data?** In your browser's extension storage (IndexedDB). Use **⋯ → Export backup** to move it to another computer.

## Develop

No build step and no dependencies at runtime. Vendored: [gifenc](https://github.com/mattdesl/gifenc) (MIT) and [fflate](https://github.com/101arrowz/fflate) (MIT).

```
extension/
  manifest.json          MV3 manifest
  background.js          service worker: message router, render cache, offscreen bridge
  offscreen/             hidden DOM document for conversion jobs
  content/substack.js    sticker button + picker + insertion strategies
  content/whatsapp.js    WhatsApp Web collector (read-only)
  library/               full library app
  popup/                 toolbar popup
  lib/                   shared engine (sniff, unpack, render, ingest, db, settings)
web/                     static web converter (imports ../extension/lib)
test/                    unit tests, fixtures, browser end-to-end tests
scripts/                 fixture/icon generators, packaging
```

```bash
npm test                                   # unit tests (Node 18+)
python3 scripts/make_fixtures.py test/fixtures
pip install playwright
python3 test/browser/run_render.py         # conversion engine in real Chrome
python3 test/browser/run_extension.py      # full extension e2e (mock Substack + WhatsApp)
python3 test/browser/run_web.py            # web converter
npm run package                            # → dist/stickstack-extension-<version>.zip
```

The e2e tests need a Chrome that honours `--load-extension` (Chrome for Testing or Chromium). Pass its path as the first argument.

**If Substack changes its editor**, `content/substack.js` is the only file to look at: `resolveEditor()` decides which boxes get the button, and `strategies` holds the three ways of attaching a file.

## Contributing

Bug reports with your browser version and the Substack page URL are gold. See [CONTRIBUTING.md](CONTRIBUTING.md). Ideas on the roadmap:

- [ ] Telegram animated (`.tgs`) and video (`.webm`) stickers
- [ ] Sticker search by emoji tags from `.wastickers` metadata
- [ ] Firefox port
- [ ] Optional sync of the library via your own Google Drive

## Support

If StickStack made your Notes more fun, you can [buy me a coffee ☕](https://buymeacoffee.com/whiplash07).

## License

[MIT](LICENSE). Sticker artwork belongs to its creators; StickStack doesn't ship any stickers, it only helps you use your own.
