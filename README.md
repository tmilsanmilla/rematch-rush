# Rematch Rush

[Play Rematch Rush](https://rematch-rush.vercel.app/) · [GitHub Pages backup](https://tmilsanmilla.github.io/rematch-rush/)

A character-powered football game with separate Offline and Online match menus. Every team has an AI goalkeeper.

- Offline: Bot Standard is you versus one bot; 2v2 vs Bots adds a bot teammate and two bot opponents.
- Online: 1v1 and 2v2 enter separate public matchmaking queues for two or four human players. Canceling leaves the queue.
- Custom rooms: choose human, bot, or empty outfield slots for each team, a 2/5/10-minute match, and an optional first-to-3/5/10 goal target. Share a four-character code with friends. For example, you + bot versus friend + bot.

Choose a character in the Characters tab to read its moves, follow-ups, passives and awakening. Normal and lucky spins are currently unlimited.

## Controls

- WASD or arrow keys: move
- Mouse: aim
- Ctrl: toggle cursor lock; Esc: release it
- Left mouse button or Shoot: hold to charge a normal shot, release to kick
- Every successful kick (including passes and kicking moves) adds one Ultrashot charge, capped at three; empty attempts do not count
- F or the Ultrashot button: after three kicks, hold then release to use a Curve Shot or Quick Shot; normal clicks never spend the charge
- C: tackle or dribble
- Q or Pass: pass to a teammate (disabled with an explanation in 1v1)
- 1–5: character moves
- E: awakening

Queued matches start automatically once enough real players connect; they never silently fill with bots. A transient PeerJS rendezvous groups waiting browsers and hands them to a separate host-authoritative game connection. Custom rooms start when their configured human slots have joined; bot-only remaining slots can start immediately. Everyone can rematch with the same teams and settings. Online connections use PeerJS/WebRTC and depend on the players’ networks; restrictive networks without a working direct route may need a different connection.

Queue and room protocol is v4, so all players should refresh together after a release. Local mocked-peer tests exercise matchmaking, cancellation, handoff, and rematches; these are not live two-browser network acceptance.

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
