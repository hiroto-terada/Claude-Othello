'use strict';

// ===== ズーム禁止 (iOS Safari 対策) =====
// ピンチズーム禁止
document.addEventListener('gesturestart',  e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
document.addEventListener('gestureend',    e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
// ダブルタップズーム禁止
let _lastTap = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - _lastTap < 300) e.preventDefault();
  _lastTap = now;
}, { passive: false });

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
let currentDifficulty = 'medium'; // 'weak' | 'medium' | 'strong' | 'god'

// ===== Advice Mode =====
let adviceMode        = false;
let currentAdvice     = null; // null | { loading: true } | { r, c }
let adviceScheduleId  = null;

function clearAdvice() {
  if (adviceScheduleId) { clearTimeout(adviceScheduleId); adviceScheduleId = null; }
  currentAdvice = null;
}

function scheduleAdvice() {
  clearAdvice();
  if (!adviceMode || isGameOver || isAiMoving) return;
  currentAdvice = { loading: true };
  adviceScheduleId = setTimeout(() => {
    adviceScheduleId = null;
    if (!adviceMode || isGameOver || isAiMoving) return;
    currentAdvice = bestAdviceMove(); // null or { r, c }
    render();
  }, 30);
}

const CPU_NAMES = { weak: 'スライム', medium: 'ナイト', strong: '魔王', god: '神(God)' };

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
  god: `
    <div class="av-god">
      <div class="gd-halo"></div>
      <div class="gd-face">
        <div class="gd-eye gd-el"></div>
        <div class="gd-eye gd-er"></div>
        <div class="gd-smile"></div>
      </div>
      <div class="gd-wing gd-wl"></div>
      <div class="gd-wing gd-wr"></div>
    </div>`,
};

const CPU_MOOD_TEXTS = {
  weak:   { 'mood-happy': 'やったー！', 'mood-neutral': 'えへへ…',      'mood-sad': 'うわーん！'   },
  medium: { 'mood-happy': '余裕だな',   'mood-neutral': '油断するな',   'mood-sad': 'くっ…'       },
  strong: { 'mood-happy': 'フフフ…',   'mood-neutral': 'なかなかやる', 'mood-sad': 'な、なんと…'  },
  god:    { 'mood-happy': '全て見えている', 'mood-neutral': '運命は決まっている', 'mood-sad': '…ほう' },
};

