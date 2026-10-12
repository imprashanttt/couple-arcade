const socket = io();
const $ = (id) => document.getElementById(id);

let currentCode = null;
let myIndex = null;
let currentGame = null;
let myName = '';
let partnerName = 'Your partner';
let partnerPlaying = null;
let mySoloId = null;
let playerNames = [];
let chTimer = null;

const screens = {
  home: $('screen-home'), create: $('screen-create'), join: $('screen-join'),
  waiting: $('screen-waiting'), game: $('screen-game'),
};
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}
function gameTitle(g) {
  return { tictactoe: 'Tic-Tac-Toe', connect4: 'Connect Four', rps: 'Rock Paper Scissors' }[g] || g;
}

// --- Navigation ---
$('btn-create').onclick = () => showScreen('create');
$('btn-join').onclick = () => showScreen('join');
document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.onclick = () => { $('join-error').classList.add('hidden'); showScreen(btn.dataset.back); };
});
// leaving a room = reload, which also disconnects the socket cleanly
document.querySelectorAll('[data-reload]').forEach((btn) => { btn.onclick = () => location.reload(); });
$('btn-leave').onclick = () => location.reload();

// --- Create / Join ---
$('submit-create').onclick = () => {
  myName = $('create-name').value.trim() || 'Player 1';
  socket.emit('create_room', { name: myName });
};
$('submit-join').onclick = () => {
  myName = $('join-name').value.trim() || 'Player 2';
  $('join-error').classList.add('hidden');
  socket.emit('join_room', { name: myName, code: $('join-code').value.trim() });
};
$('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
$('copy-code').onclick = () => {
  if (!currentCode) return;
  navigator.clipboard.writeText(currentCode).catch(() => {});
  const btn = $('copy-code'); const old = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = old; }, 1200);
};

// --- Socket events ---
socket.on('room_created', ({ code }) => {
  currentCode = code;
  $('code-display').textContent = code;
  showScreen('waiting');
});
socket.on('your_index', ({ index }) => { myIndex = index; });
socket.on('join_error', ({ message }) => {
  const el = $('join-error');
  el.textContent = message;
  el.classList.remove('hidden');
});
socket.on('room_ready', ({ code, game, state, players }) => {
  playerNames = players || [];
  currentCode = code;
  $('room-pill').textContent = 'Room ' + code;
  $('chat-log').innerHTML = '';
  showScreen('game');
  applyGame(game, state);
});
socket.on('game_set', ({ game, state }) => applyGame(game, state));
socket.on('state_update', (state) => renderState(state));
socket.on('partner_playing', ({ name, playing }) => {
  partnerName = name || partnerName;
  partnerPlaying = playing && gameById(playing.id) ? playing : null;
  renderPresence();
});
socket.on('partner_left', () => {
  partnerPlaying = null;
  renderPresence();
  addSystem('Your partner left. Share the code again to let them back in.');
});

// --- Tabs ---
function setTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('pane-couple').classList.toggle('hidden', name !== 'couple');
  $('pane-solo').classList.toggle('hidden', name !== 'solo');
}
document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => setTab(t.dataset.tab); });

// --- Couple games ---
document.querySelectorAll('#couple-pick .game-tile').forEach((tile) => {
  tile.onclick = () => socket.emit('set_game', { code: currentCode, game: tile.dataset.game });
});
$('btn-change-game').onclick = () => socket.emit('set_game', { code: currentCode, game: null });
$('btn-other-game').onclick = () => socket.emit('set_game', { code: currentCode, game: null });
$('btn-rematch').onclick = () => socket.emit('request_rematch', { code: currentCode });

