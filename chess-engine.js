// Simplified chess engine — pure JS, no dependencies
export const PIECES = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};

export class ChessGame {
  constructor(fen) {
    this.load(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  load(fen) {
    const [pos, turn, castling, ep] = fen.split(' ');
    this.board = Array(8).fill().map(() => Array(8).fill(null));
    const rows = pos.split('/');
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) c += parseInt(ch);
        else {
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          this.board[r][c] = color + ch.toUpperCase();
          c++;
        }
      }
    }
    this.turn = turn;
    this.castling = castling;
    this.enPassant = ep;
    this.history = [];
    this.halfmove = 0;
    this.fullmove = 1;
  }

  static sq(r, c) { return String.fromCharCode(97 + c) + (8 - r); }
  static fromSq(s) { return [8 - parseInt(s[1]), s.charCodeAt(0) - 97]; }

  clone() {
    const g = new ChessGame(this.toFEN());
    g.history = [...this.history];
    return g;
  }

  toFEN() {
    let pos = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (!p) empty++;
        else {
          if (empty) { pos += empty; empty = 0; }
          pos += p[0] === 'w' ? p[1] : p[1].toLowerCase();
        }
      }
      if (empty) pos += empty;
      if (r < 7) pos += '/';
    }
    return `${pos} ${this.turn} ${this.castling} ${this.enPassant} ${this.halfmove} ${this.fullmove}`;
  }

  get(r, c) {
    if (r < 0 || r > 7 || c < 0 || c > 7) return null;
    return this.board[r][c];
  }

  pieceColor(p) { return p ? p[0] : null; }
  pieceType(p) { return p ? p[1] : null; }

  // Generate pseudo-legal moves for a square
  movesFrom(r, c) {
    const p = this.get(r, c);
    if (!p) return [];
    const color = this.pieceColor(p);
    const type = this.pieceType(p);
    const moves = [];
    const add = (tr, tc) => {
      if (tr < 0 || tr > 7 || tc < 0 || tc > 7) return false;
      const target = this.get(tr, tc);
      if (target && this.pieceColor(target) === color) return false;
      moves.push({ from: [r, c], to: [tr, tc], capture: !!target });
      return !target;
    };

    if (type === 'P') {
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      if (!this.get(r + dir, c)) {
        add(r + dir, c);
        if (r === startRow && !this.get(r + 2 * dir, c)) add(r + 2 * dir, c);
      }
      for (const dc of [-1, 1]) {
        const tr = r + dir, tc = c + dc;
        const target = this.get(tr, tc);
        if (target && this.pieceColor(target) !== color) add(tr, tc);
        // en passant
        if (this.enPassant !== '-' && ChessGame.sq(tr, tc) === this.enPassant) {
          moves.push({ from: [r, c], to: [tr, tc], capture: true, ep: true });
        }
      }
    } else if (type === 'N') {
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(r+dr, c+dc);
    } else if (type === 'B') {
      for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        let tr = r+dr, tc = c+dc;
        while (add(tr, tc)) { tr += dr; tc += dc; }
      }
    } else if (type === 'R') {
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        let tr = r+dr, tc = c+dc;
        while (add(tr, tc)) { tr += dr; tc += dc; }
      }
    } else if (type === 'Q') {
      for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]) {
        let tr = r+dr, tc = c+dc;
        while (add(tr, tc)) { tr += dr; tc += dc; }
      }
    } else if (type === 'K') {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        add(r + dr, c + dc);
      }
    }
    return moves;
  }

  isAttacked(r, c, byColor) {
    // Check knight attacks
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const p = this.get(r+dr, c+dc);
      if (p && p === byColor + 'N') return true;
    }
    // King
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const p = this.get(r+dr, c+dc);
      if (p && p === byColor + 'K') return true;
    }
    // Pawn
    const pawnDir = byColor === 'w' ? 1 : -1;
    for (const dc of [-1, 1]) {
      const p = this.get(r + pawnDir, c + dc);
      if (p && p === byColor + 'P') return true;
    }
    // Sliding
    for (const [dr, dc, types] of [[-1,-1,'BQ'],[1,1,'BQ'],[-1,1,'BQ'],[1,-1,'BQ'],[-1,0,'RQ'],[1,0,'RQ'],[0,-1,'RQ'],[0,1,'RQ']]) {
      let tr = r+dr, tc = c+dc;
      while (tr >= 0 && tr < 8 && tc >= 0 && tc < 8) {
        const p = this.get(tr, tc);
        if (p) {
          if (this.pieceColor(p) === byColor && types.includes(this.pieceType(p))) return true;
          break;
        }
        tr += dr; tc += dc;
      }
    }
    return false;
  }

  findKing(color) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (this.board[r][c] === color + 'K') return [r, c];
    }
    return null;
  }

  inCheck(color) {
    const k = this.findKing(color);
    if (!k) return false;
    return this.isAttacked(k[0], k[1], color === 'w' ? 'b' : 'w');
  }

  legalMoves(r, c) {
    const p = this.get(r, c);
    if (!p || this.pieceColor(p) !== this.turn) return [];
    const pseudo = this.movesFrom(r, c);
    const legal = [];
    for (const m of pseudo) {
      const g = this.applyMove(m);
      if (!g.inCheck(this.turn)) legal.push(m);
    }
    // Castling
    if (this.pieceType(p) === 'K' && !this.inCheck(this.turn)) {
      const row = this.turn === 'w' ? 7 : 0;
      if (this.castling.includes(this.turn === 'w' ? 'K' : 'k')) {
        if (!this.get(row, 5) && !this.get(row, 6) &&
            this.get(row, 7) === this.turn + 'R' &&
            !this.isAttacked(row, 5, this.turn === 'w' ? 'b' : 'w') &&
            !this.isAttacked(row, 6, this.turn === 'w' ? 'b' : 'w')) {
          legal.push({ from: [r, c], to: [row, 6], castle: 'K' });
        }
      }
      if (this.castling.includes(this.turn === 'w' ? 'Q' : 'q')) {
        if (!this.get(row, 3) && !this.get(row, 2) && !this.get(row, 1) &&
            this.get(row, 0) === this.turn + 'R' &&
            !this.isAttacked(row, 3, this.turn === 'w' ? 'b' : 'w') &&
            !this.isAttacked(row, 2, this.turn === 'w' ? 'b' : 'w')) {
          legal.push({ from: [r, c], to: [row, 2], castle: 'Q' });
        }
      }
    }
    return legal;
  }

  allLegalMoves(color) {
    const all = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = this.board[r][c];
      if (p && this.pieceColor(p) === color) {
        const moves = this.movesFrom(r, c);
        for (const m of moves) {
          const g = this.applyMove(m);
          if (!g.inCheck(color)) all.push(m);
        }
      }
    }
    return all;
  }

  applyMove(m) {
    const g = new ChessGame(this.toFEN());
    const [fr, fc] = m.from;
    const [tr, tc] = m.to;
    const p = g.board[fr][fc];
    const captured = g.board[tr][tc];

    // En passant capture
    if (m.ep) {
      g.board[fr][tc] = null;
    }
    // Castling rook move
    if (m.castle === 'K') {
      g.board[tr][5] = g.board[tr][7];
      g.board[tr][7] = null;
    } else if (m.castle === 'Q') {
      g.board[tr][3] = g.board[tr][0];
      g.board[tr][0] = null;
    }
    g.board[tr][tc] = p;
    g.board[fr][fc] = null;

    // Pawn promotion -> Queen
    if (p[1] === 'P' && (tr === 0 || tr === 7)) {
      g.board[tr][tc] = p[0] + 'Q';
    }

    // Update castling rights
    let cast = g.castling;
    if (p === 'wK') cast = cast.replace(/[KQ]/g, '');
    if (p === 'bK') cast = cast.replace(/[kq]/g, '');
    if (fr === 7 && fc === 0 || tr === 7 && tc === 0) cast = cast.replace('Q', '');
    if (fr === 7 && fc === 7 || tr === 7 && tc === 7) cast = cast.replace('K', '');
    if (fr === 0 && fc === 0 || tr === 0 && tc === 0) cast = cast.replace('q', '');
    if (fr === 0 && fc === 7 || tr === 0 && tc === 7) cast = cast.replace('k', '');
    if (cast === '') cast = '-';
    g.castling = cast;

    // En passant target
    if (p[1] === 'P' && Math.abs(tr - fr) === 2) {
      g.enPassant = ChessGame.sq((fr + tr) / 2, fc);
    } else {
      g.enPassant = '-';
    }

    g.turn = this.turn === 'w' ? 'b' : 'w';
    g.history = [...this.history, m];
    return g;
  }

  makeMove(m) {
    const g = this.applyMove(m);
    this.board = g.board;
    this.turn = g.turn;
    this.castling = g.castling;
    this.enPassant = g.enPassant;
    this.history = g.history;
    return this;
  }

  undo() {
    if (this.history.length === 0) return false;
    const fen = this.fenHistory?.pop?.() || null;
    // Simple: rebuild from start with all but last move
    const moves = this.history.slice(0, -1);
    this.load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    for (const m of moves) this.makeMove(m);
    return true;
  }

  gameOver() {
    const moves = this.allLegalMoves(this.turn);
    if (moves.length === 0) {
      if (this.inCheck(this.turn)) return { type: 'checkmate', winner: this.turn === 'w' ? 'b' : 'w' };
      return { type: 'stalemate' };
    }
    return null;
  }
}