const CPU_GAMEOVER_TEXTS = {
  weak:   { win: 'やったー！勝ったよ！', lose: 'うわーん負けたー！',   draw: 'ひきわけだね！'     },
  medium: { win: '完璧だ。',             lose: '…まさか。',             draw: '互角だったな。'     },
  strong: { win: 'フハハ！圧勝だ！',     lose: '貴様…やるな。',         draw: 'くっ、引き分けか…'  },
  god:    { win: '必然の結末だ。',        lose: '…奇跡を起こしたな。',   draw: '均衡した宇宙だ。'   },
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

// ===== BGM System =====

let audioCtx   = null;
let bgmMuted   = false;
let bgmActive  = false;
let bgmStep    = 0;
let bgmNextT   = 0;
let bgmTimerId = null;

const BGM = {
  // スライム: 明るい C メジャー、軽快なアドベンチャー曲
  weak: {
    wave: 'triangle', vol: 0.10, filter: 1800,
    notes: [
      [523.25,0.23],[392.00,0.23],[329.63,0.23],[392.00,0.23],
      [440.00,0.23],[349.23,0.23],[392.00,0.46],
      [329.63,0.23],[261.63,0.23],[329.63,0.23],[392.00,0.23],
      [440.00,0.46],[392.00,0.46],
      [523.25,0.23],[440.00,0.23],[392.00,0.23],[329.63,0.23],
      [293.66,0.23],[261.63,0.69],
    ],
  },
  // ナイト: G メジャー英雄的マーチ、緊張感ある行進曲
  medium: {
    wave: 'square', vol: 0.055, filter: 900,
    notes: [
      [392.00,0.27],[392.00,0.27],[493.88,0.27],[0,0.27],
      [440.00,0.27],[440.00,0.27],[392.00,0.55],
      [523.25,0.27],[493.88,0.27],[440.00,0.27],[0,0.27],
      [392.00,0.55],[0,0.55],
      [587.33,0.27],[523.25,0.27],[493.88,0.27],[440.00,0.27],
      [392.00,1.09],
    ],
  },
  // 魔王: D マイナー、ダークで激しいラストバトル曲
  strong: {
    wave: 'sawtooth', vol: 0.07, filter: 700,
    notes: [
      [293.66,0.11],[0,0.11],[293.66,0.11],[0,0.11],[349.23,0.32],
      [415.30,0.43],[0,0.11],[293.66,0.11],[415.30,0.11],[391.99,0.43],
      [369.99,0.11],[0,0.11],[369.99,0.11],[0,0.11],[349.23,0.32],
      [329.63,0.43],[0,0.11],[293.66,0.43],
      [293.66,0.11],[0,0.11],[311.13,0.11],[0,0.11],[349.23,0.32],
      [391.99,0.21],[369.99,0.21],[349.23,0.21],[293.66,0.65],
    ],
  },
  // 神: E マイナーバロック聖歌、神秘的で荘厳なサクラッド曲
  god: {
    wave: 'sine', vol: 0.12, filter: 2000, harmony: true,
    notes: [
      [329.63,0.46],[369.99,0.46],[392.00,0.46],[440.00,0.46],
      [493.88,0.46],[523.25,0.46],[493.88,0.46],[440.00,0.46],
      [392.00,0.46],[440.00,0.23],[392.00,0.23],[369.99,0.46],[329.63,0.46],
      [293.66,0.23],[329.63,0.23],[369.99,0.46],[392.00,0.46],[329.63,0.92],
    ],
  },
};

function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function scheduleNote(freq, startT, dur, track) {
  if (!freq) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filt = audioCtx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = track.filter;
  osc.type = track.wave;
  osc.frequency.value = freq;
  osc.connect(filt); filt.connect(gain); gain.connect(audioCtx.destination);
  gain.gain.setValueAtTime(track.vol, startT);
  gain.gain.exponentialRampToValueAtTime(0.0001, startT + dur * 0.88);
  osc.start(startT); osc.stop(startT + dur);

  if (track.harmony) {
    const osc2  = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = freq * (2 / 3); // 完全5度下
    osc2.connect(gain2); gain2.connect(audioCtx.destination);
    gain2.gain.setValueAtTime(track.vol * 0.45, startT);
    gain2.gain.exponentialRampToValueAtTime(0.0001, startT + dur * 0.88);
    osc2.start(startT); osc2.stop(startT + dur);
  }
}

function bgmTick() {
  if (!audioCtx || !bgmActive || bgmMuted) return;
  const track = BGM[currentDifficulty];
  if (!track) return;
  while (bgmNextT < audioCtx.currentTime + 0.12) {
    const [freq, dur] = track.notes[bgmStep % track.notes.length];
    scheduleNote(freq, bgmNextT, dur, track);
    bgmNextT += dur;
    bgmStep = (bgmStep + 1) % track.notes.length;
  }
  bgmTimerId = setTimeout(bgmTick, 50);
}

function startBgm() {
  stopBgm();
  initAudio();
  bgmActive = true;
  bgmStep   = 0;
  bgmNextT  = audioCtx.currentTime + 0.1;
  if (!bgmMuted) bgmTick();
}

function stopBgm() {
  bgmActive = false;
  if (bgmTimerId) { clearTimeout(bgmTimerId); bgmTimerId = null; }
}

function toggleMute() {
  bgmMuted = !bgmMuted;
  document.getElementById('mute-btn').textContent = bgmMuted ? '🔇' : '🎵';
  if (!bgmMuted && bgmActive) {
    bgmNextT = audioCtx.currentTime + 0.1;
    bgmTick();
  }
}

// ===== Screen Management =====

function showSelectScreen() {
  document.getElementById('select-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.body.classList.remove('difficulty-weak', 'difficulty-medium', 'difficulty-strong', 'difficulty-god');
  stopBgm();
}

function showGameScreen() {
  document.getElementById('select-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

function startGame(difficulty) {
  currentDifficulty = difficulty;
  adviceMode = document.getElementById('advice-toggle').checked;
  document.getElementById('cpu-label').textContent = CPU_NAMES[difficulty];
  document.body.classList.remove('difficulty-weak', 'difficulty-medium', 'difficulty-strong', 'difficulty-god');
  document.body.classList.add(`difficulty-${difficulty}`);
  showGameScreen();
  startBgm();
  initCpuFace();
  initGame();
}

// ===== Advice Logic =====

function posLabel(r, c) {
  return 'ABCDEFGH'[c] + (r + 1);
}

function posTypeName(r, c) {
  const w = WEIGHTS[r][c];
  if (w === 100)  return '角';
  if (w === -50)  return 'Xマス（角の斜め隣）';
  if (w === -20)  return 'Cマス（角の隣）';
  if (r === 0 || r === 7 || c === 0 || c === 7) return '辺';
  return '内側';
}

function getAdviceExplanation(b, r, c) {
  const flips   = getFlips(b, r, c, BLACK);
  const w       = WEIGHTS[r][c];
  const empty   = countEmpty(b);
  const { board: nb } = applyMove(b, r, c, BLACK);
  const oppMovesAfter = getValidMoves(nb, WHITE).length;

  // 全候補手の中で最も多く取れる手を探す（比較用）
  const allMoves = getValidMoves(b, BLACK);
  let greedyMove = null;
  let greedyFlips = flips.length;
  for (const mv of allMoves) {
    const f = getFlips(b, mv.r, mv.c, BLACK).length;
    if (f > greedyFlips) { greedyFlips = f; greedyMove = mv; }
  }

  const parts = [];

  // ① 位置の質
  if (w === 100) {
    parts.push('角を取れます！角の石は絶対にひっくり返されない最強の位置です');
  } else if (w === -50) {
    parts.push('Xマス（角の斜め隣）です。危険ですが先読みの結果、現局面での最善手です');
  } else if (w === -20) {
    parts.push('Cマス（角の隣）です。リスクはありますが先読みでは最善手です');
  } else if (r === 0 || r === 7 || c === 0 || c === 7) {
    parts.push('辺の手です。辺の石は安定してひっくり返されにくく、後半も残りやすいです');
  } else {
    parts.push('内側の手です');
  }

  // ② 石数比較と戦略的根拠
  if (greedyMove !== null) {
    // より多く取れる手があるのにこちらを推奨している理由を説明
    const { board: gnb } = applyMove(b, greedyMove.r, greedyMove.c, BLACK);
    const greedyOppMoves = getValidMoves(gnb, WHITE).length;
    const greedyType     = posTypeName(greedyMove.r, greedyMove.c);

    if (oppMovesAfter < greedyOppMoves) {
      parts.push(
        `${flips.length}個しか取れませんが、${greedyFlips}個取れる手より優先しています。` +
        `多く取ると相手の選択肢が${greedyOppMoves}個残りますが、この手なら${oppMovesAfter}個に絞れます。` +
        `序盤・中盤は石数より「相手の動ける場所を減らす」ことが重要です`
      );
    } else if (WEIGHTS[greedyMove.r][greedyMove.c] < w) {
      parts.push(
        `${flips.length}個しか取れませんが、${greedyFlips}個取れる手（${greedyType}）は` +
        `位置が不利なため避けています。石数より配置の質を優先した判断です`
      );
    } else {
      parts.push(
        `${flips.length}個しか取れませんが、${greedyFlips}個取れる手より8手先を読んだ結果` +
        `こちらが最終的に有利になります`
      );
    }
  } else {
    parts.push(`${flips.length}個ひっくり返します`);
  }

  // ③ 相手の選択肢（①②で既に触れていない場合）
  if (greedyMove === null && oppMovesAfter <= 3) {
    parts.push(`この手の後、相手の選択肢を${oppMovesAfter}個に絞れます`);
  }

  // ④ ゲームフェーズ別の一言
  if (empty <= 16) {
    parts.push('終盤：石の数が直接勝敗を決めます。一手一手が重要です');
  } else if (empty <= 32) {
    parts.push('中盤：相手を制限しながら安定した配置を築く時期です');
  } else {
    parts.push('序盤：角・辺を意識して相手の選択肢を狭めましょう');
  }

  return parts.join('。') + '。';
}

// ===== Advice Minimax (BLACK視点、神AIより深い) =====

const ADVICE_ENDGAME_THRESHOLD = 14; // 残り15マス以下で完全読み切り（速度と精度のバランス）

// BLACK最大化・WHITE最小化のminimax（評価値はBLACKに有利=正）
function minimaxAdvice(b, depth, alpha, beta, isBlackTurn) {
  const blackMoves = getValidMoves(b, BLACK);
  const whiteMoves = getValidMoves(b, WHITE);

  if (depth === 0 || (blackMoves.length === 0 && whiteMoves.length === 0)) {
    return -evaluateGod(b); // evaluateGodはWHITE視点なので符号反転
  }

  if (isBlackTurn) {
    if (blackMoves.length === 0) return minimaxAdvice(b, depth - 1, alpha, beta, false);
    let maxVal = -Infinity;
    for (const mv of sortMovesByWeight(blackMoves)) {
      const { board: nb } = applyMove(b, mv.r, mv.c, BLACK);
      const val = minimaxAdvice(nb, depth - 1, alpha, beta, false);
      if (val > maxVal) maxVal = val;
      if (maxVal > alpha) alpha = maxVal;
      if (alpha >= beta) break;
    }
    return maxVal;
  } else {
    if (whiteMoves.length === 0) return minimaxAdvice(b, depth - 1, alpha, beta, true);
    let minVal = Infinity;
    for (const mv of sortMovesByWeight(whiteMoves)) {
      const { board: nb } = applyMove(b, mv.r, mv.c, WHITE);
      const val = minimaxAdvice(nb, depth - 1, alpha, beta, true);
      if (val < minVal) minVal = val;
      if (minVal < beta) beta = minVal;
      if (alpha >= beta) break;
    }
    return minVal;
  }
}

function bestAdviceMove() {
  const moves = getValidMoves(board, BLACK);
  if (moves.length === 0) return null;

  const empty  = countEmpty(board);
  const sorted = sortMovesByWeight(moves);
  let best = null, bestScore = -Infinity, alpha = -Infinity;

  for (const mv of sorted) {
    const { board: nb } = applyMove(board, mv.r, mv.c, BLACK);
    let score;
    if (empty - 1 <= ADVICE_ENDGAME_THRESHOLD) {
      // 完全読み切り（神の12より多い18マスから発動）
      score = -solveExact(nb, WHITE, -Infinity, -alpha);
    } else {
      // 深さ8先読み（神AIは深さ6、アドバイスはそれより2手深い）
      score = minimaxAdvice(nb, 7, alpha, Infinity, false);
    }
    if (score > bestScore) { bestScore = score; best = mv; }
    if (bestScore > alpha) alpha = bestScore;
  }
  return best;
}

function updateAdvicePanel() {
  const panel = document.getElementById('advice-panel');
  if (!adviceMode || isGameOver || isAiMoving || !currentAdvice) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  if (currentAdvice.loading) {
    document.getElementById('advice-pos').textContent  = '';
    document.getElementById('advice-text').textContent = '考え中…';
    return;
  }
  document.getElementById('advice-pos').textContent  = posLabel(currentAdvice.r, currentAdvice.c);
  document.getElementById('advice-text').textContent = getAdviceExplanation(board, currentAdvice.r, currentAdvice.c);
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

/* 神: depth-6 minimax + move ordering + exact endgame solver (≤12 empties) */

const GOD_ENDGAME_THRESHOLD = 12;

function countEmpty(b) {
  let n = 0;
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (b[r][c] === EMPTY) n++;
  return n;
}

function evaluateGod(b) {
  let posScore = 0, myCount = 0, oppCount = 0;
  let myFrontier = 0, oppFrontier = 0;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = b[r][c];
      if (cell === EMPTY) continue;
      if (cell === WHITE) { posScore += WEIGHTS[r][c]; myCount++; }
      else                { posScore -= WEIGHTS[r][c]; oppCount++; }

      let frontier = false;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc) && b[nr][nc] === EMPTY) { frontier = true; break; }
      }
      if (frontier) { if (cell === WHITE) myFrontier++; else oppFrontier++; }
    }
  }

  // Corner stability bonus
  let cornerBonus = 0;
  for (const [cr, cc] of [[0,0],[0,7],[7,0],[7,7]]) {
    if      (b[cr][cc] === WHITE) cornerBonus += 30;
    else if (b[cr][cc] === BLACK) cornerBonus -= 30;
  }

  const myMoves  = getValidMoves(b, WHITE).length;
  const oppMoves = getValidMoves(b, BLACK).length;
  const mobility  = 15 * (myMoves - oppMoves);
  const frontier  =  5 * (oppFrontier - myFrontier);
  const parity    = myCount - oppCount;
  const empty     = 64 - myCount - oppCount;

  return empty > 16
    ? posScore * 3 + mobility * 2 + frontier * 2 + cornerBonus * 3
    : posScore * 2 + mobility     + frontier     + parity * 4 + cornerBonus * 2;
}

