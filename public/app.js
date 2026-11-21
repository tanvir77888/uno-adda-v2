'use strict';
/* UNO Adda — client. Renders server snapshots; holds no game rules. */

const $ = (id) => document.getElementById(id);
const COLOR_NAMES = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };

let ws = null;
let snap = null;               // latest state snapshot
let unoArmed = false;          // UNO button pressed, declaration rides the next play
let pendingWildCard = null;    // card id waiting on the color picker
let colorPurpose = null;       // 'wild' | 'first'
let lastEventKey = '';
let chatSeen = { lobby: 0, game: 0 };

// ------------------------------------------------------------ connection
function connect(onOpen) {
  if (ws && ws.readyState <= 1) { if (onOpen) onOpen(); return; }
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => {
    if (onOpen) onOpen();
    if (voice.joined && voice.rejoinPending) { // socket dropped mid-voice: re-announce so peers re-offer
      voice.rejoinPending = false;
      setTimeout(() => { if (voice.joined) send({ type: 'voice_join' }); }, 600);
    }
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') { snap = msg; onSnapshot(msg); }
    else if (msg.type === 'error') { showError(msg.message); }
    else if (msg.type === 'voice_roster') onVoiceRoster(msg);
    else if (msg.type === 'voice_peer_joined') closePeer(msg.seatId); // fresh offer is coming; drop any stale pc
    else if (msg.type === 'voice_peer_left') closePeer(msg.seatId);
    else if (msg.type === 'voice_signal') onVoiceSignal(msg);
  };
  ws.onclose = () => {
    ws = null;
    if (voice.joined) { voice.rejoinPending = true; [...voice.peers.keys()].forEach(closePeer); }
    toast('Connection lost — trying to reconnect…');
    setTimeout(() => connect(tryRestore), 1500);
  };
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function myName() { return ($('in-name').value || '').trim() || 'Player'; }
function saveSession() {
  if (snap) localStorage.setItem('uno-adda-session', JSON.stringify({ code: snap.room.code, token: snap.you.token, name: myName() }));
}
function tryRestore() {
  try {
    const s = JSON.parse(localStorage.getItem('uno-adda-session') || 'null');
    if (s && s.code && s.token) send({ type: 'join_room', code: s.code, token: s.token, name: s.name });
  } catch { /* nothing saved */ }
}

// ------------------------------------------------------------ home setup
function ruleTogglesHtml() {
  return `
    <label><input type="checkbox" data-rule="stacking" checked> Stacking +2/+4</label>
    <label><input type="checkbox" data-rule="challenge" checked> +4 Challenge</label>
    <label><input type="checkbox" data-rule="allWild"> All Wild</label>`;
}
function readRules(containerId) {
  const rules = {};
  document.querySelectorAll('#' + containerId + ' input[data-rule]').forEach(i => { rules[i.dataset.rule] = i.checked; });
  return rules;
}
$('bot-toggles').innerHTML = ruleTogglesHtml();
$('room-toggles').innerHTML = ruleTogglesHtml();
$('in-name').value = localStorage.getItem('uno-adda-name') || '';
$('in-name').addEventListener('change', () => localStorage.setItem('uno-adda-name', myName()));

$('btn-bots').onclick = () => connect(() => send({
  type: 'create_bot_game', name: myName(),
  botCount: parseInt($('in-bots').value, 10), rules: readRules('bot-toggles'),
}));
$('btn-create').onclick = () => connect(() => send({
  type: 'create_room', name: myName(), mode: $('in-mode').value, rules: readRules('room-toggles'),
}));
$('btn-join').onclick = () => {
  const code = $('in-code').value.trim().toUpperCase();
  if (code.length !== 6) return showError('Enter the 6-letter room code');
  connect(() => send({ type: 'join_room', code, name: myName() }));
};

// ------------------------------------------------------------ snapshot routing
function onSnapshot(msg) {
  saveSession();
  const status = msg.room.status;
  showView(status === 'waiting' ? 'lobby' : 'game');
  if (status === 'waiting') renderLobby(msg); else renderGame(msg);
  renderVoice(msg);
  handleEvents(msg);
  renderChat('lobby', msg.chat);
  renderChat('game', msg.chat);
  if (msg.game && msg.game.youMustPickColor && msg.game.phase === 'firstColor') openColorPicker('first');
  if (status !== 'roundEnd') $('end-modal').classList.add('hidden');
  if (status === 'roundEnd') renderEnd(msg);
}

function showView(name) {
  for (const v of ['home', 'lobby', 'game']) $('view-' + v).classList.toggle('hidden', v !== name);
}

function showError(message) {
  for (const id of ['home-error', 'lobby-error']) { const el = $(id); if (el) el.textContent = message; }
  if (snap) toast(message);
  if (/Room not found/.test(message)) localStorage.removeItem('uno-adda-session');
}

// ------------------------------------------------------------ lobby
function renderLobby(msg) {
  $('lobby-code').textContent = msg.room.code;
  const r = msg.room.rules;
  $('lobby-meta').textContent =
    (msg.room.mode === '2v2' ? '2v2 Teams' : 'Classic') +
    ' · Stacking ' + (r.stacking ? 'on' : 'off') +
    ' · Challenge ' + (r.challenge ? 'on' : 'off') +
    ' · All Wild ' + (r.allWild ? 'on' : 'off') +
    ' · 30s turns · first to 500';
  const me = msg.seats.find(s => s.isYou);
  $('lobby-seats').innerHTML = msg.seats.map(s => `
    <div class="seat-row" data-voice-mark="${s.id}">
      <div class="avatar">${esc(initials(s.name))}</div>
      <div class="grow"><b>${esc(s.name)}</b>${s.isYou ? ' (you)' : ''}${s.isBot ? ' 🤖' : ''}<br>
      <span class="muted">Score: ${s.score}</span></div>
      ${s.id === msg.room.hostSeatId ? '<span class="badge host">HOST</span>' : ''}
      ${s.ready ? '<span class="badge ready">READY ✓</span>' : '<span class="badge">not ready</span>'}
    </div>`).join('');
  const isHost = me && me.id === msg.room.hostSeatId;
  $('btn-ready').classList.toggle('hidden', !!isHost);
  $('btn-ready').textContent = me && me.ready ? 'Ready ✓ (tap to undo)' : "I'm Ready";
  $('btn-start').classList.toggle('hidden', !isHost);
}
$('btn-copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText($('lobby-code').textContent); toast('Room code copied'); };
$('btn-ready').onclick = () => {
  const me = snap.seats.find(s => s.isYou);
  send({ type: 'set_ready', ready: !(me && me.ready) });
};
$('btn-start').onclick = () => send({ type: 'start_game' });
$('btn-leave-lobby').onclick = leaveRoom;
$('btn-leave-game').onclick = leaveRoom;
function leaveRoom() {
  leaveVoice(false);
  send({ type: 'leave' });
  localStorage.removeItem('uno-adda-session');
  snap = null;
  showView('home');
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

// ------------------------------------------------------------ game rendering
function renderGame(msg) {
  const g = msg.game;
  const me = msg.seats.find(s => s.isYou);

  // opponents
  $('opponents').innerHTML = msg.seats.filter(s => !s.isYou).map(s => `
    <div class="opp ${s.isCurrent ? 'current' : ''} ${s.connected ? '' : 'disc'}" data-voice-mark="${s.id}">
      <div class="avatar">${esc(initials(s.name))}</div>
      <div><b>${esc(s.name)}</b>${s.isBot ? ' 🤖' : ''}</div>
      <div class="muted">${s.cardCount} cards · ${s.score} pts${s.team ? ' · Team ' + s.team.toUpperCase() : ''}</div>
      <div class="backs">${backsHtml(Math.min(s.cardCount, 7))}</div>
      ${g && g.unoSuspect === s.id ? `<button class="catch" data-catch="${s.id}">CATCH!</button>` : ''}
    </div>`).join('');
  document.querySelectorAll('[data-catch]').forEach(b => b.onclick = () => send({ type: 'catch_uno', targetSeatId: b.dataset.catch }));

  // piles
  $('discard-pile').innerHTML = g ? cardHtml(g.topCard, false) : '';
  $('draw-count').textContent = g ? g.drawPileCount + ' cards' : '';
  const ci = $('color-indicator');
  if (g && g.currentColor) { ci.style.background = 'var(--' + g.currentColor + ')'; ci.textContent = COLOR_NAMES[g.currentColor]; }
  else { ci.style.background = '#444'; ci.textContent = 'Pick'; }

  // banners
  const current = msg.seats.find(s => s.isCurrent);
  $('turn-banner').textContent = !g ? '' :
    g.phase === 'firstColor' ? (g.youMustPickColor ? 'You flipped a Wild — pick the starting color!' : 'Waiting for the starting color…') :
    g.isYourTurn ? 'Your turn!' : (current ? current.name + "'s turn…" : '');
  $('pending-banner').textContent = g && g.pendingDraw > 0
    ? (g.isYourTurn
        ? `You owe ${g.pendingDraw} cards — stack a ${g.pendingKind === 'draw2' ? '+2' : '+4'}, ${g.pendingKind === 'wild4' && msg.room.rules.challenge ? 'challenge, ' : ''}or take them`
        : `${current ? current.name : 'Next player'} owes ${g.pendingDraw} cards`)
    : '';

  // actions
  $('btn-pass').classList.toggle('hidden', !(g && g.isYourTurn && g.drewCardId));
  $('btn-challenge').classList.toggle('hidden', !(g && g.canChallenge));
  const unoBtn = $('btn-uno');
  unoBtn.classList.toggle('armed', unoArmed);
  unoBtn.classList.toggle('pulse', !!(g && ((me && g.yourHand.length === 2 && g.isYourTurn) || g.unoSuspect === (me && me.id))));

  // my hand
  $('my-info').textContent = me ? `${me.name} · ${me.score} pts${me.team ? ' · Team ' + me.team.toUpperCase() : ''}` : '';
  if (g) {
    const legal = new Set(g.legalCardIds);
    const sorted = g.yourHand.slice().sort(cardSort);
    $('my-hand').innerHTML = sorted.map(c => cardHtml(c, legal.has(c.id), g.drewCardId === c.id)).join('');
    document.querySelectorAll('#my-hand .card').forEach(el => {
      el.onclick = () => onCardTap(el.dataset.id, legal.has(el.dataset.id));
    });
  }
  startTimerBar(g);
}

function cardSort(a, b) {
  const order = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
  if (order[a.color] !== order[b.color]) return order[a.color] - order[b.color];
  return (a.value ?? 99) - (b.value ?? 99);
}

function backsHtml(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += '<div class="card back"><span>A</span></div>';
  return out || '<div class="muted">no cards</div>';
}

function cardHtml(card, playable, isDrew) {
  const label = cardLabel(card);
  const cls = ['card', card.color];
  if (playable === true) cls.push('playable');
  if (playable === false && snap && snap.game) cls.push('dim');
  if (isDrew) cls.push('drew');
  const inner = card.color === 'wild'
    ? `<span class="quad"><i></i><i></i><i></i><i></i></span><span class="wild-label">${label}</span>`
    : `<span class="corner tl">${label}</span><span class="oval"><span class="big">${label}</span></span><span class="corner br">${label}</span>`;
  return `<div class="${cls.join(' ')}" data-id="${card.id}">${inner}</div>`;
}
function cardLabel(card) {
  switch (card.kind) {
    case 'number': return String(card.value);
    case 'skip': return '⊘';
    case 'reverse': return '⇋';
    case 'draw2': return '+2';
    case 'wild': return 'WILD';
    case 'wild4': return '+4';
    default: return '?';
  }
}

function onCardTap(cardId, playable) {
  if (!snap || !snap.game || !snap.game.isYourTurn) return;
  if (!playable) { toast('That card does not match — match the color, number or symbol'); return; }
  const card = snap.game.yourHand.find(c => c.id === cardId);
  if (card && card.color === 'wild') { pendingWildCard = cardId; openColorPicker('wild'); return; }
  doPlay(cardId, undefined);
}
function doPlay(cardId, chosenColor) {
  send({ type: 'play_card', cardId, chosenColor, callUno: unoArmed });
  unoArmed = false;
}

$('draw-pile').onclick = () => { if (snap && snap.game && snap.game.isYourTurn) send({ type: 'draw_card' }); };
$('btn-pass').onclick = () => send({ type: 'pass' });
$('btn-challenge').onclick = () => send({ type: 'challenge' });
$('btn-uno').onclick = () => {
  unoArmed = true;
  send({ type: 'call_uno' });
  toast('UNO declared!');
  renderGame(snap);
};

// ------------------------------------------------------------ color picker
function openColorPicker(purpose) {
  colorPurpose = purpose;
  $('color-modal').classList.remove('hidden');
}
document.querySelectorAll('.color-btn').forEach(b => b.onclick = () => {
  $('color-modal').classList.add('hidden');
  if (colorPurpose === 'first') send({ type: 'pick_color', color: b.dataset.color });
  else if (pendingWildCard) { doPlay(pendingWildCard, b.dataset.color); pendingWildCard = null; }
});

// ------------------------------------------------------------ round end
function renderEnd(msg) {
  const lr = msg.lastRound;
  if (!lr) return;
  const winner = msg.seats.find(s => s.id === lr.winnerSeatId);
  $('end-title').textContent = winner ? `🏆 ${winner.name} wins the round!` : 'Round over';
  const mw = msg.matchWinnerSeatId && msg.seats.find(s => s.id === msg.matchWinnerSeatId);
  $('end-match').textContent = mw ? `🎉 ${mw.name} reached 500 and wins the match! Scores keep counting if you play on.` : `Round points: +${lr.teamPoints}`;
  $('end-table').innerHTML = '<tr><th>Player</th><th>Leftover cards</th><th>Total score</th></tr>' +
    msg.seats.map(s => `<tr><td>${esc(s.name)}${s.isYou ? ' (you)' : ''}</td><td>${lr.breakdown[s.id] ?? 0} pts</td><td>${s.score}</td></tr>`).join('');
  const isHost = msg.you.seatId === msg.room.hostSeatId;
  $('btn-again').classList.toggle('hidden', !isHost);
  $('end-wait').classList.toggle('hidden', isHost);
  $('end-modal').classList.remove('hidden');
}
$('btn-again').onclick = () => { $('end-modal').classList.add('hidden'); send({ type: 'start_game' }); };
$('btn-exit').onclick = () => { $('end-modal').classList.add('hidden'); leaveRoom(); };

// ------------------------------------------------------------ chat
function renderChat(which, chat) {
  const log = $('chat-log-' + which);
  if (!log) return;
  if (chat.length === chatSeen[which] && chatSeen[which] > 0) return;
  chatSeen[which] = chat.length;
  log.innerHTML = chat.map(m => `<div><span class="who">${esc(m.name)}:</span> ${esc(m.text)}</div>`).join('');
  log.scrollTop = log.scrollHeight;
}
document.querySelectorAll('.chat-send').forEach(b => b.onclick = () => sendChat(b.dataset.for));
document.querySelectorAll('.chat-row input').forEach(i => i.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat(i.id.includes('lobby') ? 'lobby' : 'game');
}));
function sendChat(which) {
  const input = $('chat-in-' + which);
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  send({ type: 'chat', text });
}

// ------------------------------------------------------------ events & toasts
function handleEvents(msg) {
  const events = msg.events || [];
  if (!events.length) return;
  const key = JSON.stringify(events) + '|' + msg.room.roundNo + '|' + (msg.game ? msg.game.topCard.id : '');
  if (key === lastEventKey) return;
  lastEventKey = key;
  const name = (id) => { const s = msg.seats.find(x => x.id === id); return s ? s.name : 'Someone'; };
  for (const e of events) {
    switch (e.type) {
      case 'played': break; // too noisy
      case 'skipped': toast(`${name(e.seatId)} is skipped!`); break;
      case 'reversed': toast('Direction reversed ⇋'); break;
      case 'pending': toast(`${e.kind === 'draw2' ? '+2' : '+4'} — ${name(e.seatId)} owes ${e.total} cards!`); break;
      case 'took_pending': toast(`${name(e.seatId)} took ${e.count} cards`); break;
      case 'challenge_won': toast(`Bluff caught! ${name(e.accused)} draws 4`); break;
      case 'challenge_lost': toast(`Challenge failed — ${name(e.seatId)} draws ${e.count}`); break;
      case 'uno_called': toast(`${name(e.seatId)}: UNO!`); break;
      case 'uno_suspect': toast(`${name(e.seatId)} has ONE card — catch them before their turn is safe!`); break;
      case 'uno_caught': toast(`Caught! ${name(e.seatId)} forgot UNO and draws 2`); break;
      case 'timeout': toast(`${name(e.seatId)} ran out of time`); break;
      case 'color_chosen': toast(`Color is now ${COLOR_NAMES[e.color]}`); break;
      case 'round_end': break; // modal covers it
    }
  }
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3400);
}

