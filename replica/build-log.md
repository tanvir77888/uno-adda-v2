# Build log — UNO Adda v2 (2026-11-21)

Method: replica-build — shell + vertical slice first, then every screen in
the recon slice, features.csv ticked as each landed. All code written fresh
in this repo; no original assets, code or copy used.

| screen | status | notes |
| --- | --- | --- |
| S02 Home (simplified) | done | name field, bot game panel, create/join room, house-rule toggles |
| S03 Rules panel | done | plain-language rules + house rules, written fresh, in a details panel on Home |
| S05 Create room | done | mode (classic/2v2) + rule toggles; 6-letter code |
| S06 Join room | done | code entry; errors for bad code / full / already started |
| S07 Lobby | done | seat list, ready ticks, host badge, host start, room chat |
| S08 Game table | done | hand (playable glow), opponents with counts + card backs, draw/discard piles, current-color indicator, 30 s timer bar, event toasts |
| S09 Color picker | done | 4-color quadrant modal; also opens for a flipped Wild first card |
| S10 Challenge prompt | done | Challenge button + pending banner showing the owed total (modal folded into the action row for one-thumb play) |
| S11 UNO call / catch | done | UNO button (arm + declare), pulsing hint at 2 cards, CATCH button on the suspect's opponent chip; bots catch too |
| S12 Round end / results | done | winner, round points, per-hand leftover breakdown, match totals, host next-round button, 500 match-winner note |

Engine (`game.js`): full 108-card rules, stacking, +4 challenge with bluff
tracking, UNO suspect window, reshuffle, first-card handling, All Wild.
Server (`server.js`): one Node process, `ws` only dependency, in-memory
rooms, authoritative snapshots per seat, turn timer with auto draw/pass,
server-side bots through the same action path, token reconnect.

Harder than expected: the +4 bluff fact (did the player hold the color?)
must be captured at play time — it is unrecoverable later. The UNO catch
window is defined as "until the next player completes a turn" so a late
self-call can still save the suspect.

Verification (2026-11-21):
- `node test/smoke.js` — 12/12 checks pass: server boot, /health, home page,
  bot game start + play, room create/join/ready/start, bad-code rejection,
  room game progress with zero server errors.
- `node test/engine-stress.js` — 480 full rounds (2–4 players × stacking
  on/off × challenge on/off × All Wild) all finish; 108 cards conserved at
  every step.

Not built (honest): voice chat (pending, as in v1), quick emotes, APK
wrapper (later step), GitHub push (user creates the repo himself).
2v2 is implemented but was not exercised by the automated smoke test.
