import { ChessGame, PIECES } from './chess-engine.js';
import { pickMove } from './bots.js';
import { firebaseConfig } from './firebase-config.js';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, onAuthStateChanged, updateProfile }
  from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getDatabase, ref, set, onValue, get, update, remove, onDisconnect, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
let currentUser = null;

// ===== USERNAME → EMAIL trick =====
// Firebase Auth cần email, ta fake: username@chess.local
function nameToEmail(name) {
  // Chuẩn hóa: chỉ giữ chữ/số/_ và chuyển lowercase
  const clean = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return clean + '@chess.local';
}

// ===== AUTH =====
window.Auth = {
  async register() {
    const name = document.getElementById('reg-name').value.trim();
    const pass = document.getElementById('reg-pass').value;
    const pass2 = document.getElementById('reg-pass2').value;
    const msg = document.getElementById('reg-msg');
    msg.className = 'msg'; msg.textContent = '';

    // Validate
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) {
      msg.textContent = '❌ Tên 3-20 ký tự, chỉ chữ/số/_'; msg.className = 'msg error'; return;
    }
    if (pass.length < 6) {
      msg.textContent = '❌ Mật khẩu phải ≥ 6 ký tự'; msg.className = 'msg error'; return;
    }
    if (pass !== pass2) {
      msg.textContent = '❌ Mật khẩu nhập lại không khớp'; msg.className = 'msg error'; return;
    }

    try {
      // Check trùng tên trong DB
      const nameSnap = await get(ref(db, `usernames/${name.toLowerCase()}`));
      if (nameSnap.exists()) {
        msg.textContent = '❌ Tên này đã có người dùng'; msg.className = 'msg error'; return;
      }

      const email = nameToEmail(name);
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });

      // Lưu mapping username → uid
      await set(ref(db, `usernames/${name.toLowerCase()}`), cred.user.uid);
      await set(ref(db, `users/${cred.user.uid}`), {
        name, createdAt: serverTimestamp()
      });

      msg.textContent = '✅ Tạo tài khoản thành công!'; msg.className = 'msg success';
    } catch (e) {
      console.error(e);
      if (e.code === 'auth/email-already-in-use') {
        msg.textContent = '❌ Tên đã tồn tại, thử tên khác'; msg.className = 'msg error';
      } else if (e.code === 'auth/weak-password') {
        msg.textContent = '❌ Mật khẩu quá yếu'; msg.className = 'msg error';
      } else {
        msg.textContent = '❌ Lỗi: ' + e.message; msg.className = 'msg error';
      }
    }
  },

  async login() {
    const name = document.getElementById('login-name').value.trim();
    const pass = document.getElementById('login-pass').value;
    const msg = document.getElementById('login-msg');
    msg.className = 'msg'; msg.textContent = '';
    if (!name || !pass) {
      msg.textContent = '❌ Nhập đủ tên và mật khẩu'; msg.className = 'msg error'; return;
    }
    try {
      const email = nameToEmail(name);
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
      console.error(e);
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') {
        msg.textContent = '❌ Sai tên hoặc mật khẩu'; msg.className = 'msg error';
      } else {
        msg.textContent = '❌ ' + e.message; msg.className = 'msg error';
      }
    }
  },

  async logout() { await signOut(auth); }
};

// Tab switch
document.querySelectorAll('.auth-tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.auth-tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(`form-${t.dataset.tab}`).classList.add('active');
  };
});

onAuthStateChanged(auth, user => {
  currentUser = user;
  if (user) {
    document.getElementById('user-display').textContent = '👤 ' + (user.displayName || 'Player');
    switchScreen('lobby');
  } else {
    switchScreen('auth');
  }
});

function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`${name}-screen`).classList.add('active');
  if (name === 'lobby') Theme.apply();
}

// ===== THEME =====
const saved = JSON.parse(localStorage.getItem('chess-theme') || '{}');
window.Theme = {
  board: saved.board || 'classic',
  piece: saved.piece || 'unicode',
  setBoard(v) { this.board = v; this.save(); this.apply(); },
  setPiece(v) { this.piece = v; this.save(); this.apply(); },
  save() { localStorage.setItem('chess-theme', JSON.stringify({ board: this.board, piece: this.piece })); },
  apply() {
    const b = document.getElementById('chessboard');
    if (b) b.className = `chessboard theme-${this.board} pieces-${this.piece}`;
    document.querySelectorAll('.theme-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.board === this.board);
    });
    const sel = document.getElementById('piece-theme');
    if (sel) sel.value = this.piece;
  }
};

// Bind swatches
setTimeout(() => {
  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.onclick = () => Theme.setBoard(s.dataset.board);
  });
}, 100);

// ===== GAME =====
let game = null, flipped = false, selected = null, legalForSelected = [];
let mode = 'bot', botLevel = 'tai', myColor = 'w';
let roomCode = null, lastMove = null;

