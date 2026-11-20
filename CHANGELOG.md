# Changelog

## 1.1.0 — unreleased
- Voice notes in Substack DMs: a mic button in message composers records up to 5 minutes, then
  attaches the recording as a PNG waveform card with the Opus audio stored inside it. StickStack
  users get an inline player (play/pause, seek, 1×/1.5×/2×); everyone else sees the card.
- New setting: "Voice notes" (on by default).
- Needs access to substack-post-media.s3.amazonaws.com to read received voice notes.
- Security hardening: strict Content Security Policy for extension pages and the web converter;
  the background worker checks which page each request comes from; the converter document only
  accepts the background worker; StickStack's on-page UI uses closed shadow roots so page scripts
  can't read the sticker library; "Enable on this site" is only offered on Substack publications;
  voice-note downloads are size-capped and cookie-free; pack menus are built without HTML strings;
  CI actions pinned to commit SHAs with read-only permissions, plus CodeQL, Dependabot and
  SECURITY.md.

## 1.0.0 — 2026-11-17
First release.
- Sticker button + picker in Substack Notes, replies, comments and the post editor
- Insertion via paste → file input → drop with verification; clipboard/download fallback
- Animated WebP/APNG/GIF → GIF with correct timing, loop count and 1-bit alpha matte; size budget
- Import: WebP, PNG, GIF, JPEG, AVIF, BMP, folders, .zip, .wastickers, nested archives, StickStack backups
- Dedupe by content hash; clear skip reasons (Telegram .tgs/.webm, HEIC, corrupted, too small, etc.)
- WhatsApp Web collector (read-only), with photo/avatar filtering
- Library: packs, favourites, recent, search, sort, rename, move, drag-to-pack, download, backup/restore
- Custom-domain publications via optional permission
- Web converter (GitHub Pages) with Share-to-camera-roll on mobile
