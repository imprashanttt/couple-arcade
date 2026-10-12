const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 12e6 }); // allows ~10 MB photo/video relay
const COUPLE_GAMES = ['tictactoe', 'connect4', 'rps'];
const MEDIA_TYPES = ['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm','video/quicktime'];
const MAX_MEDIA = 10 * 1024 * 1024;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {}; // code -> { game, players: [{id,name}], state }

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function freshState(game) {
  if (game === 'tictactoe') return { board: Array(9).fill(null), turn: 0, winner: null, line: null };
  if (game === 'connect4') return { board: Array.from({ length: 7 }, () => []), turn: 0, winner: null, winCells: null };
  if (game === 'rps') return { choices: [null, null], wins: [0, 0], round: 1, roundResult: null, matchWinner: null };
  return {};
}

function checkTTT(board) {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const line of lines) {
    const [a, b, c] = line;
    if (board[a] !== null && board[a] === board[b] && board[b] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every((c) => c !== null)) return { winner: 'draw', line: null };
  return null;
}

function dropC4(board, col, player) {
  if (!board[col] || board[col].length >= 6) return null;
  const row = board[col].length;
  board[col].push(player);
  return row;
}

function checkC4(board) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let c = 0; c < 7; c++) {
    for (let r = 0; r < board[c].length; r++) {
      const p = board[c][r];
      if (p === null || p === undefined) continue;
      for (const [dc, dr] of dirs) {
        const cells = [[c, r]];
        for (let k = 1; k < 4; k++) {
          const nc = c + dc * k;
          const nr = r + dr * k;
          if (nc < 0 || nc > 6 || nr < 0 || nr >= 6) break;
          if (board[nc] && board[nc][nr] === p) cells.push([nc, nr]);
          else break;
        }
        if (cells.length === 4) return { winner: p, cells };
      }
    }
  }
  const full = board.every((col) => col.length === 6);
  if (full) return { winner: 'draw', cells: null };
  return null;
}

