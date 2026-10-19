import { ChessGame } from './chess-engine.js';

const VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
const PIECE_SQ = {
  // Simplified piece-square tables (white perspective)
  P: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10,
      5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5,
      5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  N: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40,
      -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30,
      -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  B: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10,
      -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10,
      -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  R: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  Q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10,
      -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5,
      -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  K: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
      20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  K_END: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30,
      -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30,
      -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30,
      -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50]
};

function evaluate(game) {
  let score = 0;
  let totalPieces = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = game.board[r][c];
    if (!p) continue;
    const color = p[0];
    const type = p[1];
    if (type !== 'K') totalPieces += VALUES[type];
    const idx = color === 'w' ? r * 8 + c : (7 - r) * 8 + c;
    let val = VALUES[type];
    if (type === 'K' && totalPieces < 1300) val += PIECE_SQ.K_END[idx];
    else if (PIECE_SQ[type]) val += PIECE_SQ[type][idx];
    score += color === 'w' ? val : -val;
  }
  return game.turn === 'w' ? score : -score;
}

function orderMoves(moves) {
  return moves.sort((a, b) => (b.capture ? 100 : 0) - (a.capture ? 100 : 0));
}

function negamax(game, depth, alpha, beta) {
  const over = game.gameOver();
  if (over) {
    if (over.type === 'checkmate') return -100000 + depth * 100;
    return 0;
  }
  if (depth === 0) return evaluate(game);

  const moves = orderMoves(game.allLegalMoves(game.turn));
  let best = -Infinity;
  for (const m of moves) {
    const g = game.applyMove(m);
    const score = -negamax(g, depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function pickMove(game, level) {
  const moves = game.allLegalMoves(game.turn);
  if (moves.length === 0) return null;

  const cfg = {
    tai:    { depth: 2, randomness: 0 },     // Tài Cực Mạnh
    hikaru: { depth: 3, randomness: 0 },     // Hikaru Nakamura
    magnus: { depth: 4, randomness: 0 }      // Magnus Carlsen
  }[level];

  // Add small randomization at low depth for variety
  let best = -Infinity;
  let bestMoves = [];
  for (const m of orderMoves(moves)) {
    const g = game.applyMove(m);
    const score = -negamax(g, cfg.depth - 1, -Infinity, Infinity);
    if (score > best) { best = score; bestMoves = [m]; }
    else if (score === best) bestMoves.push(m);
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}
