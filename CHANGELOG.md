# Changelog

## 0.1.0

First release.

- An infinite slate with pan and zoom, two finger pan and pinch zoom on touch screens.
- Smooth, pressure aware pen strokes, a highlighter, an eraser, rectangles, ellipses, lines, arrows, text and sticky notes.
- Pictures by paste, drop or picker, compressed to WebP or JPEG and shared with everyone.
- Select, move, resize, duplicate and bring to front. Undo and redo per person.
- A context menu by right click, long press, the Menu key or Shift+F10, with submenus, arrow keys and type to jump: copy and paste, send to back, lock, color and group on elements; paste, sticky note, text and zoom to fit on the board; reply and react on messages; mute for me and go to a cursor on call members.
- Chat with replies and reactions, a voice call with Strong noise suppression (browser filters plus a DSP AudioWorklet) and a mic test, camera bubbles next to each cursor and screen sharing. Mute, camera off and pickers for the microphone, camera and speaker that apply during a call.
- Up to 5 people with live cursors and names, in a mesh that introduces newcomers and relays around blocked pairs.
- A board CRDT: last writer wins fields with Lamport times, ordered stroke points, full state for late joiners.
- Pairing with six words, a QR code or an invite link (`#join=` with the words in the hash, cleared from the address bar on arrival) over encrypted public MQTT relays, confirmed with six words from the DTLS fingerprints. A pasted phrase or link spreads one word per box.
- A STUN check at start, and an optional TURN server in the settings.
- Boards saved in IndexedDB, a board list, export to PNG, SVG and a board file, and import that merges.
- An installable PWA that opens offline, in English and Portuguese, with a night slate and a calm light theme.
- Mabel and Otto, the line icon set, scenes and the landing page: a chalkboard to draw on first, then a notebook that turns its pages as you scroll.