// ------------------------------------------------------------ timer bar
let timerInterval = null;
function startTimerBar(g) {
  if (timerInterval) clearInterval(timerInterval);
  if (!g || !g.turnEndsAt) { $('timerfill').style.width = '100%'; return; }
  const total = 30000;
  const endsAt = g.turnEndsAt;
  timerInterval = setInterval(() => {
    const left = Math.max(0, endsAt - Date.now());
    const pct = (left / total) * 100;
    const fill = $('timerfill');
    fill.style.width = pct + '%';
    fill.style.background = left < 6000 ? 'var(--red)' : left < 12000 ? 'var(--yellow)' : 'var(--green)';
    if (left <= 0) clearInterval(timerInterval);
  }, 120);
}

// ------------------------------------------------------------ helpers
function initials(name) { return (name || '?').trim().slice(0, 2).toUpperCase(); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ------------------------------------------------------------ voice chat (WebRTC mesh)
// Peer-to-peer audio; the server only relays signaling inside the room.
// Optional — the game works fully without it. New joiners offer to the
// members already in voice, so there is exactly one offerer per pair.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const voice = {
  joined: false, muted: false, rejoinPending: false,
  stream: null, ctx: null,
  peers: new Map(),  // seatId -> { pc, audio }
  levels: new Map(), // seatId -> { analyser, data }
  meterTimer: null,
};