window.Game = {
  startBot(level) {
    mode = 'bot'; botLevel = level; myColor = 'w';
    game = new ChessGame();
    lastMove = null; selected = null; legalForSelected = []; flipped = false;
    const titles = { tai: '🐉 Tài Cực Mạnh', hikaru: '⚡ Hikaru Nakamura', magnus: '👑 Magnus Carlsen' };
    document.getElementById('game-title').textContent = `Bạn (Trắng) vs ${titles[level]}`;
    switchScreen('game'); this.render();
  },
  startOnline(code, color) {
    mode = 'online'; roomCode = code; myColor = color;
    document.getElementById('game-title').textContent = `Phòng ${code} · Bạn là ${color === 'w' ? 'Trắng' : 'Đen'}`;
    switchScreen('game'); this.render();
  },
  backToLobby() {
    if (roomCode) { remove(ref(db, `rooms/${roomCode}`)).catch(() => {}); roomCode = null; }
    switchScreen('lobby');
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
      const p = game.get(r, c);
      if (p) { cell.textContent = PIECES[p]; cell.classList.add(p[0]); }
      if (lastMove && ((lastMove.from[0] === r && lastMove.from[1] === c) ||
                       (lastMove.to[0] === r && lastMove.to[1] === c)))
        cell.classList.add('last-move');
      if (selected && selected[0] === r && selected[1] === c) cell.classList.add('selected');
      const hint = legalForSelected.find(m => m.to[0] === r && m.to[1] === c);
      if (hint) cell.classList.add(hint.capture ? 'capture' : 'hint');
      cell.onclick = () => this.click(r, c);
      board.appendChild(cell);
    }
    this.updateStatus(); this.updateMoveList();
  },
  click(r, c) {
    if (!game) return;
    if (mode === 'bot' && game.turn !== myColor) return;
    if (mode === 'online' && game.turn !== myColor) return;

    const mv = legalForSelected.find(m => m.to[0] === r && m.to[1] === c);
    if (mv) return this.playMove(mv);

    const p = game.get(r, c);
    if (p && game.pieceColor && game.pieceColor(p) === game.turn) {
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
      setTimeout(() => {
        const botMove = pickMove(game, botLevel);
        if (botMove) {
          game.makeMove(botMove); lastMove = botMove;
          this.render();
          const o = game.gameOver(); if (o) this.showResult(o);
        }
      }, 250);
    } else if (mode === 'online') {
      game.makeMove(mv);
      selected = null; legalForSelected = [];
      this.render();
      update(ref(db, `rooms/${roomCode}/game`), { fen: game.toFEN(), lastMove: mv, ts: Date.now() });
    }
  },
  showResult(over) {
    const el = document.getElementById('status-text');
    if (over.type === 'checkmate')
      el.textContent = `♛ Chiếu hết! ${over.winner === 'w' ? 'Trắng' : 'Đen'} thắng`;
    else if (over.type === 'stalemate')
      el.textContent = '🤝 Hòa (hết nước đi)';
  },
  updateStatus() {
    const el = document.getElementById('status-text');
    if (!game) return;
    const over = game.gameOver();
    if (over) return this.showResult(over);
    if (mode === 'bot')
      el.textContent = game.turn === 'w' ? '🎯 Lượt của bạn' : '🤖 Bot đang suy nghĩ...';
    else
      el.textContent = game.turn === myColor ? '🎯 Lượt của bạn' : '⏳ Chờ đối thủ...';
  },
  updateMoveList() {
    const list = document.getElementById('move-list');
    if (!game) return;
    list.innerHTML = '';
    game.history.forEach((m, i) => {
      const div = document.createElement('div');
      div.textContent = `${i + 1}. ${ChessGame.sq(m.from[0], m.from[1])}${ChessGame.sq(m.to[0], m.to[1])}${m.capture ? 'x' : ''}`;
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
    this.listenRoom(code);
    document.getElementById('game-title').textContent = `Phòng ${code} · Chờ đối thủ...`;
    alert(`Mã phòng: ${code}\nGửi mã này cho bạn bè để họ vào!`);
  },
  async joinRoom() {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    const msg = document.getElementById('room-msg');
    msg.className = 'msg'; msg.textContent = '';
    if (!code) { msg.textContent = '❌ Nhập mã phòng'; msg.className = 'msg error'; return; }
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) { msg.textContent = '❌ Phòng không tồn tại'; msg.className = 'msg error'; return; }
    const data = snap.val();
    if (data.host === currentUser.uid) { msg.textContent = '⚠️ Bạn là chủ phòng này'; msg.className = 'msg error'; return; }
    if (data.guest && data.guest !== currentUser.uid) { msg.textContent = '❌ Phòng đã đầy'; msg.className = 'msg error'; return; }
    await update(ref(db, `rooms/${code}`), { guest: currentUser.uid, guestName: currentUser.displayName || 'Guest' });
    roomCode = code;
    Game.startOnline(code, 'b');
    this.listenRoom(code);
  },
  listenRoom(code) {
    const roomRef = ref(db, `rooms/${code}`);
    onValue(roomRef, snap => {
      if (!snap.exists() || !game) return;
      const data = snap.val();
      if (data.game && data.game.fen !== game.toFEN()) {
        game.load(data.game.fen);
        if (data.game.lastMove) lastMove = data.game.lastMove;
        Game.render();
      }
      if (data.guest && document.getElementById('game-title').textContent.includes('Chờ')) {
        document.getElementById('game-title').textContent = `Phòng ${code} · Đang chơi`;
      }
    });
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
