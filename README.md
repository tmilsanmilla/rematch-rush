# Rematch Rush

[Play Rematch Rush](https://tmilsanmilla.github.io/rematch-rush/)

A character-powered football game. The **Arrival of the Best** update includes 1v1 Standard, 2v2 Standard, solo Bot Standard, and two-player Bot Team Standard, with AI goalkeepers and passing bots.

Choose a character in the Characters tab to read its moves, follow-ups, passives and awakening. Normal and lucky spins are currently unlimited.

## Controls

- WASD or arrow keys: move
- Mouse: aim
- Ctrl: toggle cursor lock; Esc: release it
- F or the Ultrashot button: hold to charge, release to shoot
- C: tackle or dribble
- Q: pass to a teammate
- 1–5: character moves
- E: awakening

Online players join with a four-character room code. Rooms start when all human players have joined; everyone can rematch in the same room. Online connections use PeerJS/WebRTC and depend on the players’ networks.

## Local development

Use Node.js 24. There are no npm dependencies to install.

```sh
npm test
npm run build
python3 -m http.server 8767
```

Open `http://localhost:8767/`. The static production build is written to `dist/`.

## Publishing

Pushing a reviewed update to `main` runs the full test suite and build. GitHub Pages publishes only the contents of `dist/` after the checks pass. The release workflow can also be started manually from Actions.