function mySeatId() { return snap && snap.you ? snap.you.seatId : null; }

function voiceNote(text) {
  document.querySelectorAll('.voice-note').forEach(el => { el.textContent = text; });
  if (text) toast(text);
}

async function joinVoice() {
  if (voice.joined) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof RTCPeerConnection === 'undefined') {
    return voiceNote('Voice chat needs a secure page (HTTPS or localhost) and a browser with microphone support.');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return voiceNote('Microphone permission was denied — allow mic access in your browser settings, then tap Join Voice again.');
  }
  voice.stream = stream;
  voice.joined = true;
  voice.muted = false;
  ensureAudioCtx();
  if (mySeatId()) addAnalyser(mySeatId(), stream);
  send({ type: 'voice_join' });
  startMeter();
  voiceNote('');
  renderVoice(snap);
}

function leaveVoice(notify = true) {
  if (!voice.joined) return;
  voice.joined = false;
  voice.rejoinPending = false;
  [...voice.peers.keys()].forEach(closePeer);
  if (voice.stream) { voice.stream.getTracks().forEach(t => t.stop()); voice.stream = null; }
  voice.levels.clear();
  if (voice.meterTimer) { clearInterval(voice.meterTimer); voice.meterTimer = null; }
  if (notify) send({ type: 'voice_leave' });
  renderVoice(snap);
}

