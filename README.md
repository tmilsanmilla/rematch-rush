# Rematch Rush

[Play Rematch Rush](https://rematch-rush.vercel.app/) · [GitHub Pages backup](https://tmilsanmilla.github.io/rematch-rush/)

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

This repository is connected to the existing `rematch-rush` Vercel project. An authorized, reviewed push to `main` runs the full test suite and build, then Vercel publishes `dist/` at the main play URL. Keep changes in one tested batch and use the Git integration for the release.

Each Vercel deployment triggered by Git still counts toward Vercel's limits and the shared maximum of 50 deployments per New York calendar day. Follow the workspace deployment-budget procedure before an auto-deploying push, and publish only when explicitly requested.

The GitHub Actions workflow also publishes `dist/` to the GitHub Pages backup after its checks pass. It can be started manually from Actions.
