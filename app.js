import { ChessGame, PIECES } from './chess-engine.js';
import { pickMove } from './bots.js';
import { firebaseConfig } from './firebase-config.js';

// ===== AUTH (Firebase) =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, onAuthStateChanged, updateProfile } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getDatabase, ref, set, onValue, get, update, remove, onDisconnect }
  from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
let currentUser = null;

window.Auth = {
  async register() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value;
    const err = document.getElementById('reg-err');
    err.textContent = '';
    if (!name || !email || pass.length < 6) { err.textContent = 'Điền đầy đủ, mật khẩu ≥6 ký tự'; return; }
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
    } catch (e) { err.textContent = e.message; }
  },
  async login() {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    const err = document.getElementById('login-err');
    err.textContent = '';
    try { await signInWithEmailAndPassword(auth, email, pass); }
    catch (e) { err.textContent = 'Sai email/mật khẩu'; }
  },
  async logout() { await signOut(auth); }
};

onAuthStateChanged(auth, user => {
  currentUser = user;
  if (user) {
    document.getElementById('user-name').textContent = user.displayName || user.email;
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('lobby-screen').classList.add('active');
  } else {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('auth-screen').classList.add('active');
  }
});

// ===== THEME =====
const savedTheme = JSON.parse(localStorage.getItem('chess-theme') || '{}');
window.Theme = {
  board: savedTheme.board || 'classic',
  piece: savedTheme.piece || 'unicode',
  setBoard(v) { this.board = v; this.save(); this.apply(); },
  setPiece(v) { this.piece = v; this.save(); this.apply(); },
  save() { localStorage.setItem('chess-theme', JSON.stringify({ board: this.board, piece: this.piece })); },
  apply() {
    const b = document.getElementById('chessboard');
    if (!b) return;
    b.className = `chessboard theme-${this.board} pieces-${this.piece}`;
    document.getElementById('board-theme').value = this.board;
    document.getElementById('piece-theme').value = this.piece;
  }
};

// ===== GAME =====
let game = null;
let flipped = false;
let selected = null;
let legalForSelected = [];
let mode = 'bot';
let botLevel = 'tai';
let myColor = 'w';
let roomCode = null;
let lastMove = null;
let listeners = [];

