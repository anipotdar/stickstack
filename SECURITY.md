# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through
GitHub: **Security → Report a vulnerability** on this repository (private vulnerability reporting).
Include steps to reproduce and the StickStack version (shown in `chrome://extensions`).

You'll get a reply within 7 days. Fixes for confirmed issues ship as a new Chrome Web Store
version, and reporters are credited in the changelog unless they prefer otherwise.

## Supported versions

Only the latest version on the Chrome Web Store gets security fixes.

## How StickStack is built to be safe

- **No server, no accounts, no data collection.** There is nothing to log in to, so there are
  no passwords to steal and no user database to breach. Everything stays in your browser.
- **No remote code.** All code ships inside the extension; nothing is downloaded and run later.
  No `eval`, and extension pages run under a strict Content Security Policy.
- **No third-party dependencies at runtime** apart from two small vendored libraries
  (fflate, gifenc) with pinned versions, listed in `extension/lib/vendor/LICENSES.md`.
- **Least privilege.** Host access is limited to Substack, WhatsApp Web (only when you start the
  collector) and Substack's image bucket (to play voice notes). Other sites are only ever enabled
  one at a time, by you, and only if the page is a Substack publication.
- **Messages are checked.** The background worker only answers the parts of the extension that
  need each action (for example, only WhatsApp Web can add collected stickers).
- **The page can't see inside StickStack's UI.** Buttons and pickers live in closed shadow roots,
  so scripts on the page can't read your sticker library.
- **Untrusted files are handled defensively.** Imports are identified by content, size-limited
  (including zip-bomb limits checked before decompressing), and names are cleaned. Voice notes are
  validated (format, size, duration) before playing.
- **CI**: GitHub Actions are pinned to commit SHAs with read-only permissions, and CodeQL scans
  every change.