function toggleMute() {
  if (!voice.joined || !voice.stream) return;
  voice.muted = !voice.muted;
  voice.stream.getAudioTracks().forEach(t => { t.enabled = !voice.muted; });
  renderVoice(snap);
}

function onVoiceRoster(msg) {
  if (!voice.joined) return;
  for (const seatId of msg.peers || []) peerFor(seatId, true);
}

async function onVoiceSignal(msg) {
  if (!voice.joined || !msg.data) return;
  const from = msg.fromSeatId;
  const data = msg.data;
  try {
    if (data.kind === 'offer') {
      const p = peerFor(from, false);
      await p.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await p.pc.createAnswer();
      await p.pc.setLocalDescription(answer);
      send({ type: 'voice_signal', toSeatId: from, data: { kind: 'answer', sdp: p.pc.localDescription } });
    } else if (data.kind === 'answer') {
      const p = voice.peers.get(from);
      if (p) await p.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.kind === 'ice') {
      const p = voice.peers.get(from);
      if (p && data.candidate) await p.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch { /* a failed negotiation just means that peer stays silent */ }
}

function peerFor(seatId, initiator) {
  const existing = voice.peers.get(seatId);
  if (existing) return existing;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const p = { pc, audio: null };
  voice.peers.set(seatId, p);
  if (voice.stream) voice.stream.getTracks().forEach(t => pc.addTrack(t, voice.stream));
  pc.onicecandidate = (ev) => {
    if (ev.candidate) send({ type: 'voice_signal', toSeatId: seatId, data: { kind: 'ice', candidate: ev.candidate } });
  };
  pc.ontrack = (ev) => {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.srcObject = ev.streams[0];
    $('voice-audios').appendChild(audio);
    p.audio = audio;
    addAnalyser(seatId, ev.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(seatId);
  };
  if (initiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: 'voice_signal', toSeatId: seatId, data: { kind: 'offer', sdp: pc.localDescription } });
      } catch { /* peer will stay silent; game is unaffected */ }
    };
  }
  return p;
}