function broadcastIndexes(room) {
  room.players.forEach((p, i) => io.to(p.id).emit('your_index', { index: i }));
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ name }) => {
    const code = makeCode();
    rooms[code] = {
      game: null,
      scoreboard: { wins: [0, 0], rounds: [] },
      challenge: null,
      players: [{ id: socket.id, name: String(name || 'Player 1').slice(0, 20), playing: null }],
      state: null,
    };
    socket.join(code);
    socket.data.code = code;
    socket.emit('room_created', { code });
    socket.emit('your_index', { index: 0 });
  });

  socket.on('join_room', ({ name, code }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      socket.emit('join_error', { message: 'Room not found. Double check the code.' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('join_error', { message: 'That room already has two players.' });
      return;
    }
    room.players.push({ id: socket.id, name: String(name || 'Player 2').slice(0, 20), playing: null });
    room.scoreboard = { wins: [0, 0], rounds: [] };
    room.challenge = null;
    if (room.game) room.state = freshState(room.game); // fresh board so turn order matches new seats
    socket.join(code);
    socket.data.code = code;
    broadcastIndexes(room);
    io.to(code).emit('room_ready', {
      code,
      game: room.game,
      players: room.players.map((p) => p.name),
      state: room.state,
    });
    io.to(code).emit('scoreboard', { names: room.players.map((p) => p.name), ...room.scoreboard });
    room.players.forEach((p, i) => io.to(p.id).emit('partner_playing', { name: room.players[1 - i].name, playing: room.players[1 - i].playing }));
    io.to(code).emit('chat_message', {
      name: 'Room',
      text: `${room.players[1].name} joined the room.`,
      time: Date.now(),
      system: true,
    });
  });

  socket.on('make_move', ({ code, move }) => {
    const room = rooms[code];
    if (!room || room.players.length < 2) return;
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx === -1) return;
    if (!room.game || !room.state) return;
    const state = room.state;

    if (room.game === 'tictactoe') {
      if (state.winner || state.turn !== idx) return;
      const cell = move.cell;
      if (typeof cell !== 'number' || cell < 0 || cell > 8 || state.board[cell] !== null) return;
      state.board[cell] = idx;
      const result = checkTTT(state.board);
      if (result) {
        state.winner = result.winner;
        state.line = result.line;
      } else {
        state.turn = 1 - state.turn;
      }
    }

    if (room.game === 'connect4') {
      if (state.winner || state.turn !== idx) return;
      const col = move.col;
      if (typeof col !== 'number' || col < 0 || col > 6) return;
      const row = dropC4(state.board, col, idx);
      if (row === null) return;
      const result = checkC4(state.board);
      if (result) {
        state.winner = result.winner;
        state.winCells = result.cells;
      } else {
        state.turn = 1 - state.turn;
      }
    }

    if (room.game === 'rps') {
      if (state.matchWinner !== null) return;
      if (state.choices[idx]) return;
      if (!['rock', 'paper', 'scissors'].includes(move.choice)) return;
      state.choices[idx] = move.choice;
      if (state.choices[0] && state.choices[1]) {
        const [a, b] = state.choices;
        const beats = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
        let result = 'draw';
        if (a !== b) result = beats[a] === b ? 0 : 1;
        if (result === 0 || result === 1) state.wins[result]++;
        state.roundResult = { a, b, result };
        if (state.wins[0] >= 3) state.matchWinner = 0;
        else if (state.wins[1] >= 3) state.matchWinner = 1;
        io.to(code).emit('state_update', state);
        if (state.matchWinner === null) {
          setTimeout(() => {
            const r = rooms[code];
            if (!r || r.state.matchWinner !== null) return;
            r.state.choices = [null, null];
            r.state.round++;
            r.state.roundResult = null;
            io.to(code).emit('state_update', r.state);
          }, 1700);
        }
        return;
      }
    }

    io.to(code).emit('state_update', state);
  });

  socket.on('request_rematch', ({ code }) => {
    const room = rooms[code];
    if (!room || !room.game) return;
    room.state = freshState(room.game);
    io.to(code).emit('state_update', room.state);
  });

  // pick (or clear) the couple game for the whole room
  socket.on('set_game', ({ code, game }) => {
    const room = rooms[code];
    if (!room || !room.players.some((p) => p.id === socket.id)) return;
    if (game !== null && !COUPLE_GAMES.includes(game)) return;
    room.game = game;
    room.state = game ? freshState(game) : null;
    io.to(code).emit('game_set', { game, state: room.state });
    if (game) {
      const me = room.players.find((p) => p.id === socket.id);
      io.to(code).emit('chat_message', { name: 'Room', text: `${me.name} started a couple game.`, time: Date.now(), system: true });
    }
  });

  // tell the partner which solo game I'm playing (or null)
  socket.on('now_playing', ({ code, gameId, title }) => {
    const room = rooms[code];
    const me = room && room.players.find((p) => p.id === socket.id);
    if (!me) return;
    if (gameId && !/^[a-z0-9]{32}$/.test(String(gameId))) return;
    me.playing = gameId ? { id: String(gameId), title: String(title || '').slice(0, 60) } : null;
    socket.to(code).emit('partner_playing', { name: me.name, playing: me.playing });
  });

  // ---- Challenge mode: same solo game, compare scores ----
  socket.on('start_challenge', ({ code, gameId, title, minutes, lowerWins }) => {
    const room = rooms[code];
    if (!room || room.players.length < 2 || !room.players.some((p) => p.id === socket.id)) return;
    if (!/^[a-z0-9]{32}$/.test(String(gameId))) return;
    const mins = Math.min(30, Math.max(1, parseInt(minutes, 10) || 3));
    room.challenge = { id: String(gameId), title: String(title || '').slice(0, 60), lowerWins: !!lowerWins, scores: [null, null], durationMs: mins * 60000 };
    const me = room.players.find((p) => p.id === socket.id);
    io.to(code).emit('challenge_started', { id: room.challenge.id, title: room.challenge.title, lowerWins: room.challenge.lowerWins, durationMs: room.challenge.durationMs, countdownMs: 4000, by: me.name });
  });

  socket.on('submit_score', ({ code, score }) => {
    const room = rooms[code];
    const idx = room ? room.players.findIndex((p) => p.id === socket.id) : -1;
    const ch = room && room.challenge;
    const n = Number(score);
    if (idx === -1 || !ch || ch.scores[idx] !== null || !Number.isFinite(n) || Math.abs(n) > 1e12) return;
    ch.scores[idx] = n;
    io.to(code).emit('challenge_progress', { submitted: ch.scores.map((x) => x !== null) });
    if (ch.scores.every((x) => x !== null)) {
      const [a, b] = ch.scores;
      let winner = 'tie';
      if (a !== b) winner = (ch.lowerWins ? a < b : a > b) ? 0 : 1;
      if (winner !== 'tie') room.scoreboard.wins[winner]++;
      room.scoreboard.rounds.unshift({ title: ch.title, scores: [a, b], winner });
      room.scoreboard.rounds = room.scoreboard.rounds.slice(0, 15);
      room.challenge = null;
      io.to(code).emit('challenge_result', { title: ch.title, scores: [a, b], winner });
      io.to(code).emit('scoreboard', { names: room.players.map((p) => p.name), ...room.scoreboard });
    }
  });

  socket.on('cancel_challenge', ({ code }) => {
    const room = rooms[code];
    if (!room || !room.challenge || !room.players.some((p) => p.id === socket.id)) return;
    room.challenge = null;
    io.to(code).emit('challenge_cancelled');
  });

  // photo / video sharing: relayed only, never stored on the server
  socket.on('chat_media', ({ code, mime, data }) => {
    const room = rooms[code];
    const me = room && room.players.find((p) => p.id === socket.id);
    if (!me || !MEDIA_TYPES.includes(mime)) return;
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_MEDIA) return;
    io.to(code).emit('chat_media', { name: me.name, mime, data, time: Date.now() });
  });

  socket.on('chat_message', ({ code, text }) => {
    const room = rooms[code];
    if (!room || !text) return;
    const clean = String(text).slice(0, 300).trim();
    if (!clean) return;
    const player = room.players.find((p) => p.id === socket.id);
    io.to(code).emit('chat_message', {
      name: player ? player.name : 'Someone',
      text: clean,
      time: Date.now(),
      system: false,
    });
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    socket.to(code).emit('partner_left');
    room.players = room.players.filter((p) => p.id !== socket.id);
    if (room.players.length === 0) { delete rooms[code]; return; }
    if (room.game) room.state = freshState(room.game);
    room.challenge = null;
    broadcastIndexes(room);
    io.to(code).emit('challenge_cancelled');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Listening on port ' + PORT));
