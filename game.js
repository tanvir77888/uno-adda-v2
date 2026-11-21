'use strict';
/*
 * UNO Adda — game engine (pure state machine, no I/O).
 * Clean-room implementation of standard UNO rules plus Tanvir's house rules:
 * stacking (+2 on +2, +4 on +4), Wild Draw Four challenge, UNO call + catch
 * penalty, 7 starting cards, optional All Wild mode.
 * The server drives this for both bot games and online rooms.
 */

const COLORS = ['red', 'yellow', 'green', 'blue'];
let cardSeq = 0;

function buildDeck() {
  const deck = [];
  const add = (color, kind, value) => deck.push({ id: 'c' + (++cardSeq), color, kind, value });
  for (const color of COLORS) {
    add(color, 'number', 0);
    for (let v = 1; v <= 9; v++) { add(color, 'number', v); add(color, 'number', v); }
    for (const kind of ['skip', 'reverse', 'draw2']) { add(color, kind, null); add(color, kind, null); }
  }
  for (let i = 0; i < 4; i++) { add('wild', 'wild', null); add('wild', 'wild4', null); }
  return deck; // 108 cards
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function handValue(cards) {
  return cards.reduce((sum, c) => {
    if (c.kind === 'number') return sum + c.value;
    if (c.kind === 'wild' || c.kind === 'wild4') return sum + 50;
    return sum + 20; // skip / reverse / draw2
  }, 0);
}

/**
 * Create a round. seatIds: 2-4 ids in seat order.
 * rules: { stacking, challenge, allWild }
 */
function createRound(seatIds, rules) {
  const deck = shuffle(buildDeck());
  const hands = {};
  for (const id of seatIds) hands[id] = [];
  for (let n = 0; n < 7; n++) for (const id of seatIds) hands[id].push(deck.pop());

  const state = {
    seats: seatIds.slice(),
    rules,
    deck,
    discard: [],
    hands,
    currentColor: null,
    direction: 1,
    turnIdx: 0,
    pendingDraw: 0,
    pendingKind: null,      // 'draw2' | 'wild4'
    lastWild4: null,        // { seatId, bluff } for the challenge rule
    drewCardId: null,       // card drawn this turn; may be played or passed
    unoSuspect: null,       // seatId at 1 card who did not call UNO
    phase: 'playing',       // 'playing' | 'firstColor' | 'finished'
    winnerSeatId: null,
    events: [],
  };

  // Flip the first card, applying official setup handling.
  for (;;) {
    const top = deck.pop();
    state.discard.push(top);
    if (top.kind === 'wild4') { // goes back into the deck, flip again
      state.discard.pop();
      deck.push(top);
      shuffle(deck);
      continue;
    }
    if (top.kind === 'wild') {
      state.phase = 'firstColor'; // seat 0 picks the starting color
      state.currentColor = null;
      break;
    }
    state.currentColor = top.color;
    if (top.kind === 'skip') {
      state.turnIdx = 1 % seatIds.length; // first player loses a turn
      state.events.push({ type: 'first_skip' });
    } else if (top.kind === 'reverse') {
      state.direction = -1;
      state.turnIdx = seatIds.length - 1; // play goes the other way
      state.events.push({ type: 'first_reverse' });
    } else if (top.kind === 'draw2') {
      drawCards(state, seatIds[0], 2);
      state.turnIdx = 1 % seatIds.length;
      state.events.push({ type: 'first_draw2', seatId: seatIds[0] });
    }
    break;
  }
  return state;
}

function topCard(state) { return state.discard[state.discard.length - 1]; }
function currentSeatId(state) { return state.seats[state.turnIdx]; }

function drawCards(state, seatId, n) {
  const drawn = [];
  for (let i = 0; i < n; i++) {
    if (state.deck.length === 0) reshuffle(state);
    if (state.deck.length === 0) break;
    const card = state.deck.pop();
    state.hands[seatId].push(card);
    drawn.push(card);
  }
  return drawn;
}

function reshuffle(state) {
  if (state.discard.length <= 1) return;
  const top = state.discard.pop();
  state.deck = shuffle(state.discard);
  state.discard = [top];
}

function canPlayOn(state, card) {
  if (state.rules.allWild) return true;
  const top = topCard(state);
  if (card.color === 'wild') return true;
  if (card.color === state.currentColor) return true;
  if (card.kind === 'number' && top.kind === 'number' && card.value === top.value) return true;
  if (card.kind !== 'number' && card.kind === top.kind) return true; // symbol match
  return false;
}

function legalPlays(state, seatId) {
  if (state.phase !== 'playing' || currentSeatId(state) !== seatId) return [];
  const hand = state.hands[seatId];
  if (state.drewCardId) {
    const drawn = hand.find(c => c.id === state.drewCardId);
    return drawn && canPlayOn(state, drawn) ? [drawn] : [];
  }
  if (state.pendingDraw > 0) {
    if (!state.rules.stacking) return [];
    return hand.filter(c => c.kind === state.pendingKind);
  }
  return hand.filter(c => canPlayOn(state, c));
}

function advance(state, steps) {
  const n = state.seats.length;
  state.turnIdx = ((state.turnIdx + state.direction * steps) % n + n) % n;
  state.drewCardId = null;
}

// Called whenever a turn fully ends: an UNO suspect who survived the next
// player's completed turn is no longer catchable.
function closeUnoWindow(state, actorSeatId) {
  if (state.unoSuspect && state.unoSuspect !== actorSeatId) state.unoSuspect = null;
}

function finishRound(state, winnerSeatId, events) {
  state.phase = 'finished';
  state.winnerSeatId = winnerSeatId;
  const breakdown = {};
  for (const id of state.seats) breakdown[id] = handValue(state.hands[id]);
  events.push({ type: 'round_end', winnerSeatId, breakdown });
  return { ok: true, events };
}

function applyFirstColor(state, seatId, color) {
  if (state.phase !== 'firstColor') return err('No color choice is pending');
  if (seatId !== state.seats[0]) return err('Only the first player picks the starting color');
  if (!COLORS.includes(color)) return err('Pick a valid color');
  state.currentColor = color;
  state.phase = 'playing';
  state.turnIdx = 0;
  return { ok: true, events: [{ type: 'color_chosen', color, seatId }] };
}

function applyPlay(state, seatId, cardId, opts = {}) {
  const events = [];
  if (state.phase === 'firstColor') return err('Pick the starting color first');
  if (state.phase !== 'playing') return err('The round is over');
  if (currentSeatId(state) !== seatId) return err('Not your turn');
  const hand = state.hands[seatId];
  const idx = hand.findIndex(c => c.id === cardId);
  if (idx < 0) return err('That card is not in your hand');
  const card = hand[idx];

  if (state.drewCardId && cardId !== state.drewCardId)
    return err('You can only play the card you just drew, or pass');

  if ((card.kind === 'wild' || card.kind === 'wild4') && !COLORS.includes(opts.chosenColor))
    return err('Pick a color for the Wild card');

  const stackingPlay = state.pendingDraw > 0;
  if (stackingPlay) {
    if (!state.rules.stacking || card.kind !== state.pendingKind)
      return err(state.pendingKind === 'draw2'
        ? 'You must stack a +2 or take the cards'
        : 'You must stack a +4, challenge, or take the cards');
  } else if (!canPlayOn(state, card)) {
    return err('That card does not match the color, number or symbol');
  }

  const colorBefore = state.currentColor;
  hand.splice(idx, 1);
  state.discard.push(card);
  state.drewCardId = null;
  events.push({ type: 'played', seatId, card });

  // UNO declaration check (before effects, while hand size is final).
  if (hand.length === 1) {
    if (opts.callUno) { state.unoSuspect = null; events.push({ type: 'uno_called', seatId }); }
    else { state.unoSuspect = seatId; events.push({ type: 'uno_suspect', seatId }); }
  } else if (hand.length > 1) {
    state.unoSuspect = null;
  }

  // Round won? A final +2/+4 still makes the next player draw before scoring.
  if (hand.length === 0) {
    if (card.kind === 'draw2' || card.kind === 'wild4') {
      const victim = state.seats[(state.turnIdx + state.direction + state.seats.length) % state.seats.length];
      drawCards(state, victim, card.kind === 'draw2' ? 2 : 4);
      events.push({ type: 'final_draw', seatId: victim });
    }
    return finishRound(state, seatId, events);
  }

  switch (card.kind) {
    case 'skip':
      events.push({ type: 'skipped', seatId: peekSeat(state, 1) });
      advance(state, 2);
      break;
    case 'reverse':
      state.direction *= -1;
      events.push({ type: 'reversed' });
      advance(state, state.seats.length === 2 ? 2 : 1); // 2-player: acts as skip
      break;
    case 'draw2':
      state.pendingDraw = stackingPlay ? state.pendingDraw + 2 : 2;
      state.pendingKind = 'draw2';
      events.push({ type: 'pending', seatId: peekSeat(state, 1), total: state.pendingDraw, kind: 'draw2' });
      advance(state, 1);
      break;
    case 'wild':
      state.currentColor = opts.chosenColor;
      events.push({ type: 'color_chosen', color: state.currentColor, seatId });
      advance(state, 1);
      break;
    case 'wild4': {
      // Bluff = player held another card of the color in effect (besides the +4).
      const bluff = hand.some(c => c.color === colorBefore);
      state.lastWild4 = { seatId, bluff };
      state.pendingDraw = stackingPlay ? state.pendingDraw + 4 : 4;
      state.pendingKind = 'wild4';
      state.currentColor = opts.chosenColor;
      events.push({ type: 'color_chosen', color: state.currentColor, seatId });
      events.push({ type: 'pending', seatId: peekSeat(state, 1), total: state.pendingDraw, kind: 'wild4' });
      advance(state, 1);
      break;
    }
    default: // number
      state.currentColor = card.color;
      advance(state, 1);
  }
  if (card.kind !== 'wild' && card.kind !== 'wild4' && card.color !== 'wild') {
    state.currentColor = card.color;
  }
  closeUnoWindow(state, seatId);
  return { ok: true, events };
}

function peekSeat(state, steps) {
  const n = state.seats.length;
  return state.seats[((state.turnIdx + state.direction * steps) % n + n) % n];
}

function applyDraw(state, seatId) {
  if (state.phase !== 'playing') return err('The round is not running');
  if (currentSeatId(state) !== seatId) return err('Not your turn');
  if (state.drewCardId) return err('You already drew a card');
  const events = [];

  if (state.pendingDraw > 0) {
    const n = state.pendingDraw;
    drawCards(state, seatId, n);
    events.push({ type: 'took_pending', seatId, count: n });
    state.pendingDraw = 0;
    state.pendingKind = null;
    state.lastWild4 = null;
    closeUnoWindow(state, seatId);
    advance(state, 1);
    return { ok: true, events };
  }

  const drawn = drawCards(state, seatId, 1);
  events.push({ type: 'drew', seatId, count: 1 });
  const card = drawn[0];
  if (card && canPlayOn(state, card)) {
    state.drewCardId = card.id; // player may play it or pass
    events.push({ type: 'drew_playable', seatId });
  } else {
    closeUnoWindow(state, seatId);
    advance(state, 1);
  }
  return { ok: true, events };
}

function applyPass(state, seatId) {
  if (state.phase !== 'playing') return err('The round is not running');
  if (currentSeatId(state) !== seatId) return err('Not your turn');
  if (!state.drewCardId) return err('You can only pass right after drawing');
  state.drewCardId = null;
  closeUnoWindow(state, seatId);
  advance(state, 1);
  return { ok: true, events: [{ type: 'passed', seatId }] };
}

function applyChallenge(state, seatId) {
  if (state.phase !== 'playing') return err('The round is not running');
  if (currentSeatId(state) !== seatId) return err('Not your turn');
  if (!state.rules.challenge) return err('Challenge is off in this room');
  if (state.pendingKind !== 'wild4' || !state.lastWild4)
    return err('There is no Wild Draw Four to challenge');
  const events = [];
  const accused = state.lastWild4.seatId;
  const bluff = state.lastWild4.bluff;
  const total = state.pendingDraw;
  state.pendingDraw = 0;
  state.pendingKind = null;
  state.lastWild4 = null;
  if (state.unoSuspect === seatId || state.unoSuspect === accused) state.unoSuspect = null;

  if (bluff) {
    drawCards(state, accused, 4);
    events.push({ type: 'challenge_won', seatId, accused });
    // challenger keeps the turn and plays normally
  } else {
    drawCards(state, seatId, total + 2);
    events.push({ type: 'challenge_lost', seatId, accused, count: total + 2 });
    closeUnoWindow(state, seatId);
    advance(state, 1);
  }
  return { ok: true, events };
}

function applyCallUno(state, seatId) {
  if (state.unoSuspect === seatId) {
    state.unoSuspect = null;
    return { ok: true, events: [{ type: 'uno_called', seatId }] };
  }
  if (state.hands[seatId] && state.hands[seatId].length === 1)
    return { ok: true, events: [{ type: 'uno_called', seatId }] };
  return err('Nothing to call UNO on right now');
}

function applyCatchUno(state, catcherId, targetId) {
  if (state.phase !== 'playing') return err('The round is not running');
  if (state.unoSuspect !== targetId) return err('That player is not catchable right now');
  if (catcherId === targetId) return err('You cannot catch yourself');
  drawCards(state, targetId, 2);
  state.unoSuspect = null;
  return { ok: true, events: [{ type: 'uno_caught', seatId: targetId, catcherId }] };
}

function applyTimeout(state, seatId) {
  if (state.phase === 'firstColor') {
    const color = mostCommonColor(state.hands[state.seats[0]]);
    return applyFirstColor(state, state.seats[0], color);
  }
  if (state.phase !== 'playing' || currentSeatId(state) !== seatId) return { ok: true, events: [] };
  if (state.drewCardId) return applyPass(state, seatId);
  const res = applyDraw(state, seatId);
  if (res.ok && state.drewCardId) { // drew a playable card but time is up: pass
    state.drewCardId = null;
    advance(state, 1);
  }
  if (res.ok) res.events.push({ type: 'timeout', seatId });
  return res;
}

function mostCommonColor(hand) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of hand) if (counts[c.color] !== undefined) counts[c.color]++;
  return COLORS.reduce((a, b) => (counts[b] > counts[a] ? b : a), 'red');
}

function err(message) { return { ok: false, error: message }; }

module.exports = {
  COLORS, buildDeck, handValue, createRound, topCard, currentSeatId,
  legalPlays, canPlayOn, applyFirstColor, applyPlay, applyDraw, applyPass,
  applyChallenge, applyCallUno, applyCatchUno, applyTimeout, mostCommonColor,
};
