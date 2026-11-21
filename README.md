# UNO Adda

A free, clean-room UNO-style card game for the browser — play against bots or
with friends in private rooms. Original code and CSS-drawn cards; not
affiliated with Mattel and uses none of its artwork, name or sounds.

## Run it

```bash
npm install
npm start        # http://localhost:3000
```

Only dependency: `ws`. Rooms live in server memory; no database, no
accounts — a display name and a 6-letter room code are all you need.

## What's in

- Full 108-card rules: match by color/number/symbol, Skip, Reverse, +2,
  Wild, Wild Draw Four, reshuffle, first-card handling
- House rules: stacking (+2/+4), Wild +4 challenge, UNO call + catch
  penalty, All Wild mode, 7 cards each, 30-second turns
- Modes: vs bots (1–3 AI), private rooms (2–4 players), 2v2 teams
- Standard scoring (actions 20, Wilds 50), match totals toward 500
- Lobby + in-game text chat, reconnect by session token
- Mobile-first layout

## Tests

```bash
npm test                 # boots the server; bot game + room flow checks
node test/engine-stress.js   # 480 simulated full rounds across rule variants
```

## Layout

- `game.js` — pure rules engine (shared by bot games and online rooms)
- `server.js` — HTTP static + WebSocket rooms, bots, turn timer
- `public/` — the client (no build step)
- `replica/` — recon map, architecture and feature matrix for the rebuild