function applyGame(game, state) {
  currentGame = game;
  $('couple-pick').classList.toggle('hidden', !!game);
  $('couple-play').classList.toggle('hidden', !game);
  if (game) {
    $('game-title').textContent = gameTitle(game);
    if (state) renderState(state);
  }
}
function renderState(state) {
  if (!state) return;
  if (currentGame === 'tictactoe') renderTTT(state);
  else if (currentGame === 'connect4') renderC4(state);
  else if (currentGame === 'rps') renderRPS(state);
}
function updateStatus(state) {
  const statusEl = $('game-status');
  const actions = $('game-actions');
  $('btn-rematch').classList.remove('hidden');
  let finished = false; let text = '';
  if (currentGame === 'tictactoe') {
    if (state.winner === 'draw') { text = "It's a draw."; finished = true; }
    else if (state.winner !== null) { text = state.winner === myIndex ? 'You won.' : 'They won.'; finished = true; }
    else text = state.turn === myIndex ? 'Your move.' : 'Waiting on them.';
  }
  if (currentGame === 'connect4') {
    if (state.winner === 'draw') { text = "Board's full. A draw."; finished = true; }
    else if (state.winner !== null) { text = state.winner === myIndex ? 'You connected four.' : 'They got there first.'; finished = true; }
    else text = state.turn === myIndex ? 'Drop a piece.' : 'Waiting on them.';
  }
  if (currentGame === 'rps') {
    if (state.matchWinner !== null) { text = state.matchWinner === myIndex ? 'You won the match.' : 'They won the match.'; finished = true; }
    else text = `Round ${state.round} of 5.`;
  }
  statusEl.textContent = text;
  actions.classList.toggle('hidden', !finished);
}

function renderTTT(state) {
  const wrap = document.getElementById('board-wrap');
  wrap.innerHTML = '';
  wrap.className = 'board-wrap board-ttt';
  state.board.forEach((cell, i) => {
    const btn = document.createElement('button');
    btn.className = 'ttt-cell';
    if (cell === 0) btn.textContent = '✕';
    if (cell === 1) btn.textContent = '○';
    if (state.line && state.line.includes(i)) btn.classList.add('win-cell');
    btn.disabled = cell !== null || !!state.winner || state.turn !== myIndex;
    btn.onclick = () => socket.emit('make_move', { code: currentCode, move: { cell: i } });
    wrap.appendChild(btn);
  });
  updateStatus(state);
}

function renderC4(state) {
  const wrap = document.getElementById('board-wrap');
  wrap.innerHTML = '';
  wrap.className = 'board-wrap board-c4';
  for (let c = 0; c < 7; c++) {
    const col = document.createElement('button');
    col.className = 'c4-col';
    col.disabled = (state.board[c] && state.board[c].length >= 6) || !!state.winner || state.turn !== myIndex;
    col.onclick = () => socket.emit('make_move', { code: currentCode, move: { col: c } });
    for (let r = 5; r >= 0; r--) {
      const player = state.board[c] ? state.board[c][r] : undefined;
      const dot = document.createElement('span');
      dot.className = 'c4-dot';
      if (player === 0) dot.classList.add('p0');
      if (player === 1) dot.classList.add('p1');
      if (state.winCells && state.winCells.some(([wc, wr]) => wc === c && wr === r)) dot.classList.add('win-dot');
      col.appendChild(dot);
    }
    wrap.appendChild(col);
  }
  updateStatus(state);
}

function renderRPS(state) {
  const wrap = document.getElementById('board-wrap');
  wrap.innerHTML = '';
  wrap.className = 'board-wrap board-rps';

  const choicesRow = document.createElement('div');
  choicesRow.className = 'rps-choices';
  const options = [['rock', '✊'], ['paper', '✋'], ['scissors', '✌️']];
  const picked = state.choices[myIndex];
  options.forEach(([key, icon]) => {
    const btn = document.createElement('button');
    btn.className = 'rps-choice';
    btn.textContent = icon;
    if (picked === key) btn.classList.add('chosen');
    btn.disabled = !!picked || state.matchWinner !== null;
    btn.onclick = () => socket.emit('make_move', { code: currentCode, move: { choice: key } });
    choicesRow.appendChild(btn);
  });
  wrap.appendChild(choicesRow);

  const score = document.createElement('div');
  score.className = 'rps-score';
  score.textContent = `${state.wins[0]} — ${state.wins[1]}`;
  wrap.appendChild(score);

  if (state.roundResult) {
    const res = document.createElement('div');
    res.className = 'rps-result';
    res.textContent = state.roundResult.result === 'draw'
      ? 'Tie round — go again'
      : (state.roundResult.result === myIndex ? 'You won that round' : 'They won that round');
    wrap.appendChild(res);
  }
  updateStatus(state);
}


// --- Solo arcade ---
const SECTION_NAMES = {
  Main: 'Popular', Kiz10: 'Kiz10', BestGames: 'Best', Yiv: 'Dress-up & care',
  Christmas: 'Christmas', Halloween: 'Halloween', Easter: 'Easter',
  EditorsPicks: "Editor's picks", Exclusive: 'Exclusive',
};
const GAMES = window.SOLO_GAMES || [];
let activeSection = 'All';
function gameById(id) { return GAMES.find((g) => g.id === id) || null; }

