# Recon map — UNO!™ (Mattel) → clone: "UNO Adda"

Target: official UNO!™ mobile app (Android/iOS), Mattel Game Studios HK /
Mattel163. Our slice: the core card game loop — quick match vs bots, private
rooms with friends, house rules, 2v2 — rebuilt clean-room under Tanvir's own
brand **UNO Adda**, free, no ads, no in-app purchases, no coins gambling.

## Sources (public only)

| source | what it gave us |
| --- | --- |
| Google Play listing (play.google.com, UNO!™ by Mattel163) | mode list, feature pitch, screenshots of key screens |
| APKPure listing (user-supplied screenshot, v1.18.7042, Nov 19 2026) | version, rating 7.9 on APKPure, "Everyone" |
| thegamereward.com UNO! Mobile guide | Quick Play, Play with Friends, 2v2, Tournaments, Go Wild described |
| BlueStacks UNO!™ rules guide (bluestacks.com) | turn flow, stacking rules (+2 on +2 only, +4 on +4 only), +4 challenge, scoring by card value |
| officialgamerules.org UNO rules | 108-card deck composition, official scoring (actions 20, wilds 50, first to 500), UNO call penalty |
| arcadewebsite.com UNO rules guide | setup, first-card action handling, draw-one rule, reshuffle |

No accounts were logged into, no bundles read, nothing decompiled.

## Core loop

Join a match (bots or friends) → match cards by color/number/symbol →
action cards and house rules bend the turn order → first to empty their hand
wins the round and scores the value of everyone else's remaining cards.

## Screen inventory

| ID | screen | how you get there | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S01 | Splash / loading | app launch | brand + load | logo, progress | loading |
| S02 | Home / main menu | after load | pick a mode | Quick Play btn, Friends btn, 2v2 btn, Tournament btn, Go Wild btn, profile chip, coins, daily reward | filled, event banners |
| S03 | Mode info / rules | info icon on a mode | explain rules + house rules | rule list, toggles | filled |
| S04 | Matchmaking | Quick Play tap | find opponents | searching animation, cancel | searching, found, timeout |
| S05 | Create room | Play with Friends | host a private room | room code, house-rule toggles, invite | empty (host only), filling |
| S06 | Join room | Play with Friends | enter a code | code input, join btn | empty, error (bad code), full |
| S07 | Lobby / room waiting | room created/joined | gather 2–4 players, ready up | player slots, avatars, ready ticks, start btn (host), chat | waiting, ready, starting |
| S08 | Game table | match starts | play the round | own hand (face up), opponents (avatar + card count + backs), discard pile, draw pile, current-color indicator, direction indicator, turn timer, UNO button, emotes/chat | my turn, other turn, pending draw, challenge prompt, color picker, disconnected |
| S09 | Color picker | playing a Wild/+4 | choose next color | 4 color quadrants | modal |
| S10 | Challenge prompt | +4 played on you | accept or challenge | accept btn, challenge btn, timer | modal |
| S11 | UNO catch | a player reaches 1 card | call UNO / catch a player who forgot | UNO button, catch button | timed window |
| S12 | Round end / results | a hand empties | show winner + points | score table, points per hand, play again, exit | filled |
| S13 | Match results / leaderboard | tournament or multi-round end | rankings | rank list, rewards | filled |
| S14 | Profile / level | profile chip | level, XP, stats, avatar | progress bar, stats grid | filled |
| S15 | Shop / coins | coins chip | buy coins, bundles | price cards, IAP | filled — NOT cloned (see skip list) |
| S16 | Daily reward / spin wheel | home banner | free daily coins | wheel, claim btn | available, claimed |
| S17 | Clubs / friends list | social tab | clubs, gifts, friend requests | list, gift btn | empty, filled |
| S18 | Settings | gear icon | audio, language, account | toggles, sliders | filled |
| S19 | Tournament bracket / event | Tournaments tap | event rounds, prizes | bracket, timer, leaderboard | upcoming, live, ended |
| S20 | Pet / collection (2026 updates) | home | cosmetic pet, shiny cards | pet, card gallery | filled — NOT cloned (cosmetic, out of slice) |

20 screens inventoried; our slice builds S02 (simplified), S05, S06, S07,
S08, S09, S10, S11, S12, plus a lightweight S03 rules panel.

## User flows

