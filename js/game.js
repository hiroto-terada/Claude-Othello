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
let board          = [];
let isGameOver     = false;
let isAiMoving     = false;
let isAwaitingFlip = false;
let lastMove       = null;
let lastFlips      = [];

// ===== Difficulty =====
let currentDifficulty = 'medium'; // 'weak' | 'medium' | 'strong'

const CPU_NAMES = { weak: 'スライム', medium: 'ナイト', strong: '魔王' };

// ===== CPU Face Data =====

const CPU_FACE_HTML = {
  weak: `
    <div class="av-slime">
      <div class="sl-shine"></div>
      <div class="sl-eye sl-l"></div>
      <div class="sl-eye sl-r"></div>
      <div class="sl-mouth"></div>
    </div>`,
  medium: `
    <div class="av-knight">
      <div class="kn-plume"></div>
      <div class="kn-helm">
        <div class="kn-visor"></div>
      </div>
    </div>`,
  strong: `
    <div class="av-demon">
      <div class="dm-horn dm-hl"></div>
      <div class="dm-horn dm-hr"></div>
      <div class="dm-face">
        <div class="dm-eye dm-el"></div>
        <div class="dm-eye dm-er"></div>
        <div class="dm-mouth">
          <div class="dm-tooth"></div>
          <div class="dm-tooth"></div>
        </div>
      </div>
    </div>`,
};

const CPU_MOOD_TEXTS = {
  weak:   { 'mood-happy': 'やったー！', 'mood-neutral': 'えへへ…',    'mood-sad': 'うわーん！' },
  medium: { 'mood-happy': '余裕だな',   'mood-neutral': '油断するな', 'mood-sad': 'くっ…'     },
  strong: { 'mood-happy': 'フフフ…',   'mood-neutral': 'なかなかやる', 'mood-sad': 'な、なんと…' },
};

const CPU_GAMEOVER_TEXTS = {
  weak:   { win: 'やったー！勝ったよ！', lose: 'うわーん負けたー！', draw: 'ひきわけだね！' },
  medium: { win: '完璧だ。',             lose: '…まさか。',           draw: '互角だったな。' },
  strong: { win: 'フハハ！圧勝だ！',     lose: '貴様…やるな。',       draw: 'くっ、引き分けか…' },
};

function initCpuFace() {
  const faceEl = document.getElementById('cpu-face');
  faceEl.innerHTML = CPU_FACE_HTML[currentDifficulty];
  faceEl.className = 'mood-neutral';
  document.getElementById('cpu-bubble-text').textContent =
    CPU_MOOD_TEXTS[currentDifficulty]['mood-neutral'];
}

function updateCpuMood(gameOver = false, result = null) {
  const faceEl   = document.getElementById('cpu-face');
  const bubbleEl = document.getElementById('cpu-bubble-text');
  if (!faceEl) return;

  let mood;
  let text;

  if (gameOver && result) {
    mood = result === 'cpu'  ? 'mood-happy'
         : result === 'player' ? 'mood-sad'
         : 'mood-neutral';
    const key = result === 'cpu' ? 'win' : result === 'player' ? 'lose' : 'draw';
    text = CPU_GAMEOVER_TEXTS[currentDifficulty][key];
  } else {
    const w    = countPieces(board, WHITE);
    const b    = countPieces(board, BLACK);
    const diff = w - b;
    mood = diff > 3 ? 'mood-happy' : diff < -3 ? 'mood-sad' : 'mood-neutral';
    text = CPU_MOOD_TEXTS[currentDifficulty][mood];
  }

  faceEl.className   = mood;
  bubbleEl.textContent = text;
}

// ===== Screen Management =====

