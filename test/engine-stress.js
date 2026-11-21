'use strict';
/*
 * Engine stress test: plays many full rounds with random legal moves
 * (stacking + challenge + All Wild variants, 2-4 players) and asserts every
 * round finishes with a consistent card count (108) and a valid winner.
 * Run: node test/engine-stress.js
 */
const G = require('../game');

function randomPlayRound(seatCount, rules, label) {
  const seats = Array.from({ length: seatCount }, (_, i) => 'p' + i);
  const s = G.createRound(seats, rules);
  let guard = 0;
  while (s.phase !== 'finished' && guard++ < 20000) {
    if (s.phase === 'firstColor') {
      const r = G.applyFirstColor(s, s.seats[0], G.mostCommonColor(s.hands[s.seats[0]]));
      if (!r.ok) throw new Error(label + ': firstColor failed: ' + r.error);
      continue;
    }
    const me = G.currentSeatId(s);
    // random UNO catch attempts by others when a suspect exists
    if (s.unoSuspect && Math.random() < 0.5) {
      const catcher = seats.find(id => id !== s.unoSuspect);
      G.applyCatchUno(s, catcher, s.unoSuspect);
    }
    if (s.pendingKind === 'wild4' && s.pendingDraw > 0 && Math.random() < 0.35) {
      const r = G.applyChallenge(s, me);
      if (r.ok) continue;
    }
    const legal = G.legalPlays(s, me);
    if (legal.length) {
      const card = legal[Math.floor(Math.random() * legal.length)];
      const r = G.applyPlay(s, me, card.id, {
        chosenColor: G.mostCommonColor(s.hands[me]),
        callUno: Math.random() < 0.8,
      });
      if (!r.ok) throw new Error(label + ': play failed: ' + r.error);
    } else if (s.drewCardId) {
      G.applyPass(s, me);
    } else {
      const r = G.applyDraw(s, me);
      if (!r.ok) throw new Error(label + ': draw failed: ' + r.error);
      if (s.drewCardId && Math.random() < 0.7) {
        const drawn = s.hands[me].find(c => c.id === s.drewCardId);
        const r2 = G.applyPlay(s, me, drawn.id, { chosenColor: 'red', callUno: true });
        if (!r2.ok) throw new Error(label + ': drawn play failed: ' + r2.error);
      } else if (s.drewCardId) {
        G.applyPass(s, me);
      }
    }
    const total = s.deck.length + s.discard.length + seats.reduce((n, id) => n + s.hands[id].length, 0);
    if (total !== 108) throw new Error(label + ': card count drifted to ' + total);
  }
  if (s.phase !== 'finished') throw new Error(label + ': round never finished');
  if (!seats.includes(s.winnerSeatId)) throw new Error(label + ': bad winner');
  if (s.hands[s.winnerSeatId].length !== 0) throw new Error(label + ': winner still holds cards');
  return G.handValue(seats.filter(id => id !== s.winnerSeatId).flatMap(id => s.hands[id]));
}

let rounds = 0;
for (const rules of [
  { stacking: true, challenge: true, allWild: false },
  { stacking: false, challenge: true, allWild: false },
  { stacking: true, challenge: false, allWild: false },
  { stacking: true, challenge: true, allWild: true },
]) {
  for (const n of [2, 3, 4]) {
    for (let i = 0; i < 40; i++) {
      randomPlayRound(n, rules, `rules=${JSON.stringify(rules)} players=${n}`);
      rounds++;
    }
  }
}
console.log(`ENGINE STRESS PASSED — ${rounds} full rounds finished, 108 cards conserved in every step`);
