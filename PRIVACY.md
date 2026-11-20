# Privacy policy — StickStack

_Last updated: 20 November 2026_

StickStack collects **no data**. There is no account, no server, no analytics and no tracking.

**What stays on your device**
- Stickers you import, their thumbnails and converted versions are stored in your browser's extension storage (IndexedDB) on your computer.
- Your settings are stored in `chrome.storage.local` on your computer.

**What the extension reads**
- **substack.com** (and custom domains you explicitly enable): to show the sticker button in editors and attach the sticker you choose. It does not read your posts, notes, messages or account details.
- **Substack messages (voice notes)**: when you click the 🎙 button, the microphone is used only while you record, and the recording stays in the page until you press *Attach*. Chrome asks you for microphone permission for the Substack site first. When a message contains an image that might be a voice note, StickStack downloads that image's original file from Substack's image storage (`substack-post-media.s3.amazonaws.com`) to play it. No cookies or other data are sent with that request.
- **web.whatsapp.com**: only when you click *Start collecting*, and only images already displayed on your screen, so you can choose which stickers to save. It never sends messages, clicks or modifies anything, and never contacts WhatsApp's servers itself.

**What leaves your device**
- Nothing, except the stickers and voice notes you choose to attach, which you upload to Substack yourself through Substack's normal image upload. A voice note is an image with your recording inside it: anyone who can see that message can play it.

**Removing your data**: delete stickers in the library (⋯ → Delete everything) or uninstall the extension; Chrome deletes its storage.

The web converter at `web/` works the same way: files are processed in your browser and never uploaded.

Questions: open an issue on the GitHub repository.