function showSelectScreen() {
  document.getElementById('select-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showGameScreen() {
  document.getElementById('select-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

function startGame(difficulty) {
  currentDifficulty = difficulty;
  document.getElementById('cpu-label').textContent = CPU_NAMES[difficulty];
  showGameScreen();
  initCpuFace();
  initGame();
}

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

  return empty > 16
    ? posScore * 2 + mobility
    : posScore     + mobility + parity * 3;
}

/* 弱: 85% random, 15% greedy */
function pickAiMoveWeak() {
  const moves = getValidMoves(board, WHITE);
  if (moves.length === 0) return null;

  if (Math.random() < 0.85) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  let best = -Infinity, picks = [];
  for (const mv of moves) {
    const { board: nb } = applyMove(board, mv.r, mv.c, WHITE);
    const score = evaluate(nb, WHITE);
    if      (score > best)  { best = score; picks = [mv]; }
    else if (score === best)  picks.push(mv);
  }
  return picks[Math.floor(Math.random() * picks.length)];
}

/* 中: 20% random, 80% greedy */
function pickAiMoveMedium() {
  const moves = getValidMoves(board, WHITE);
  if (moves.length === 0) return null;

  if (Math.random() < 0.20) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  let best = -Infinity, picks = [];
  for (const mv of moves) {
    const { board: nb } = applyMove(board, mv.r, mv.c, WHITE);
    const score = evaluate(nb, WHITE);
    if      (score > best)  { best = score; picks = [mv]; }
    else if (score === best)  picks.push(mv);
  }
  return picks[Math.floor(Math.random() * picks.length)];
}

/* 強: minimax with alpha-beta pruning (depth 4) */
function minimaxAB(b, depth, alpha, beta, isMaximizing) {
  const myMoves  = getValidMoves(b, WHITE);
  const oppMoves = getValidMoves(b, BLACK);

  if (depth === 0 || (myMoves.length === 0 && oppMoves.length === 0)) {
    return evaluate(b, WHITE);
  }

  if (isMaximizing) {
    if (myMoves.length === 0) return minimaxAB(b, depth - 1, alpha, beta, false);
    let maxVal = -Infinity;
    for (const mv of myMoves) {
      const { board: nb } = applyMove(b, mv.r, mv.c, WHITE);
      const val = minimaxAB(nb, depth - 1, alpha, beta, false);
      if (val > maxVal) maxVal = val;
      if (val > alpha)  alpha  = val;
      if (alpha >= beta) break;
    }
    return maxVal;
  } else {
    if (oppMoves.length === 0) return minimaxAB(b, depth - 1, alpha, beta, true);
    let minVal = Infinity;
    for (const mv of oppMoves) {
      const { board: nb } = applyMove(b, mv.r, mv.c, BLACK);
      const val = minimaxAB(nb, depth - 1, alpha, beta, true);
      if (val < minVal) minVal = val;
      if (val < beta)   beta   = val;
      if (alpha >= beta) break;
    }
    return minVal;
  }
}

function pickAiMoveStrong() {
  const moves = getValidMoves(board, WHITE);
  if (moves.length === 0) return null;

  let best = -Infinity, picks = [];
  for (const mv of moves) {
    const { board: nb } = applyMove(board, mv.r, mv.c, WHITE);
    const score = minimaxAB(nb, 4, -Infinity, Infinity, false);
    if      (score > best)  { best = score; picks = [mv]; }
    else if (score === best)  picks.push(mv);
  }
  return picks[Math.floor(Math.random() * picks.length)];
}

function pickAiMove() {
  switch (currentDifficulty) {
    case 'weak':   return pickAiMoveWeak();
    case 'strong': return pickAiMoveStrong();
    default:       return pickAiMoveMedium();
  }
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
      const cell     = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;

      if (board[r][c] !== EMPTY) {
        const piece     = document.createElement('div');
        piece.className = `piece ${board[r][c] === BLACK ? 'black' : 'white'}`;

        if (lastMove && r === lastMove.r && c === lastMove.c) {
          piece.classList.add('just-placed');
          if (isAwaitingFlip) piece.classList.add('awaiting-flip');
        }

        const flipIdx = lastFlips.findIndex(([fr, fc]) => fr === r && fc === c);
        if (flipIdx !== -1) {
          piece.classList.add('just-flipped');
          piece.style.animationDelay = `${flipIdx * 80}ms`;
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

  updateCpuMood();
}

function setTurn(text) {
  document.getElementById('turn-display').textContent = text;
}

function setMsg(text, isOver = false) {
  const el       = document.getElementById('message');
  el.textContent = text;
  el.className   = isOver ? 'game-over' : '';
}

// ===== Turn Flow =====

function afterPlayerMove() {
  const whiteMoves = getValidMoves(board, WHITE);
  const blackMoves = getValidMoves(board, BLACK);

  if (whiteMoves.length === 0 && blackMoves.length === 0) {
    endGame();
    return;
  }

  if (whiteMoves.length === 0) {
    setMsg('CPUはパスします');
    setTurn('あなたの番');
    isAiMoving = false;
    render();
    setTimeout(() => setMsg(''), 1400);
    return;
  }

  isAiMoving = true;
  setTurn('CPUが考え中…');
  render();

  const delay = currentDifficulty === 'strong'
    ? 1400 + Math.random() * 800
    : 550 + Math.random() * 500;
  setTimeout(doAiTurn, delay);
}

function doAiTurn() {
  const mv = pickAiMove();

  if (mv) {
    const result = applyMove(board, mv.r, mv.c, WHITE);

    // Phase 1: show placed piece, highlight it
    const tempBoard = board.map(row => row.slice());
    tempBoard[mv.r][mv.c] = WHITE;
    board          = tempBoard;
    lastMove       = { r: mv.r, c: mv.c };
    lastFlips      = [];
    isAwaitingFlip = true;
    render();

    // Phase 2: flip after 1 second
    setTimeout(() => {
      board          = result.board;
      lastFlips      = result.flips;
      isAwaitingFlip = false;
      render();

      const flipAnimMs = result.flips.length > 0
        ? (result.flips.length - 1) * 80 + 450
        : 0;
      setTimeout(continueAfterAiTurn, flipAnimMs);
    }, 1000);

    return;
  }

  continueAfterAiTurn();
}

function continueAfterAiTurn() {
  isAiMoving = false;

  const blackMoves = getValidMoves(board, BLACK);
  const whiteMoves = getValidMoves(board, WHITE);

  if (blackMoves.length === 0 && whiteMoves.length === 0) {
    render();
    endGame();
    return;
  }

  if (blackMoves.length === 0) {
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

  let result;
  if      (b > w) { msg = `あなたの勝ち！🎉  (${b} vs ${w})`; result = 'player'; }
  else if (w > b) { msg = `CPUの勝ち… 😔  (${w} vs ${b})`; result = 'cpu';    }
  else            { msg = `引き分け！🤝  (${b} vs ${w})`;    result = 'draw';   }

  setTurn('ゲーム終了');
  setMsg(msg, true);
  render();
  updateCpuMood(true, result);
}

// ===== Init =====

function initGame() {
  board          = createBoard();
  isGameOver     = false;
  isAiMoving     = false;
  isAwaitingFlip = false;
  lastMove       = null;
  lastFlips      = [];

  const faceEl = document.getElementById('cpu-face');
  if (faceEl) {
    if (!faceEl.innerHTML.trim()) initCpuFace();
    else faceEl.className = 'mood-neutral';
    document.getElementById('cpu-bubble-text').textContent =
      CPU_MOOD_TEXTS[currentDifficulty]['mood-neutral'];
  }

  setTurn('あなたの番');
  setMsg('');
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  // 選択画面からスタート（#app は .hidden で非表示）
});