// Sort moves best-first for alpha-beta efficiency (higher weight = try first)
function sortMovesByWeight(moves) {
  return [...moves].sort((a, b) => WEIGHTS[b.r][b.c] - WEIGHTS[a.r][a.c]);
}

function minimaxGod(b, depth, alpha, beta, isMaximizing) {
  const myMoves  = getValidMoves(b, WHITE);
  const oppMoves = getValidMoves(b, BLACK);

  if (depth === 0 || (myMoves.length === 0 && oppMoves.length === 0)) {
    return evaluateGod(b);
  }

  if (isMaximizing) {
    if (myMoves.length === 0) return minimaxGod(b, depth - 1, alpha, beta, false);
    let maxVal = -Infinity;
    for (const mv of sortMovesByWeight(myMoves)) {
      const { board: nb } = applyMove(b, mv.r, mv.c, WHITE);
      const val = minimaxGod(nb, depth - 1, alpha, beta, false);
      if (val > maxVal) maxVal = val;
      if (maxVal > alpha) alpha = maxVal;
      if (alpha >= beta) break;
    }
    return maxVal;
  } else {
    if (oppMoves.length === 0) return minimaxGod(b, depth - 1, alpha, beta, true);
    let minVal = Infinity;
    for (const mv of sortMovesByWeight(oppMoves)) {
      const { board: nb } = applyMove(b, mv.r, mv.c, BLACK);
      const val = minimaxGod(nb, depth - 1, alpha, beta, true);
      if (val < minVal) minVal = val;
      if (minVal < beta) beta = minVal;
      if (alpha >= beta) break;
    }
    return minVal;
  }
}

