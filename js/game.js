'use strict';

// ===== Constants =====
const EMPTY = 0;
const BLACK = 1; // Player
const WHITE = 2; // CPU
const SIZE  = 8;

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

/**
 * Position weight table for AI evaluation.
 *   Corners (100)  : highest priority – stable and valuable.
 *   X-squares(-50) : right next to corners – avoid unless corner taken.
 *   C-squares(-20) : edge-adjacent to corners – also risky.
 *   Edges (10/5)   : moderately good.
 *   Inner cells(1) : small positive value.
 */
const WEIGHTS = [
  [100, -20,  10,  5,  5,  10, -20, 100],
  [-20, -50,  -2, -2, -2,  -2, -50, -20],
  [ 10,  -2,   5,  1,  1,   5,  -2,  10],
  [  5,  -2,   1,  1,  1,   1,  -2,   5],
  [  5,  -2,   1,  1,  1,   1,  -2,   5],
  [ 10,  -2,   5,  1,  1,   5,  -2,  10],
  [-20, -50,  -2, -2, -2,  -2, -50, -20],
  [100, -20,  10,  5,  5,  10, -20, 100],
];

// ===== Game State =====
let board      = [];
let isGameOver = false;
let isAiMoving = false;
let lastMove   = null;  // { r, c } of the most recently placed piece
let lastFlips  = [];    // [[r,c], ...] pieces flipped by last move

// ===== Board Logic =====

function createBoard() {
  const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  const m = SIZE / 2;
  b[m - 1][m - 1] = WHITE;
  b[m - 1][m    ] = BLACK;
  b[m    ][m - 1] = BLACK;
  b[m    ][m    ] = WHITE;
  return b;
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

/** Returns [[r,c], ...] of pieces flipped if `player` places at (r,c). */
function getFlips(b, r, c, player) {
  const opp   = player === BLACK ? WHITE : BLACK;
  const flips = [];

  for (const [dr, dc] of DIRS) {
    const line = [];
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc) && b[nr][nc] === opp) {
      line.push([nr, nc]);
      nr += dr;
      nc += dc;
    }
    if (line.length > 0 && inBounds(nr, nc) && b[nr][nc] === player) {
      flips.push(...line);
    }
  }
  return flips;
}

function isValidMove(b, r, c, player) {
  return b[r][c] === EMPTY && getFlips(b, r, c, player).length > 0;
}

function getValidMoves(b, player) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (isValidMove(b, r, c, player)) moves.push({ r, c });
    }
  }
  return moves;
}

/**
 * Apply a move and return { board, flips }.
 * Does NOT mutate the original board.
 */
function applyMove(b, r, c, player) {
  const nb    = b.map(row => row.slice());
  const flips = getFlips(nb, r, c, player);
  nb[r][c]    = player;
  for (const [fr, fc] of flips) nb[fr][fc] = player;
  return { board: nb, flips };
}

function countPieces(b, player) {
  return b.flat().filter(v => v === player).length;
}

// ===== AI =====

/**
 * Heuristic evaluation of `b` from `player`'s perspective.
 *
 * Three components:
 *   1. Position weights  – strategic value of occupied squares.
 *   2. Mobility          – difference in number of valid moves.
 *   3. Coin parity       – raw piece count difference (weighted late-game).
 */
function evaluate(b, player) {
  const opp = player === BLACK ? WHITE : BLACK;

  let posScore = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if      (b[r][c] === player) posScore += WEIGHTS[r][c];
      else if (b[r][c] === opp)    posScore -= WEIGHTS[r][c];
    }
  }

  const myMobility  = getValidMoves(b, player).length;
  const oppMobility = getValidMoves(b, opp).length;
  const mobility    = 10 * (myMobility - oppMobility);

  const myCount  = countPieces(b, player);
  const oppCount = countPieces(b, opp);
  const parity   = myCount - oppCount;

  const empty = b.flat().filter(v => v === EMPTY).length;

  // Early / mid game: emphasise position + mobility.
  // End game: coin parity becomes decisive.
  return empty > 16
    ? posScore * 2 + mobility
    : posScore     + mobility + parity * 3;
}

/**
 * Select the CPU's move.
 *
 * Strategy:
 *   • 20% chance → random valid move   (keeps the game fun and beatable)
 *   • 80% chance → greedy best move evaluated by `evaluate()`
 *                  (ties broken at random)
 */
function pickAiMove() {
  const moves = getValidMoves(board, WHITE);
  if (moves.length === 0) return null;

  // Random branch
  if (Math.random() < 0.20) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // Greedy best-move
  let best  = -Infinity;
  let picks = [];

  for (const mv of moves) {
    const { board: nb } = applyMove(board, mv.r, mv.c, WHITE);
    const score = evaluate(nb, WHITE);
    if      (score > best) { best = score; picks = [mv]; }
    else if (score === best)                picks.push(mv);
  }

  return picks[Math.floor(Math.random() * picks.length)];
}

// ===== Rendering =====