function renderChips() {
  const wrap = $('solo-chips');
  wrap.innerHTML = '';
  ['All', ...Object.keys(SECTION_NAMES)].forEach((key) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (key === activeSection ? ' active' : '');
    b.textContent = key === 'All' ? 'All' : SECTION_NAMES[key];
    b.onclick = () => { activeSection = key; renderChips(); renderGrid(); };
    wrap.appendChild(b);
  });
}
function renderGrid() {
  const q = $('solo-search').value.trim().toLowerCase();
  const grid = $('solo-grid');
  grid.innerHTML = '';
  const list = GAMES.filter((g) => (activeSection === 'All' || g.s === activeSection) && (!q || g.t.toLowerCase().includes(q)));
  if (!list.length) { grid.innerHTML = '<p class="solo-empty">No games match that.</p>'; return; }
  list.forEach((g) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'solo-tile';
    const n = document.createElement('span'); n.className = 'solo-tile-name'; n.textContent = g.t;
    const s = document.createElement('span'); s.className = 'solo-tile-note'; s.textContent = SECTION_NAMES[g.s] || g.s;
    b.append(n, s);
    b.onclick = () => openSolo(g.id);
    grid.appendChild(b);
  });
}
$('solo-search').addEventListener('input', renderGrid);

function openSolo(id) {
  const g = gameById(id);
  if (!g) return;
  mySoloId = id;
  setTab('solo');
  $('solo-title').textContent = g.t;
  $('solo-frame').src = 'https://html5.gamemonetize.co/' + g.id + '/';
  $('solo-browse').classList.add('hidden');
  $('solo-play').classList.remove('hidden');
  socket.emit('now_playing', { code: currentCode, gameId: g.id, title: g.t });
  renderPresence();
}
function closeSolo() {
  mySoloId = null;
  $('solo-frame').src = 'about:blank';
  $('solo-play').classList.add('hidden');
  $('solo-browse').classList.remove('hidden');
  socket.emit('now_playing', { code: currentCode, gameId: null });
  renderPresence();
}
$('solo-back').onclick = closeSolo;

function renderPresence() {
  const bar = $('presence');
  const btn = $('presence-join');
  if (!partnerPlaying) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('presence-text').textContent = partnerName + ' is playing ' + partnerPlaying.title;
  btn.classList.toggle('hidden', mySoloId === partnerPlaying.id);
  btn.onclick = () => openSolo(partnerPlaying.id);
}

// --- Chat (text, emoji, photo, video) ---
function scrollChat() { const log = $('chat-log'); log.scrollTop = log.scrollHeight; }
function addSystem(text) {
  const row = document.createElement('div');
  row.className = 'chat-row system';
  const t = document.createElement('span'); t.className = 'chat-text'; t.textContent = text;
  row.appendChild(t);
  $('chat-log').appendChild(row);
  scrollChat();
}
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat_message', { code: currentCode, text });
  input.value = '';
});
socket.on('chat_message', ({ name, text, system }) => {
  if (system) { addSystem(text); return; }
  const row = document.createElement('div');
  row.className = 'chat-row';
  const who = document.createElement('span'); who.className = 'chat-name'; who.textContent = name;
  const msg = document.createElement('span'); msg.className = 'chat-text'; msg.textContent = text;
  row.append(who, msg);
  $('chat-log').appendChild(row);
  scrollChat();
});

const MAX_MEDIA = 10 * 1024 * 1024;
$('attach-btn').onclick = () => $('attach-input').click();
$('attach-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    let blob = file;
    let mime = file.type;
    if (mime.startsWith('image/') && mime !== 'image/gif') {
      blob = await shrinkImage(file); // phone photos are big; this keeps them fast
      mime = 'image/jpeg';
    }
    if (!/^(image|video)\//.test(mime)) { addSystem('Only photos and videos can be sent.'); return; }
    if (blob.size > MAX_MEDIA) { addSystem('That file is too big. The limit is 10 MB.'); return; }
    socket.emit('chat_media', { code: currentCode, mime, data: await blob.arrayBuffer() });
  } catch (err) {
    addSystem('Could not send that file.');
  }
});
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
    img.src = url;
  });
}
socket.on('chat_media', ({ name, mime, data }) => {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const row = document.createElement('div');
  row.className = 'chat-row media';
  const who = document.createElement('span'); who.className = 'chat-name'; who.textContent = name;
  let el;
  if (mime.startsWith('video/')) { el = document.createElement('video'); el.controls = true; el.playsInline = true; el.preload = 'metadata'; }
  else { el = document.createElement('img'); el.alt = 'Photo from ' + name; el.onclick = () => window.open(url, '_blank'); }
  el.src = url;
  el.className = 'chat-media';
  row.append(who, el);
  $('chat-log').appendChild(row);
  el.addEventListener('load', scrollChat);
  el.addEventListener('loadedmetadata', scrollChat);
  scrollChat();
});