// Negamax exact endgame solver: returns (my pieces - opponent pieces) from `color`'s view
function solveExact(b, color, alpha, beta) {
  const opp   = color === WHITE ? BLACK : WHITE;
  const moves = getValidMoves(b, color);

  if (moves.length === 0) {
    const oppMoves = getValidMoves(b, opp);
    if (oppMoves.length === 0) {
      return countPieces(b, color) - countPieces(b, opp);
    }
    return -solveExact(b, opp, -beta, -alpha);
  }

  let best = -Infinity;
  for (const mv of sortMovesByWeight(moves)) {
    const { board: nb } = applyMove(b, mv.r, mv.c, color);
    const score = -solveExact(nb, opp, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function pickAiMoveGod() {
  const moves = getValidMoves(board, WHITE);
  if (moves.length === 0) return null;

  const empty  = countEmpty(board);
  const sorted = sortMovesByWeight(moves);
  let best = null, bestScore = -Infinity, alpha = -Infinity;

  for (const mv of sorted) {
    const { board: nb } = applyMove(board, mv.r, mv.c, WHITE);
    let score;
    if (empty <= GOD_ENDGAME_THRESHOLD) {
      // Perfect endgame: solve exactly (WHITE maximizes piece count)
      score = -solveExact(nb, BLACK, -Infinity, -alpha);
    } else {
      // Deep minimax depth 6
      score = minimaxGod(nb, 5, alpha, Infinity, false);
    }
    if (score > bestScore) { bestScore = score; best = mv; }
    if (bestScore > alpha) alpha = bestScore;
  }
  return best;
}

function pickAiMove() {
  switch (currentDifficulty) {
    case 'weak':   return pickAiMoveWeak();
    case 'strong': return pickAiMoveStrong();
    case 'god':    return pickAiMoveGod();
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

  // アドバイスは非同期で計算済みの currentAdvice を使う（render内では計算しない）
  const advice = (currentAdvice && !currentAdvice.loading) ? currentAdvice : null;

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

      if (advice && r === advice.r && c === advice.c) {
        cell.classList.add('advice-best');
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
  updateAdvicePanel();
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
    scheduleAdvice();
    setTimeout(() => setMsg(''), 1400);
    return;
  }

  isAiMoving = true;
  setTurn('CPUが考え中…');
  render();

  const delay = (currentDifficulty === 'strong' || currentDifficulty === 'god')
    ? 1200 + Math.random() * 600
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
  scheduleAdvice();
}

function onCellClick(e) {
  if (isGameOver || isAiMoving) return;

  const cell = e.currentTarget;
  const r    = Number(cell.dataset.r);
  const c    = Number(cell.dataset.c);

  if (!isValidMove(board, r, c, BLACK)) return;

  clearAdvice();
  const result = applyMove(board, r, c, BLACK);
  board     = result.board;
  lastMove  = { r, c };
  lastFlips = result.flips;

  render();
  afterPlayerMove();
}

function endGame() {
  clearAdvice();
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
  scheduleAdvice();
}

document.addEventListener('DOMContentLoaded', () => {
  // 選択画面からスタート（#app は .hidden で非表示）
});
