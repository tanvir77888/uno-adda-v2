'use strict';
/*
 * UNO Adda — server. One Node process: static client + WebSocket rooms.
 * All game rules live in game.js; this file owns rooms, seats, bots,
 * timers and snapshots. Rooms are in memory; a room dies with the process.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const G = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(PUBLIC, urlPath);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server: httpServer });

// ---------------------------------------------------------------- rooms
const rooms = new Map(); // code -> room
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const BOT_NAMES = ['Bot Rafi', 'Bot Nila', 'Bot Tanu'];
let seatSeq = 0;

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}
const newToken = () => crypto.randomBytes(12).toString('hex');
const newSeatId = () => 's' + (++seatSeq);

function makeSeat(name, isBot) {
  return { id: newSeatId(), token: newToken(), name: String(name || 'Player').slice(0, 20), isBot: !!isBot, ready: false, connected: true, team: null, ws: null };
}

function makeRoom(hostSeat, mode, rules) {
  const room = {
    code: newCode(),
    hostSeatId: hostSeat.id,
    mode: mode === '2v2' ? '2v2' : 'classic',
    rules: {
      stacking: rules.stacking !== false,
      challenge: rules.challenge !== false,
      allWild: !!rules.allWild,
      timerSec: 30,
    },
    status: 'waiting', // waiting | playing | roundEnd
    seats: [hostSeat],
    game: null,
    scores: {},
    roundNo: 0,
    chat: [],
    timers: { turn: null, bot: null },
    lastEvents: [],
  };
  room.scores[hostSeat.id] = 0;
  rooms.set(room.code, room);
  return room;
}

function assignTeams(room) {
  room.seats.forEach((s, i) => { s.team = room.mode === '2v2' ? (i % 2 === 0 ? 'a' : 'b') : null; });
}

function startRound(room) {
  assignTeams(room);
  room.game = G.createRound(room.seats.map(s => s.id), room.rules);
  room.status = 'playing';
  room.roundNo++;
  afterChange(room, room.game.events);
}

function finishIfEnded(room) {
  const g = room.game;
  if (!g || g.phase !== 'finished' || room.status !== 'playing') return;
  room.status = 'roundEnd';
  const breakdown = {};
  for (const id of g.seats) breakdown[id] = G.handValue(g.hands[id]);
  const winner = room.seats.find(s => s.id === g.winnerSeatId);
  if (room.mode === '2v2' && winner) {
    const pts = g.seats
      .filter(id => room.seats.find(s => s.id === id).team !== winner.team)
      .reduce((sum, id) => sum + breakdown[id], 0);
    for (const s of room.seats) if (s.team === winner.team) room.scores[s.id] += pts;
    room.lastRound = { winnerSeatId: g.winnerSeatId, teamPoints: pts, breakdown };
  } else if (winner) {
    const pts = g.seats.filter(id => id !== g.winnerSeatId).reduce((sum, id) => sum + breakdown[id], 0);
    room.scores[g.winnerSeatId] += pts;
    room.lastRound = { winnerSeatId: g.winnerSeatId, teamPoints: pts, breakdown };
  }
}

// ---------------------------------------------------------------- snapshots
function snapshotFor(room, viewer) {
  const g = room.game;
  const snap = {
    type: 'state',
    room: { code: room.code, mode: room.mode, rules: room.rules, status: room.status, hostSeatId: room.hostSeatId, roundNo: room.roundNo },
    you: { seatId: viewer.id, token: viewer.token },
    seats: room.seats.map(s => ({
      id: s.id, name: s.name, isBot: s.isBot, ready: s.ready, connected: s.connected,
      team: s.team, score: room.scores[s.id] || 0,
      cardCount: g ? g.hands[s.id].length : 0,
      isCurrent: g ? G.currentSeatId(g) === s.id : false,
      isYou: s.id === viewer.id,
    })),
    chat: room.chat.slice(-30),
    events: room.lastEvents,
    game: null,
    lastRound: room.status === 'roundEnd' ? room.lastRound : null,
    matchWinnerSeatId: matchWinner(room),
  };
  if (g) {
    snap.game = {
      phase: g.phase,
      yourHand: g.hands[viewer.id].slice(),
      topCard: G.topCard(g),
      currentColor: g.currentColor,
      direction: g.direction,
      drawPileCount: g.deck.length,
      pendingDraw: g.pendingDraw,
      pendingKind: g.pendingKind,
      canChallenge: g.pendingKind === 'wild4' && G.currentSeatId(g) === viewer.id && room.rules.challenge,
      youMustPickColor: g.phase === 'firstColor' && g.seats[0] === viewer.id,
      drewCardId: G.currentSeatId(g) === viewer.id ? g.drewCardId : null,
      unoSuspect: g.unoSuspect,
      legalCardIds: G.legalPlays(g, viewer.id).map(c => c.id),
      turnEndsAt: room.turnEndsAt || null,
      isYourTurn: G.currentSeatId(g) === viewer.id && g.phase === 'playing',
    };
  }
  return snap;
}

function matchWinner(room) {
  const hit = room.seats.find(s => (room.scores[s.id] || 0) >= 500);
  return hit ? hit.id : null;
}

function broadcast(room) {
  for (const s of room.seats) {
    if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify(snapshotFor(room, s)));
  }
}

function sendError(ws, message) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message }));
}

// ---------------------------------------------------------------- turn flow
function clearTimers(room) {
  if (room.timers.turn) clearTimeout(room.timers.turn);
  if (room.timers.bot) clearTimeout(room.timers.bot);
  room.timers.turn = room.timers.bot = null;
}

function afterChange(room, events) {
  room.lastEvents = events || [];
  finishIfEnded(room);
  broadcast(room);
  schedule(room);
}

function schedule(room) {
  clearTimers(room);
  const g = room.game;
  if (room.status !== 'playing' || !g || g.phase === 'finished') return;
  room.turnEndsAt = Date.now() + room.rules.timerSec * 1000;
  room.timers.turn = setTimeout(() => {
    const seatId = g.phase === 'firstColor' ? g.seats[0] : G.currentSeatId(g);
    const res = G.applyTimeout(g, seatId);
    afterChange(room, res.events || []);
  }, room.rules.timerSec * 1000);

  const currentId = g.phase === 'firstColor' ? g.seats[0] : G.currentSeatId(g);
  const current = room.seats.find(s => s.id === currentId);
  if (current && current.isBot) {
    room.timers.bot = setTimeout(() => botAct(room), 750 + Math.random() * 800);
  }
}

// ---------------------------------------------------------------- bots
function botAct(room) {
  const g = room.game;
  if (!g || room.status !== 'playing' || g.phase === 'finished') return;
  const seatId = g.phase === 'firstColor' ? g.seats[0] : G.currentSeatId(g);
  const seat = room.seats.find(s => s.id === seatId);
  if (!seat || !seat.isBot) return;
  let res;
  if (g.phase === 'firstColor') {
    res = G.applyFirstColor(g, seatId, G.mostCommonColor(g.hands[seatId]));
    return afterChange(room, res.events || []);
  }
  // UNO catch: if a human forgot, bots notice half the time (checked each bot turn).
  if (g.pendingDraw > 0 && g.pendingKind === 'wild4' && Math.random() < 0.3) {
    res = G.applyChallenge(g, seatId);
    if (res.ok) return afterChange(room, res.events);
  }
  const legal = G.legalPlays(g, seatId);
  if (legal.length === 0) {
    res = G.applyDraw(g, seatId);
    return afterChange(room, res.events || []);
  }
  const hand = g.hands[seatId];
  const pick = legal.reduce((best, c) => (botCardScore(c, hand) > botCardScore(best, hand) ? c : best), legal[0]);
  const callUno = hand.length === 2 && Math.random() < 0.92;
  const chosenColor = pick.color === 'wild' ? G.mostCommonColor(hand) : undefined;
  res = G.applyPlay(g, seatId, pick.id, { chosenColor, callUno });
  if (!res.ok) { // fall back to drawing rather than stalling the game
    res = G.applyDraw(g, seatId);
  }
  afterChange(room, res.events || []);
}

function botCardScore(card, hand) {
  let v = card.kind === 'number' ? card.value : card.kind === 'wild' || card.kind === 'wild4' ? 50 : 20;
  if (card.kind === 'wild') v -= 35;  // keep plain wilds in reserve
  if (card.kind === 'wild4') v -= 25;
  if (hand.length <= 2) v += 60;      // late game: dump high cards
  return v;
}

// Bots also catch a forgotten UNO from time to time.
setInterval(() => {
  for (const room of rooms.values()) {
    const g = room.game;
    if (!g || room.status !== 'playing' || !g.unoSuspect) continue;
    const suspect = room.seats.find(s => s.id === g.unoSuspect);
    if (!suspect || suspect.isBot) continue;
    const bot = room.seats.find(s => s.isBot && s.id !== g.unoSuspect);
    if (bot && Math.random() < 0.25) {
      const res = G.applyCatchUno(g, bot.id, g.unoSuspect);
      if (res.ok) afterChange(room, res.events);
    }
  }
}, 1500);

// ---------------------------------------------------------------- ws handling
function findSeatByToken(room, token) { return room.seats.find(s => s.token === token); }

wss.on('connection', (ws) => {
  let ctx = { room: null, seat: null };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return sendError(ws, 'Bad message'); }
    try { handle(ws, ctx, msg, (r, s) => { ctx = { room: r, seat: s }; }); }
    catch (e) { sendError(ws, 'Server error: ' + e.message); }
  });

  ws.on('close', () => {
    const { room, seat } = ctx;
    if (!room || !seat) return;
    seat.connected = false;
    seat.ws = null;
    if (room.status === 'waiting' && seat.id === room.hostSeatId) {
      for (const s of room.seats) if (s.ws && s.ws !== ws) sendError(s.ws, 'The host left — room closed');
      rooms.delete(room.code);
      return;
    }
    if (!room.seats.some(s => !s.isBot && s.connected)) { rooms.delete(room.code); return; }
    broadcast(room);
    schedule(room);
  });
});

function handle(ws, ctx, msg, setCtx) {
  switch (msg.type) {
    case 'create_bot_game': {
      const seat = makeSeat(msg.name, false);
      seat.ws = ws; seat.ready = true;
      const room = makeRoom(seat, 'classic', msg.rules || {});
      const bots = Math.min(3, Math.max(1, msg.botCount || 1));
      for (let i = 0; i < bots; i++) {
        const bot = makeSeat(BOT_NAMES[i % BOT_NAMES.length], true);
        bot.ready = true;
        room.seats.push(bot);
        room.scores[bot.id] = 0;
      }
      setCtx(room, seat);
      startRound(room);
      return;
    }
    case 'create_room': {
      const seat = makeSeat(msg.name, false);
      seat.ws = ws;
      const room = makeRoom(seat, msg.mode, msg.rules || {});
      setCtx(room, seat);
      afterChange(room, []);
      return;
    }
    case 'join_room': {
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) return sendError(ws, 'Room not found — check the code');
      if (msg.token) {
        const existing = findSeatByToken(room, msg.token);
        if (existing && !existing.isBot) {
          existing.ws = ws; existing.connected = true;
          if (msg.name) existing.name = String(msg.name).slice(0, 20);
          setCtx(room, existing);
          afterChange(room, []);
          return;
        }
      }
      if (room.status !== 'waiting') return sendError(ws, 'That game has already started');
      if (room.seats.length >= 4) return sendError(ws, 'That room is full');
      const seat = makeSeat(msg.name, false);
      seat.ws = ws;
      room.seats.push(seat);
      room.scores[seat.id] = 0;
      setCtx(room, seat);
      afterChange(room, []);
      return;
    }
  }

  const { room, seat } = ctx;
  if (!room || !seat) return sendError(ws, 'Join a room first');

  switch (msg.type) {
    case 'set_ready':
      seat.ready = !!msg.ready;
      return afterChange(room, []);
    case 'start_game': {
      if (seat.id !== room.hostSeatId) return sendError(ws, 'Only the host can start');
      if (room.status === 'playing') return sendError(ws, 'The game is already running');
      if (room.seats.length < 2) return sendError(ws, 'You need at least 2 players');
      if (room.mode === '2v2' && room.seats.length !== 4) return sendError(ws, '2v2 needs exactly 4 players');
      if (room.seats.some(s => !s.isBot && s.id !== room.hostSeatId && !s.ready))
        return sendError(ws, 'Everyone must be ready first');
      return startRound(room);
    }
    case 'play_card': {
      const res = G.applyPlay(room.game, seat.id, msg.cardId, { chosenColor: msg.chosenColor, callUno: !!msg.callUno });
      if (!res.ok) return sendError(ws, res.error);
      return afterChange(room, res.events);
    }
    case 'draw_card': {
      const res = G.applyDraw(room.game, seat.id);
      if (!res.ok) return sendError(ws, res.error);
      return afterChange(room, res.events);
    }
    case 'pass': {
      const res = G.applyPass(room.game, seat.id);
      if (!res.ok) return sendError(ws, res.error);
      return afterChange(room, res.events);
    }
    case 'challenge': {
      const res = G.applyChallenge(room.game, seat.id);
      if (!res.ok) return sendError(ws, res.error);
      return afterChange(room, res.events);
    }
    case 'pick_color': {
      const res = G.applyFirstColor(room.game, seat.id, msg.color);
      if (!res.ok) return sendError(ws, res.error);
      return afterChange(room, res.events);
    }
    case 'call_uno': {
      const res = G.applyCallUno(room.game, seat.id);
      if (!res.ok) return sendError(ws, res.error);
      return afterChange(room, res.events);
    }
    case 'catch_uno': {
      const res = G.applyCatchUno(room.game, seat.id, msg.targetSeatId);
      if (!res.ok) return sendError(ws, res.error);
      return afterChange(room, res.events);
    }
    case 'chat': {
      const text = String(msg.text || '').trim().slice(0, 200);
      if (!text) return;
      room.chat.push({ name: seat.name, text, at: Date.now() });
      if (room.chat.length > 50) room.chat.shift();
      return broadcast(room);
    }
    case 'leave': {
      seat.connected = false; seat.ws = null;
      if (room.status === 'waiting') {
        room.seats = room.seats.filter(s => s.id !== seat.id);
        delete room.scores[seat.id];
        if (seat.id === room.hostSeatId || room.seats.length === 0) {
          for (const s of room.seats) if (s.ws) sendError(s.ws, 'The room was closed');
          rooms.delete(room.code);
          return;
        }
      }
      setCtx(null, null);
      return broadcast(room);
    }
    default:
      return sendError(ws, 'Unknown message: ' + msg.type);
  }
}

httpServer.listen(PORT, () => console.log('UNO Adda server listening on :' + PORT));