const emojiList = ['❤️', '😂', '😍', '🔥', '😢', '😮', '👍', '🎉', '😘', '😅', '🙄', '😴'];
emojiList.forEach((em) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = em;
  btn.onclick = () => { const i = $('chat-input'); i.value += em; i.focus(); };
  $('emoji-row').appendChild(btn);
});

renderChips();
renderGrid();

// --- Challenge mode ---
function fmt(ms) { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
function stopTimer() { if (chTimer) { clearInterval(chTimer); chTimer = null; } }
function hideChallenge() { stopTimer(); $('challenge-box').classList.add('hidden'); $('score-form').classList.add('hidden'); }

$('btn-challenge').onclick = () => {
  if (!mySoloId) return;
  const g = gameById(mySoloId);
  socket.emit('start_challenge', { code: currentCode, gameId: g.id, title: g.t, minutes: $('ch-min').value, lowerWins: $('ch-lower').checked });
};
$('challenge-cancel').onclick = () => socket.emit('cancel_challenge', { code: currentCode });
$('score-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('score-input').value;
  if (v === '') return;
  socket.emit('submit_score', { code: currentCode, score: Number(v) });
  $('score-form').classList.add('hidden');
  $('challenge-text').textContent = 'Score sent. Waiting for ' + partnerName + '…';
  $('score-input').value = '';
});

socket.on('challenge_started', ({ id, title, lowerWins, durationMs, countdownMs, by }) => {
  if (!gameById(id)) return;
  stopTimer();
  addSystem(by + ' started a challenge: ' + title + (lowerWins ? ' (lower score wins)' : ' (higher score wins)'));
  openSolo(id);
  const box = $('challenge-box'); box.classList.remove('hidden');
  $('score-form').classList.add('hidden');
  const t0 = Date.now();
  chTimer = setInterval(() => {
    const el = Date.now() - t0;
    if (el < countdownMs) {
      $('challenge-text').textContent = title + ' starts in ' + Math.ceil((countdownMs - el) / 1000) + '…';
    } else if (el < countdownMs + durationMs) {
      $('challenge-text').textContent = 'GO! Time left ' + fmt(countdownMs + durationMs - el) + '. Enter your score when you finish.';
      $('score-form').classList.remove('hidden');
    } else {
      $('challenge-text').textContent = "Time's up! Enter your final score.";
      $('score-form').classList.remove('hidden');
      stopTimer();
    }
  }, 250);
});
socket.on('challenge_progress', ({ submitted }) => {
  if (submitted[myIndex] === false && submitted[1 - myIndex]) addSystem(partnerName + ' has sent a score.');
});
socket.on('challenge_result', ({ title, scores, winner }) => {
  hideChallenge();
  const me = scores[myIndex], them = scores[1 - myIndex];
  const verdict = winner === 'tie' ? "It's a tie." : (winner === myIndex ? 'You win.' : partnerName + ' wins.');
  addSystem(title + ': you ' + me + ', ' + partnerName + ' ' + them + '. ' + verdict);
});
socket.on('challenge_cancelled', hideChallenge);
socket.on('scoreboard', ({ names, wins, rounds }) => {
  const box = $('scoreboard');
  if (!rounds.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = '';
  const head = document.createElement('div'); head.className = 'sb-head';
  head.textContent = names[0] + '  ' + wins[0] + ' : ' + wins[1] + '  ' + names[1];
  box.appendChild(head);
  rounds.slice(0, 5).forEach((r) => {
    const row = document.createElement('div'); row.className = 'sb-row';
    const w = r.winner === 'tie' ? 'tie' : names[r.winner] + ' won';
    row.textContent = r.title + ': ' + r.scores[0] + ' vs ' + r.scores[1] + ' (' + w + ')';
    box.appendChild(row);
  });
});
