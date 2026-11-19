# Chrome Web Store listing (copy/paste)

**Name:** StickStack — Stickers for Substack Notes

**Summary (≤132 chars):** Bring your WhatsApp stickers to Substack. Import packs, then drop stickers into Notes and replies. 100% local, open source.

**Category:** Social & Communication

**Description:**
Your best reactions live in WhatsApp. StickStack brings them to Substack.

• A sticker button appears in Substack Notes, replies and comments — click, pick, done.
• Animated WhatsApp stickers are converted to GIFs so they animate on Substack.
• Import the Android “WhatsApp Stickers” folder, .wastickers packs, .zip files, WebP, PNG, GIF.
• iPhone users: collect stickers from WhatsApp Web in one go.
• Packs, favourites, recently used, search, backup & restore.
• Private: everything stays in your browser. No account, no server, no tracking.
• Free and open source.

Not affiliated with Substack, WhatsApp or Meta.

## Single purpose
Let users import their own sticker images and attach them to Substack posts/notes/comments.

## Permission justifications
- **storage / unlimitedStorage** — the user's sticker library (images can exceed the default quota).
- **offscreen** — decode and convert images (WebP → PNG/GIF) with canvas outside the service worker.
- **scripting** — inject the sticker button into already-open Substack tabs after install, and into custom-domain Substack publications the user explicitly enables.
- **activeTab** — read the current tab's address when the popup is opened, to offer the right action (Substack, WhatsApp Web, or "enable on this site").
- **Host: substack.com, *.substack.com** — show the sticker button in editors and attach the chosen sticker.
- **Host: web.whatsapp.com** — when the user clicks "Start collecting", read sticker images already displayed so the user can save them. Read-only; no automation.
- **Optional host (https://*/*)** — requested per site, only when the user enables a custom-domain Substack publication.

## Data usage disclosures
Does not collect or transmit any user data. No remote code.
