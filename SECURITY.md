# Security

## What protects a board

- Drawings travel over WebRTC data channels, encrypted with DTLS, directly between the people on the board.
- Pairing uses six words (66 random bits). PBKDF2 with 100,000 iterations and HKDF turn them into a topic and an AES-GCM key. Public MQTT brokers only carry sealed messages on that random topic, and stale, replayed or altered messages are dropped.
- The words work once and expire after ten minutes.
- After the connection opens, both sides compute six confirmation words from the DTLS certificate fingerprints. The inviter types the words shown on the friend's screen; nothing of the board is shared before they match, and three wrong tries close the connection.
- Every operation and state from a peer is validated field by field before it is applied. Pictures are accepted only when their bytes match the SHA-256 that names them.

## What it does not protect against

- Anyone you let in can see and change the whole board.
- The public brokers and the STUN servers can see that your IP address took part in a pairing or a connection check.
- Boards are stored unencrypted in your browser.

## Reporting

Please report problems privately through GitHub security advisories on the repository, or open an issue without details and ask for a private channel. I will answer as soon as I can.