```
F01 Quick game vs bots
    S02 home -> (bot match, no matchmaking wait) -> S08 table -> S12 results
    clicks: 2. edge: bot difficulty, player idles (timer auto-plays)
F02 Create a friends room
    S02 -> S05 create (house rules) -> S07 lobby -> S08 -> S12
    edge: friends never arrive, host leaves (room closes / host migrates)
F03 Join a friends room
    S02 -> S06 enter code -> S07 lobby -> ready -> S08 -> S12
    edge: wrong code, room full, game already started
F04 Play a turn
    S08: tap a matching card -> (wild: S09 pick color) -> turn passes
    no match: tap draw pile -> draw 1 -> play it if it matches, else pass
    edge: draw pile empties -> discard reshuffled
F05 Answer a +2 / +4 (stacking on)
    S08 pending state: stack same-type card, or (for +4) S10 challenge, or accept and draw the pile
    edge: chain grows 2/4/6...; challenge win -> player who played +4 draws 4;
    challenge loss -> challenger draws 6
F06 Call / catch UNO
    S11: player reaching 1 card taps UNO; if they forget, any opponent taps
    Catch before the next turn ends -> forgetful player draws 2
F07 Round end and rematch
    S08 -> S12 results (points from remaining hands: numbers face value,
    actions 20, wilds 50) -> play again (scores accumulate toward 500) or exit
F08 2v2 team game
    S02 -> 2v2 -> S07 (4 players, partners opposite) -> S08 ->
    round ends when EITHER partner empties a hand; team scores the other
    team's remaining cards
```

## Components

- Card (face: color field, big value/symbol, corner indices; back: brand pattern) — states: playable glow, disabled dim, selected lift
- Avatar chip (name, card-count badge, turn highlight ring, "UNO!" badge)
- Draw pile / discard pile stacks with count
- Current-color indicator + direction arrows
- Turn timer bar (30 s in our house rules)
- UNO button (pulsing when relevant), Catch button
- Color picker (4-color quadrant modal)
- Challenge modal (accept / challenge)
- Room code display + copy, code entry boxes
- House-rule toggle list (stacking, +4 challenge, all-wild, turn timer)
- Player slot / ready tick (lobby)
- Score table (results)
- Toast / banner for game events ("+4 stacked! Total 8")
- Text chat box (lobby + table, simple)

## Inferred data model

```
User        id, display_name, avatar_id, level, xp, coins
            evidence: S02 profile chip, S14; confidence high
            (our clone: display_name only, no accounts, no coins)
Room        id, code (short), host_user_id, mode (classic|2v2|gowild),
            house_rules (json: stacking, challenge, all_wild, timer_sec),
            status (waiting|playing|finished), created_at
            evidence: S05–S07; confidence high
PlayerSeat  room_id, user_id, seat_index, team (a|b|null), ready, connected
            evidence: S07, F08; confidence high
Match       id, room_id, round_no, status, winner_user_id, started_at
RoundState  deck[], hands{user_id: card[]}, discard[], current_color,
            direction (+1|-1), current_seat, pending_draw, pending_type,
            stack_chain, last_play (card, had_color_match), uno_window
            evidence: S08, BlueStacks rules guide; confidence high
Card        color (red|yellow|green|blue|wild), kind
            (number|skip|reverse|draw2|wild|wild4), value (0-9 | null)
            evidence: official rules deck list (108 cards); confidence high
ScoreEntry  match_id, user_id, points, hand_value_breakdown
            evidence: S12, official scoring; confidence high
ChatMessage id, room_id, user_id, text, sent_at   evidence: S07/S08 chat
Tournament / Club / Shop entities exist in the original (S15, S17, S19)
            but are out of our slice — see skip list.
```

## What cannot be cloned (skip list)

- The **"UNO!" name and trademark**, the UNO logo, Mattel branding — ours is
  "UNO Adda", Tanvir's own brand from his earlier build.
- **Card artwork, backs, sounds, music, animations** owned by Mattel — ours
  are original CSS-drawn cards, no copied audio.
- **Coins economy, in-app purchases, ads, Go Wild coin staking** — gambling-
  adjacent monetisation; user requires fully free, so excluded by design.
- **Tournaments / World Series / Championship events, leaderboards** —
  depends on Mattel's player network and servers; network cannot be cloned.
- **Clubs, gifting, friend graph, pets, shiny-card collection** — social
  network + licensed cosmetic content; out of slice.
- **Accounts / cloud saves** — original needs Mattel163 accounts; our clone
  is guest-only by design (name + room code), which also keeps it free.

## Sizing

20 screens in the original, 9 in our slice; 8 flows; 7 core entities.
Hard parts: realtime WebSocket state sync, authoritative turn engine with
stacking/challenge edge cases, reconnects, bot AI. Size: **M** for the full
original; our slice (bots + rooms + 2v2 + house rules) is **S–M** — one
Node server, one static client, in-memory rooms, no database.