function render() {
  const boardEl  = document.getElementById('board');
  const validSet = new Set();

  if (!isGameOver && !isAiMoving) {
    for (const mv of getValidMoves(board, BLACK)) {
      validSet.add(`${mv.r},${mv.c}`);
    }
  }

  const fragment = document.createDocumentFragment();

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell       = document.createElement('div');
      cell.className   = 'cell';
      cell.dataset.r   = r;  // needed by click handler
      cell.dataset.c   = c;

      if (board[r][c] !== EMPTY) {
        const piece       = document.createElement('div');
        piece.className   = `piece ${board[r][c] === BLACK ? 'black' : 'white'}`;

        if (lastMove && r === lastMove.r && c === lastMove.c) {
          piece.classList.add('just-placed');
        }

        const flipIdx = lastFlips.findIndex(([fr, fc]) => fr === r && fc === c);
        if (flipIdx !== -1) {
          piece.classList.add('just-flipped');
          piece.style.animationDelay = `${flipIdx * 40}ms`;
        }

        cell.appendChild(piece);

      } else if (validSet.has(`${r},${c}`)) {
        cell.classList.add('valid-hint');
        cell.addEventListener('click', onCellClick);
      }

      fragment.appendChild(cell);
    }
  }

  boardEl.innerHTML = '';
  boardEl.appendChild(fragment);

  document.getElementById('black-count').textContent = countPieces(board, BLACK);
  document.getElementById('white-count').textContent = countPieces(board, WHITE);

  document.getElementById('player-side').classList.toggle('active', !isAiMoving && !isGameOver);
  document.getElementById('ai-side').classList.toggle('active', isAiMoving);
}

function setTurn(text) {
  document.getElementById('turn-display').textContent = text;
}

function setMsg(text, isOver = false) {
  const el    = document.getElementById('message');
  el.textContent = text;
  el.className   = isOver ? 'game-over' : '';
}

// ===== Turn Flow =====

/** Called right after the player places a piece. */
function afterPlayerMove() {
  const whiteMoves = getValidMoves(board, WHITE);
  const blackMoves = getValidMoves(board, BLACK);

  if (whiteMoves.length === 0 && blackMoves.length === 0) {
    endGame();
    return;
  }

  if (whiteMoves.length === 0) {
    // CPU cannot move → CPU passes
    setMsg('CPUはパスします');
    setTurn('あなたの番');
    isAiMoving = false;
    render();
    setTimeout(() => setMsg(''), 1400);
    return;
  }

  // Schedule CPU move
  isAiMoving = true;
  setTurn('CPUが考え中…');
  render();
  setTimeout(doAiTurn, 550 + Math.random() * 500);
}

/** Execute one CPU turn (possibly recursive if player must pass). */
function doAiTurn() {
  const mv = pickAiMove();

  if (mv) {
    const result = applyMove(board, mv.r, mv.c, WHITE);
    board     = result.board;
    lastMove  = { r: mv.r, c: mv.c };
    lastFlips = result.flips;
  }

  isAiMoving = false;

  const blackMoves = getValidMoves(board, BLACK);
  const whiteMoves = getValidMoves(board, WHITE);

  if (blackMoves.length === 0 && whiteMoves.length === 0) {
    render();
    endGame();
    return;
  }

  if (blackMoves.length === 0) {
    // Player cannot move → player passes, CPU plays again
    setMsg('あなたはパスします');
    setTurn('CPUが考え中…');
    render();
    isAiMoving = true;
    setTimeout(() => {
      setMsg('');
      setTimeout(doAiTurn, 550 + Math.random() * 500);
    }, 1200);
    return;
  }

  setTurn('あなたの番');
  setMsg('');
  render();
}

function onCellClick(e) {
  if (isGameOver || isAiMoving) return;

  const cell = e.currentTarget;
  const r    = Number(cell.dataset.r);
  const c    = Number(cell.dataset.c);

  if (!isValidMove(board, r, c, BLACK)) return;

  const result = applyMove(board, r, c, BLACK);
  board     = result.board;
  lastMove  = { r, c };
  lastFlips = result.flips;

  render();
  afterPlayerMove();
}

function endGame() {
  isGameOver = true;
  lastMove   = null;
  lastFlips  = [];

  const b = countPieces(board, BLACK);
  const w = countPieces(board, WHITE);
  let msg;

  if      (b > w) msg = `あなたの勝ち！🎉  (${b} vs ${w})`;
  else if (w > b) msg = `CPUの勝ち… 😔  (${w} vs ${b})`;
  else            msg = `引き分け！🤝  (${b} vs ${w})`;

  setTurn('ゲーム終了');
  setMsg(msg, true);
  render();
}

// ===== Init =====

function initGame() {
  board      = createBoard();
  isGameOver = false;
  isAiMoving = false;
  lastMove   = null;
  lastFlips  = [];

  setTurn('あなたの番');
  setMsg('');
  render();
}

document.addEventListener('DOMContentLoaded', initGame);
