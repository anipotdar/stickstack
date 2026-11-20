# Chrome Web Store listing (copy/paste)

**Name:** StickStack — Stickers & voice notes for Substack

**Summary (≤132 chars):** Your WhatsApp stickers in Substack Notes and replies, plus voice notes in DMs. 100% local, no account, open source.

**Category:** Social & Communication

**Description:**
Your best reactions live in WhatsApp. StickStack brings them to Substack.

• A sticker button appears in Substack Notes, replies and comments — click, pick, done.
• Animated WhatsApp stickers are converted to GIFs so they animate on Substack.
• Import the Android “WhatsApp Stickers” folder, .wastickers packs, .zip files, WebP, PNG, GIF.
• iPhone users: collect stickers from WhatsApp Web in one go.
• Voice notes in Substack DMs (beta): record, listen back, attach. Other StickStack users get a player.
• Packs, favourites, recently used, search, backup & restore.
• Private: everything stays in your browser. No account, no server, no tracking.
• Free and open source.

Not affiliated with Substack, WhatsApp or Meta.

## Single purpose
Enrich Substack conversations: let users attach their own stickers to Substack notes, replies and comments, and send voice notes in Substack messages.

## Permission justifications
- **storage / unlimitedStorage** — the user's sticker library (images can exceed the default quota).
- **offscreen** — decode and convert images (WebP → PNG/GIF) with canvas outside the service worker.
- **scripting** — inject the sticker button into already-open Substack tabs after install, and into custom-domain Substack publications the user explicitly enables.
- **activeTab** — read the current tab's address when the popup is opened, to offer the right action (Substack, WhatsApp Web, or "enable on this site").
- **Host: substack.com, *.substack.com** — show the sticker button in editors and attach the chosen sticker.
- **Host: web.whatsapp.com** — when the user clicks "Start collecting", read sticker images already displayed so the user can save them. Read-only; no automation.
- **Host: substack-post-media.s3.amazonaws.com** — Substack's image storage. Downloads the original file of an image in a Substack message that may be a voice note, so it can be played. No cookies are sent.
- **Microphone** (no manifest permission; Chrome asks per site) — record a voice note only after the user clicks the 🎙 button.
- **Optional host (https://*/*)** — requested per site, only when the user enables a custom-domain Substack publication.

## Data usage disclosures
Does not collect or transmit any user data to the developer or third parties. No remote code.
In the dashboard's Privacy tab: tick none of the data types, and certify all three statements
(no selling, no unrelated use, no creditworthiness use). Privacy policy URL:
`https://github.com/anipotdar/stickstack/blob/main/PRIVACY.md`.
