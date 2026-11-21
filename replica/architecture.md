# Architecture: UNO Adda (a rebuild of UNO!™'s core card-game features)

Clean-room rebuild of the core loop from `replica/recon.md`: quick games vs
bots, private rooms with a code, house rules (stacking, +4 challenge, UNO
penalty, All Wild), 2v2, standard scoring. Guest-only, fully free, no
accounts, no coins, no ads. Mattel's name, artwork and sounds are NOT used —
brand is Tanvir's own "UNO Adda", all cards are original CSS.

## Stack

| layer | choice | why |
| --- | --- | --- |
| server | Node.js 24, single process, `server.js` | one boring runtime the user already has; no build step |
| realtime | WebSocket via the `ws` npm package (the only dependency) | authoritative turn game needs push state; `ws` is tiny and stable |
| web client | static HTML/CSS/JS in `public/`, no framework, no build | loads instantly on a phone browser; nothing to compile |
| game engine | `game.js` — pure state machine, shared by bot games and online rooms | one rules implementation, testable without sockets |
| database | none — rooms live in server memory | guest-only rooms are disposable; a DB buys nothing at this slice |
| auth | none — display name + room code; a random session token per seat for reconnect | recon: accounts are out of slice |
| payments / email | none | fully free by the user's rule |
| hosting | local / any free Node host later (user handles GitHub repo + deploy) | repo creation is the user's step; code is deploy-ready |

## Data model (in-memory, mirrors recon entities)

No SQL — the recon entities map to plain JS objects held in a `Map` on the
server. Kept here so a future DB port is mechanical.

```js
Room {
  code,            // 6 letters, unambiguous alphabet
  hostToken,       // session token of the host seat
  mode,            // 'classic' | '2v2'
  rules: { stacking: true, challenge: true, allWild: false, timerSec: 30 },
  status,          // 'waiting' | 'playing' | 'roundEnd'
  seats: [Seat],   // 2..4
  game: RoundState | null,
  scores: { [seatId]: number },       // match totals, target 500
  chat: [ { name, text, at } ]        // last 50, lobby + table
}
Seat {
  id, token,       // token = reconnect key, kept client-side
  name, isBot, ready, connected,
  team             // 'a' | 'b' | null (2v2: seats 0&2 vs 1&3)
}
RoundState {
  deck: [Card], discard: [Card], hands: { [seatId]: [Card] },
  currentColor, direction, currentSeat,
  pendingDraw,     // accumulated cards owed by current seat
  pendingKind,     // 'draw2' | 'wild4' | null
  lastWild4: { seatId, bluff } | null,   // for the challenge rule
  drewCardId,      // card just drawn this turn (may be played, or pass)
  unoSuspect,      // seatId who hit 1 card without calling, catchable now
  turnEndsAt,      // epoch ms for the 30 s timer bar
  winnerSeatId, roundPoints, breakdown // set at round end
}
Card { id, color: 'red'|'yellow'|'green'|'blue'|'wild',
       kind: 'number'|'skip'|'reverse'|'draw2'|'wild'|'wild4', value }
```

Access rules: a socket may only act for the seat whose token it presented;
the server validates every action against `RoundState` (turn, card ownership,
matching, pending state) — the client is never trusted.

## API (WebSocket messages, JSON)

| message | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `create_room` | make a room, become host seat | any guest | name, mode, rules | `room_joined` + state | F02 |
| `join_room` | take a free seat (or rebind by token) | any guest | code, name, token? | `room_joined` + state / `error` | F03 |
| `create_bot_game` | room pre-filled with 1–3 bot seats, starts at once | any guest | name, botCount, rules | state | F01 |
| `set_ready` | toggle ready in lobby | seat | ready | state broadcast | F02/F03 |
| `start_game` | deal round 1 / next round | host, all ready | — | state broadcast | F02 |
| `play_card` | play a card (validates match/stack) | current seat | cardId, chosenColor?, callUno | state broadcast / `error` | F04/F05 |
| `draw_card` | draw 1 (or take the pending pile) | current seat | — | state broadcast | F04/F05 |
| `pass` | pass after drawing a playable card | current seat | — | state broadcast | F04 |
| `challenge` | challenge the last Wild +4 | seat owing a +4 | — | state broadcast | F05 |
| `call_uno` | declare UNO for your own pending play | any seat | — | state broadcast | F06 |
| `catch_uno` | catch a player who forgot | any other seat | targetSeatId | state broadcast | F06 |
| `chat` | room text chat | seat | text | `chat` broadcast | S07/S08 |
| `leave` | drop seat / close room if host in lobby | seat | — | state broadcast | F02 |

Server → client: `state` (per-seat snapshot: your hand in full, opponents as
counts), `chat`, `error`, `room_closed`. Snapshots are the only game truth;
the client renders, never computes rules.

HTTP: `GET /` and static files from `public/`; `GET /health` → `ok`.

## The parts that bite

- **Turn timer races:** one `setTimeout` per room, cleared and re-armed on
  every accepted action; the deadline also ships in the snapshot so the
  client's bar and the server agree. Timeout = take pending draw, else
  draw 1, then pass.
- **Stacking/challenge state:** `pendingDraw` + `pendingKind` +
  `lastWild4.bluff` (recorded at play time: did the +4 player hold another
  card of the color in effect? — that fact is gone later, so capture it then).
- **UNO window:** `unoSuspect` is set when a play leaves a seat at 1 card
  without `callUno`; it clears on the next accepted action. Any other seat
  may catch in that window (draw 2 for the suspect).
- **Reshuffle:** when the draw pile empties mid-draw, keep the discard top,
  shuffle the rest into a new draw pile.
- **Disconnects:** socket close marks the seat disconnected but keeps it;
  the turn timer keeps the game moving (auto draw/pass). Rejoin with the
  same token rebinds the seat. Host leaving the lobby closes the room.
- **Bots run on the server** through the same action path as humans, on a
  short delay — no second rules implementation to drift.
- **2 players:** Reverse acts as Skip (official rule), handled in the engine.

## Build order

1. **Vertical slice:** engine (`game.js`) + server + one client that can
   create a bot game, play a full round, see results. (S08, S12)
2. **Must-haves:** rooms + lobby + ready/host start (S05–S07), color picker
   (S09), challenge prompt (S10), UNO/catch (S11), timer, stacking, scoring
   toward 500, home + rules panel (S02, S03).
3. **Should-haves:** 2v2 teams, All Wild toggle, lobby/table chat, reconnect
   by token.
4. **Later (out of this build):** voice chat, APK wrapper — see features.csv.

## Summary

Stack in one line: Node + `ws` + static client, in-memory rooms, one shared
engine for bots and online. Tables: 0 (in-memory objects above). Routes: 1
HTTP static + 13 WS message types. Riskiest parts: (1) stacking/challenge/
UNO edge cases in the engine, (2) turn-timer race handling, (3) reconnect
seat rebinding. Next step: build (replica-build).