function closePeer(seatId) {
  const p = voice.peers.get(seatId);
  if (!p) return;
  voice.peers.delete(seatId);
  voice.levels.delete(seatId);
  try { p.pc.close(); } catch { /* already closed */ }
  if (p.audio) p.audio.remove();
}

function ensureAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!voice.ctx) voice.ctx = new AC();
  if (voice.ctx.state === 'suspended') voice.ctx.resume();
}

function addAnalyser(seatId, stream) {
  if (!voice.ctx) return;
  try {
    const src = voice.ctx.createMediaStreamSource(stream);
    const analyser = voice.ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    voice.levels.set(seatId, { analyser, data: new Uint8Array(analyser.frequencyBinCount) });
  } catch { /* speaking indicator is best-effort */ }
}

function startMeter() {
  if (voice.meterTimer) return;
  voice.meterTimer = setInterval(() => {
    voice.levels.forEach((L, seatId) => {
      L.analyser.getByteFrequencyData(L.data);
      let sum = 0;
      for (let i = 0; i < L.data.length; i++) sum += L.data[i];
      const speaking = sum / L.data.length > 12 && !(seatId === mySeatId() && voice.muted);
      document.querySelectorAll('[data-voice-mark="' + seatId + '"]').forEach(el => el.classList.toggle('speaking', speaking));
    });
  }, 180);
}

