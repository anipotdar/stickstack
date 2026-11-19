# Voice notes: live test plan

Substack DMs accept images but not audio. StickStack sends a voice note as a PNG: the picture is a
waveform card ("Voice note · 0:42 · play it with the StickStack extension") and the Opus audio is
stored in a private PNG chunk (`ssVn`). Anyone with StickStack sees an inline player instead of the
picture. The format lives in `extension/lib/voicecodec.js`, the UI in `extension/content/voice.js`.

What has been verified so far (no Substack involved):

- `npm test`: format round-trip, CRC checks, hostile-input rejection and CDN URL parsing.
- `test/browser/voice-harness.html` (serve the repo with `npm run serve`, then open
  `http://localhost:8080/test/browser/voice-harness.html`): records from a fake mic, attaches,
  pulls the audio back out of the PNG and plays it in the inline player.

What only the live site can tell us is below. You need two Substack accounts (your own and a test
account) and Chrome with the unpacked extension from this branch loaded.

## 0. Setup

1. `chrome://extensions` → reload StickStack (or Load unpacked → `extension/`).
2. Open substack.com and go to your messages. Open a DM with the test account.
3. Open DevTools (F12) on that tab and keep the Console visible.

## 1. Does the mic button appear in the DM composer?

Click into the message box. A mic button should appear just left of the ☺ sticker button.

- If it does not: note the page URL and run this in the Console, then click into the box again:
  `localStorage.setItem('stickstack:voice:everywhere', '1')`
  If the button now appears, the detection in `isDmComposer()` (voice.js) needs the real URL
  pattern or placeholder text. Copy the URL and the composer's placeholder text for the fix.
- If the ☺ sticker button doesn't appear either, the composer isn't recognised as an editor at all.
  Right-click the message box → Inspect, and copy the element's HTML (`<div contenteditable…>` or
  `<textarea…>`) and its parent.

## 2. Can we record?

Click the mic. Chrome asks "substack.com wants to use your microphone": allow it.

- **Works:** a red dot, a moving waveform and a timer. Talk for ~5 seconds, press **Stop**, then
  press ▶ to listen back.
- **Fails with "Microphone access is blocked" and no Chrome prompt:** Substack's
  Permissions-Policy blocks the microphone for the page. The fix is to record in a small
  StickStack window instead. Note the Console error.

## 3. Does it attach?

Press **Attach**. The waveform card should appear as an image attachment in the composer.

- If it says "didn't accept the voice note": press **Download**, drag the PNG into the message
  box manually, and note that automatic attaching failed (same as stickers? check with a sticker).

## 4. THE key test: does the audio survive Substack's upload?

Press **Send** in Substack.

- **Pass:** within a second or two, the sent image turns into an inline player (▶, waveform,
  time, 1× speed). Press play: you should hear yourself. Try 1.5× and 2×, and click the waveform to
  seek.
- **Fail (stays a picture):** In the Console run:
  ```js
  [...document.images].filter(i => /substack/.test(i.src) && i.naturalWidth/i.naturalHeight > 3.9).map(i => i.src)
  ```
  Copy the URL(s). Then open the URL in a new tab and save the image (right-click → Save image as),
  and also save the original file from your Downloads (use **Download** in the panel to get one). We
  compare the two: if the bytes differ, Substack re-encodes uploads and we move to plan B
  (encrypted link). If the URL isn't a `substackcdn.com/image/fetch/...` or
  `substack-post-media.s3.amazonaws.com` URL, `originalImageUrl()` needs the new pattern.

## 5. Receiving side

Log in as the test account (another Chrome profile works well) with StickStack installed and open
the DM: the voice note should show as a player there too. Then check without the extension (or on
the phone app): it should look like the waveform card with the "play it with StickStack" line.

## 6. Edge cases (quick)

- Record for 5:00: it should stop on its own at 5:00 and still attach and play.
- Click mic, then Cancel; click mic, press Esc. Nothing should be attached.
- Dark mode in Substack: the panel and the player should switch to dark colours.
- Library → Settings → untick "Voice notes": the mic and players disappear.

## Results template

| # | Test | Pass/Fail | Notes (URL, error, screenshot) |
|---|------|-----------|--------------------------------|
| 1 | Mic button shows in DM composer | | |
| 2 | Recording works | | |
| 3 | Attach works | | |
| 4 | Audio survives upload (player appears after Send) | | |
| 5 | Receiver with extension gets player; without sees card | | |
| 6 | Edge cases | | |