window.Game = {
  startBot(level) {
    mode = 'bot'; botLevel = level; myColor = 'w';
    game = new ChessGame();
    lastMove = null; selected = null; flipped = false;
    const titles = { tai: '🐉 Tài Cực Mạnh', hikaru: '⚡ Hikaru Nakamura', magnus: '👑 Magnus Carlsen' };
    document.getElementById('game-title').textContent = `Bạn (Trắng) vs ${titles[level]}`;
    this.switchScreen('game');
    this.render();
  },
  startOnline(code, color) {
    mode = 'online'; roomCode = code; myColor = color;
    document.getElementById('game-title').textContent = `Phòng ${code} - Bạn là ${color === 'w' ? 'Trắng' : 'Đen'}`;
    this.switchScreen('game');
    this.render();
  },
  switchScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`${name}-screen`).classList.add('active');
    Theme.apply();
  },
  backToLobby() {
    if (roomCode) { remove(ref(db, `rooms/${roomCode}`)).catch(() => {}); roomCode = null; }
    this.switchScreen('lobby');
  },
  reset() {
    if (mode === 'bot') return this.startBot(botLevel);
    if (roomCode) return Online.resetRoom();
  },
  flip() { flipped = !flipped; this.render(); },
  undo() {
    if (mode === 'bot' && game.history.length >= 2) {
      game.undo(); game.undo();
      lastMove = game.history[game.history.length - 1] || null;
      this.render();
    }
  },
  render() {
    const board = document.getElementById('chessboard');
    board.innerHTML = '';
    board.className = `chessboard theme-${Theme.board} pieces-${Theme.piece}`;
    const rows = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    const cols = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

    for (const r of rows) for (const c of cols) {
      const cell = document.createElement('div');
      cell.className = `cell ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
      cell.dataset.r = r; cell.dataset.c = c;
      const p = game.get(r, c);
      if (p) {
        cell.textContent = PIECES[p];
        cell.classList.add(p[0]);
      }
      if (lastMove && ((lastMove.from[0] === r && lastMove.from[1] === c) ||
                       (lastMove.to[0] === r && lastMove.to[1] === c))) {
        cell.classList.add('last-move');
      }
      if (selected && selected[0] === r && selected[1] === c) cell.classList.add('selected');
      const hint = legalForSelected.find(m => m.to[0] === r && m.to[1] === c);
      if (hint) cell.classList.add(hint.capture ? 'capture' : 'hint');
      cell.onclick = () => this.click(r, c);
      board.appendChild(cell);
    }
    this.updateStatus();
    this.updateMoveList();
  },
  click(r, c) {
    if (!game) return;
    if (mode === 'bot' && game.turn !== myColor) return;
    if (mode === 'online' && game.turn !== myColor) return;

    // Try move
    const mv = legalForSelected.find(m => m.to[0] === r && m.to[1] === c);
    if (mv) {
      this.playMove(mv);
      return;
    }
    // Select
    const p = game.get(r, c);
    if (p && game.pieceColor(p) === game.turn) {
      selected = [r, c];
      legalForSelected = game.legalMoves(r, c);
    } else {
      selected = null; legalForSelected = [];
    }
    this.render();
  },
  playMove(mv) {
    lastMove = mv;
    if (mode === 'bot') {
      game.makeMove(mv);
      selected = null; legalForSelected = [];
      this.render();
      const over = game.gameOver();
      if (over) return this.showResult(over);
      // Bot thinking
      setTimeout(() => {
        const botMove = pickMove(game, botLevel);
        if (botMove) {
          game.makeMove(botMove);
          lastMove = botMove;
          this.render();
          const over = game.gameOver();
          if (over) this.showResult(over);
        }
      }, 300);
    } else if (mode === 'online') {
      // optimistic local apply + write to Firebase
      game.makeMove(mv);
      selected = null; legalForSelected = [];
      this.render();
      update(ref(db, `rooms/${roomCode}/game`), { fen: game.toFEN(), lastMove: mv, ts: Date.now() })
        .then(() => {
          const over = game.gameOver();
          if (over) this.showResult(over);
        });
    }
  },
  showResult(over) {
    const el = document.getElementById('status-text');
    if (over.type === 'checkmate') {
      el.textContent = `♛ Chiếu hết! ${over.winner === 'w' ? 'Trắng' : 'Đen'} thắng`;
    } else if (over.type === 'stalemate') {
      el.textContent = '🤝 Hòa (hết nước đi)';
    }
  },
  updateStatus() {
    const el = document.getElementById('status-text');
    if (!game) { el.textContent = ''; return; }
    const over = game.gameOver();
    if (over) return this.showResult(over);
    if (mode === 'bot') {
      el.textContent = game.turn === 'w' ? '🎯 Lượt của bạn' : '🤖 Bot đang suy nghĩ...';
    } else {
      el.textContent = game.turn === myColor ? '🎯 Lượt của bạn' : '⏳ Chờ đối thủ...';
    }
  },
  updateMoveList() {
    const list = document.getElementById('move-list');
    if (!game) return;
    list.innerHTML = '';
    game.history.forEach((m, i) => {
      const div = document.createElement('div');
      const from = ChessGame.sq(m.from[0], m.from[1]);
      const to = ChessGame.sq(m.to[0], m.to[1]);
      div.textContent = `${i + 1}. ${from}${to}${m.capture ? 'x' : ''}`;
      list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
  }
};

// ===== ONLINE =====
window.Online = {
  async createRoom() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const initial = new ChessGame().toFEN();
    await set(ref(db, `rooms/${code}`), {
      host: currentUser.uid,
      hostName: currentUser.displayName || 'Host',
      guest: null,
      game: { fen: initial, lastMove: null, ts: Date.now() },
      createdAt: Date.now()
    });
    roomCode = code;
    Game.startOnline(code, 'w');
    // Notify on disconnect
    onDisconnect(ref(db, `rooms/${code}/host`)).remove().catch(() => {});
    this.listenRoom(code);
    document.getElementById('game-title').textContent = `Phòng ${code} - Chờ đối thủ...`;
    alert(`Mã phòng: ${code}\nChia sẻ mã này với bạn để vào!`);
  },
  async joinRoom() {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!code) return;
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) { document.getElementById('room-status').textContent = '❌ Phòng không tồn tại'; return; }
    const data = snap.val();
    if (data.host === currentUser.uid) { document.getElementById('room-status').textContent = '⚠️ Bạn là chủ phòng'; return; }
    if (data.guest && data.guest !== currentUser.uid) { document.getElementById('room-status').textContent = '❌ Phòng đã đầy'; return; }
    await update(ref(db, `rooms/${code}`), { guest: currentUser.uid, guestName: currentUser.displayName || 'Guest' });
    roomCode = code;
    Game.startOnline(code, 'b');
    this.listenRoom(code);
  },
  listenRoom(code) {
    listeners.forEach(u => u());
    listeners = [];
    const roomRef = ref(db, `rooms/${code}`);
    const unsub = onValue(roomRef, snap => {
      if (!snap.exists()) return;
      const data = snap.val();
      if (data.guest && data.host && game) {
        // Sync FEN
        if (data.game.fen !== game.toFEN()) {
          game.load(data.game.fen);
          if (data.game.lastMove) lastMove = data.game.lastMove;
          Game.render();
        }
      }
      if (data.guest && document.getElementById('game-title').textContent.includes('Chờ')) {
        document.getElementById('game-title').textContent = `Phòng ${code} - Đang chơi`;
      }
    });
    listeners.push(() => {});
    // store unsubscribe
    onDisconnect(ref(db, `rooms/${code}/guest`)).remove().catch(() => {});
  },
  async resetRoom() {
    const initial = new ChessGame().toFEN();
    await update(ref(db, `rooms/${roomCode}/game`), { fen: initial, lastMove: null });
    game = new ChessGame();
    lastMove = null; selected = null; legalForSelected = [];
    Game.render();
  }
};

// Tab switching
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById(`${t.dataset.tab}-form`).classList.add('active');
});

// Init theme
Theme.apply();