function renderVoice(msg) {
  // Voice only makes sense with another human in the room — bot games hide it.
  const hasHumanPeer = !!(msg && msg.seats.some(s => !s.isYou && !s.isBot));
  document.querySelectorAll('.voice-panel').forEach(panel => {
    panel.classList.toggle('hidden', !hasHumanPeer);
    if (!hasHumanPeer) return;
    panel.querySelector('.voice-join').classList.toggle('hidden', voice.joined);
    panel.querySelector('.voice-mute').classList.toggle('hidden', !voice.joined);
    panel.querySelector('.voice-leave').classList.toggle('hidden', !voice.joined);
    panel.querySelector('.voice-mute').textContent = voice.muted ? '🔊 Unmute' : '🔇 Mute';
    const inVoice = msg.seats.filter(s => s.inVoice);
    panel.querySelector('.voice-status').textContent = voice.joined
      ? '— you are in voice'
      : inVoice.length ? '— ' + inVoice.length + ' in voice' : '';
    panel.querySelector('.voice-members').innerHTML = inVoice.length
      ? inVoice.map(s => `<span class="voice-member" data-voice-mark="${s.id}">🎤 ${esc(s.name)}${s.isYou ? ' (you)' : ''}</span>`).join('')
      : '<span class="muted">Nobody is in voice yet.</span>';
  });
  // Drop peer connections for seats that left the room entirely.
  if (voice.joined && msg) {
    const present = new Set(msg.seats.map(s => s.id));
    [...voice.peers.keys()].forEach(seatId => { if (!present.has(seatId)) closePeer(seatId); });
  }
}

document.querySelectorAll('.voice-join').forEach(b => { b.onclick = joinVoice; });
document.querySelectorAll('.voice-mute').forEach(b => { b.onclick = toggleMute; });
document.querySelectorAll('.voice-leave').forEach(b => { b.onclick = () => leaveVoice(true); });

// boot: try to restore an in-progress room
connect(tryRestore);
