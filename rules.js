// Pool8 — Game Rules & Logic
// Handles game state, rules enforcement, scoring, messages, and UI updates

import { Ball, CineBall, updatePhysics, getPockets } from './physics.js';

// Game rule constants
export const BALL_R = 15;
export const FRICTION = 0.986;
export const MIN_SPEED = 0.12;
export const MAX_POWER = 25;
export const CHARGE_RATE = 0.15;
export const POCKET_R = 30;

export const BALL_COLORS = [
    '#e74c3c', // 1 red
    '#3498db', // 2 blue
    '#f1c40f', // 3 yellow
    '#27ae60', // 4 green
    '#9b59b6', // 5 purple
    '#e67e22', // 6 orange
];

// Entry patterns for numbered balls (6 slots)
export const ENTRY_PATTERNS = [
    [{ex:-60,ey:null},{ex:-60,ey:null},{ex:-60,ey:null},
     {ex:-60,ey:null},{ex:-60,ey:null},{ex:-60,ey:null}],
    [{ex:null,ey:-60},{ex:null,ey:-60},{ex:null,ey:-60},
     {ex:null,ey:-60},{ex:null,ey:-60},{ex:null,ey:-60}],
    // ... (omitted for brevity, include all 10 patterns)
];

export function rackBalls(felt) {
    const ox = felt.x + felt.w * 0.7;
    const oy = felt.y + felt.h * 0.5;
    const d = BALL_R * 2 + 1;
    const hx = Math.sqrt(3) / 2 * d;
    return [
        [ox,          oy      ],
        [ox + hx,     oy - d / 2],
        [ox + hx,     oy + d / 2],
        [ox + 2*hx,   oy - d  ],
        [ox + 2*hx,   oy      ],
        [ox + 2*hx,   oy + d  ],
    ];
}

export function buildIntro(state, felt, W, H) {
    state.cineBalls = [];
    const rack = rackBalls(felt);
    const patIdx = (state.frame - 1) % ENTRY_PATTERNS.length;
    const pattern = ENTRY_PATTERNS[patIdx];

    const BALL_DELAY = 22;
    const BALL_SPEED = 5.5;
    for (let i = 0; i < 6; i++) {
        const [tx, ty] = rack[i];
        const ep = pattern[i];
        const sx = ep.ex !== null ? ep.ex : tx;
        const sy = ep.ey !== null ? ep.ey : ty;
        state.cineBalls.push(new CineBall({
            x: sx, y: sy,
            tx, ty,
            color: BALL_COLORS[i], number: i + 1,
            delay: i * BALL_DELAY,
            speed: BALL_SPEED,
        }));
    }

    const cueDelay = 6 * BALL_DELAY + 160;
    const cueX = felt.x + felt.w * 0.25;
    const cueY = felt.y + felt.h * 0.5;
    state.cineBalls.push(new CineBall({
        x: -60, y: cueY,
        tx: cueX, ty: cueY,
        color: '#ffffff', number: 0,
        delay: cueDelay, speed: BALL_SPEED,
    }));
}

export function applyReset(state, felt, fullReset) {
    state.balls = [];
    const rack = rackBalls(felt);
    state.balls.push(new Ball(felt.x + felt.w * 0.25, felt.y + felt.h * 0.5, '#ffffff', 0));
    for (let i = 0; i < 6; i++) {
        state.balls.push(new Ball(rack[i][0], rack[i][1], BALL_COLORS[i], i + 1));
    }
    if (fullReset) {
        state.score = 0;
        state.playerScore = 0;
        state.aiScore = 0;
        state.lives = 5;
        state.playerLives = 5;
        state.aiLives = 5;
        state.frame = 1;
        state.playerWins = 0;
        state.aiWins = 0;
        state.lastFrameWinner = 'player';
    }
    state.shotsLeft = 5;
    state.power = 0;
    state.charging = false;
    state.moving = false;
    state.potsThisShot = 0;
    state.cueFouled = false;
    state.gameOver = false;
    state.won = false;
    state.aim = { x: felt.x + felt.w * 0.75, y: felt.y + felt.h * 0.5 };
    state.turn = state.lastFrameWinner;
    if (state.turn === 'ai') {
        state.aiState = 'thinking';
        state.aiTimer = 60;
        setMessage(state, 'Ход компьютера.');
    } else {
        state.aiState = 'idle';
        setMessage(state, 'Ваш ход.');
    }
    state.aiShot = null;
}

export function resetFrame(state, felt, fullReset, W, H) {
    state.pendingFullReset = fullReset;
    if (fullReset) {
        state.score = 0;
        state.playerScore = 0;
        state.aiScore = 0;
        state.lives = 5;
        state.playerLives = 5;
        state.aiLives = 5;
        state.frame = 1;
        state.playerWins = 0;
        state.aiWins = 0;
        state.lastFrameWinner = 'player';
    }
    buildIntro(state, felt, W, H);
    state.phase = 'intro';
    state.moving = false;
    state.charging = false;
    state.power = 0;
    state.gameOver = false;
    state.won = false;
    setMessage(state, '');
}

export function setMessage(state, s) {
    state.message = s;
    const msgEl = document.getElementById('message');
    if (msgEl) msgEl.textContent = s;
}

export function onPocket(state, b) {
    if (b.isCue) {
        state.cueFouled = true;
    } else {
        state.potsThisShot++;
        if (state.turn === 'player') {
            state.playerScore += b.number * 10 * state.frame;
            state.score = state.playerScore;
        } else {
            state.aiScore += b.number * 10 * state.frame;
        }
    }
}

export function onShotEnd(state, felt, openGameOverModal) {
    const potted  = state.potsThisShot;
    const fouled  = state.cueFouled;
    const isAI    = state.turn === 'ai';
    let msg = '';

    if (fouled) {
        const cue = state.balls.find(b => b.isCue);
        cue.potted = false;
        cue.x = felt.x + felt.w * 0.25; cue.y = felt.y + felt.h * 0.5;
        cue.vx = 0; cue.vy = 0;
        state.cueFouled = false;
        if (isAI) {
            state.aiLives = Math.max(0, state.aiLives - 1);
            msg = 'Компьютер потерял биток! −1 жизнь ИИ.';
        } else {
            state.playerLives = Math.max(0, state.playerLives - 1);
            msg = 'Потерян биток! −1 жизнь.';
        }
    } else if (potted === 0) {
        if (!state.hitBall) {
            if (isAI) {
                state.aiLives = Math.max(0, state.aiLives - 1);
                msg = 'Компьютер не задел шары! −1 жизнь ИИ.';
            } else {
                state.playerLives = Math.max(0, state.playerLives - 1);
                msg = 'Не задет ни один шар! −1 жизнь.';
            }
        } else {
            msg = isAI ? 'Компьютер промахнулся.' : 'Промах.';
        }
    } else {
        if (isAI) {
            msg = `Компьютер забил: ${potted} шар(а).`;
        } else {
            msg = `Забито шаров: ${potted}.`;
        }
    }

    const remaining = state.balls.filter(b => !b.isCue && !b.potted).length;
    if (remaining === 0) {
        // Record who won this frame
        if (isAI) {
            state.aiWins++;
            state.lastFrameWinner = 'ai';
        } else {
            state.playerWins++;
            state.lastFrameWinner = 'player';
        }
        state.frame++;
        resetFrame(state, felt, false);
        updateHUD(state);
        return;
    }

    if (state.playerLives <= 0 || state.aiLives <= 0) {
        state.gameOver = true;
        state.score = state.playerScore;
        openGameOverModal();
        return;
    }

    if (potted === 0 || fouled) {
        state.turn = isAI ? 'player' : 'ai';
        if (state.turn === 'ai') {
            state.aiState = 'thinking';
            state.aiTimer = 70;
            msg += ' Ход компьютера.';
        } else {
            state.aiState = 'idle';
            msg += ' Ваш ход.';
        }
    } else {
        if (state.turn === 'ai') {
            state.aiState = 'thinking';
            state.aiTimer = 45;
        }
    }

    setMessage(state, msg);
}

export function updateHUD(state) {
    const scoreEl    = document.getElementById('score');
    const livesEl    = document.getElementById('lives');
    const frameEl    = document.getElementById('frame');
    const powerFillEl = document.getElementById('powerFill');
    const aiScoreEl  = document.getElementById('aiScore');
    const aiLivesEl  = document.getElementById('aiLives');

    if (scoreEl)    scoreEl.textContent    = String(state.playerScore).padStart(5, '0');
    if (livesEl)    livesEl.textContent    = Math.max(0, state.playerLives);
    if (frameEl)    frameEl.textContent    = String(state.frame).padStart(2, '0');
    if (powerFillEl) powerFillEl.style.width = (state.power / MAX_POWER * 100) + '%';
    if (aiScoreEl)  aiScoreEl.textContent  = String(state.aiScore).padStart(5, '0');
    if (aiLivesEl)  aiLivesEl.textContent  = Math.max(0, state.aiLives);
    
    const playerWinsEl = document.getElementById('playerWins');
    const aiWinsEl     = document.getElementById('aiWins');
    if (playerWinsEl) playerWinsEl.textContent = String(state.playerWins).padStart(2, '0');
    if (aiWinsEl)     aiWinsEl.textContent     = String(state.aiWins).padStart(2, '0');
    
    const playerBlock = document.querySelector('.player-block');
    const aiBlock = document.querySelector('.ai-block');
    if (playerBlock) playerBlock.classList.toggle('active-turn', state.turn === 'player');
    if (aiBlock) aiBlock.classList.toggle('active-turn', state.turn === 'ai');
}

export function shoot(state, felt) {
    if (state.moving || state.phase !== 'play') return;
    const cue = state.balls.find(b => b.isCue);
    if (!cue || cue.potted) return;
    const dx = state.aim.x - cue.x, dy = state.aim.y - cue.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    const p = state.power;
    cue.vx = (dx / dist) * p;
    cue.vy = (dy / dist) * p;
    state.power = 0;
    state.moving = true;
    state.potsThisShot = 0;
    state.cueFouled = false;
    state.hitBall = false;
}

export function handleInput(state, CHARGE_RATE, MAX_POWER) {
    if (state.charging && state.phase === 'play' && !state.moving && !state.won && !state.gameOver) {
        state.power += CHARGE_RATE;
        if (state.power >= MAX_POWER) state.power = state.power % MAX_POWER;
    }
}

export function updateIntro(state, fell) {
    let allArrived = true;
    for (const cb of state.cineBalls) {
        const wasArrived = cb.arrived;
        cb.stepIntro();
        if (!wasArrived && cb.arrived) {
            // soundArrival callback would go here
        }
        if (!cb.arrived) allArrived = false;
    }
    if (allArrived) {
        applyReset(state, felt, state.pendingFullReset);
        state.phase = 'play';
    }
}

export function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export function openGameOverModalPool(state) {
    const goScoreEl = document.getElementById('goScore');
    const playerNameInput = document.getElementById('playerNameInput');
    if (goScoreEl) goScoreEl.textContent = state.score;
    if (playerNameInput) playerNameInput.value = getPoolPlayerName();
    const modal = document.getElementById('gameOverModal');
    if (modal) modal.classList.add('active');
}

export function closeGameOverModalPool() {
    const modal = document.getElementById('gameOverModal');
    if (modal) modal.classList.remove('active');
}

export function openHsModalPool() {
    const modal = document.getElementById('hsModal');
    const list = document.getElementById('hsList');
    if (!modal || !list) return;
    
    modal.classList.add('active');
    list.innerHTML = '<div class="hs-loading">Загрузка...</div>';
    loadPoolHighScores().then(rows => {
        if (!rows || rows.length === 0) {
            list.innerHTML = '<div class="hs-loading">Рекордов пока нет</div>';
            return;
        }
        const medals = ['🥇','🥈','🥉'];
        list.innerHTML = rows.map((r, i) => `
            <div class="hs-item">
                <span class="hs-rank">${medals[i] || (i+1)}</span>
                <span class="hs-name">${escapeHtml(r.name)}</span>
                <span class="hs-score">${r.score.toLocaleString()}</span>
            </div>`).join('');
    });
}

export function closeHsModalPool() {
    const modal = document.getElementById('hsModal');
    if (modal) modal.classList.remove('active');
}

export function getPoolPlayerName() {
    return localStorage.getItem('poolPlayerName') || '';
}

export function setPoolPlayerName(n) {
    localStorage.setItem('poolPlayerName', n.trim());
    updatePlayerLabel();
}

export function updatePlayerLabel() {
    const lbl = document.getElementById('playerLabel');
    if (!lbl) return;
    const name = localStorage.getItem('poolPlayerName');
    lbl.textContent = name && name.trim() ? name.trim() : 'ВЫ';
}

async function loadPoolHighScores() {
    const SUPABASE_URL = 'https://hewlajcgcyaoitdethhq.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld2xhamNnY3lhb2l0ZGV0aGhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MDIyNTcsImV4cCI6MjA5MTQ3ODI1N30...';
    const TABLE_POOL = 'pool_scores';
    
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_POOL}?select=name,score&order=score.desc&limit=20`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_KEY
            }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch(e) {
        console.error('Supabase load error', e);
        return null;
    }
}

async function savePoolHighScore(name, scoreVal) {
    const SUPABASE_URL = 'https://hewlajcgcyaoitdethhq.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld2xhamNnY3lhb2l0ZGV0aGhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MDIyNTcsImV4cCI6MjA5MTQ3ODI1N30...';
    const TABLE_POOL = 'pool_scores';
    
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_POOL}`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, score: scoreVal })
        });
        if (!res.ok) return false;
        return true;
    } catch(e) {
        console.error('Supabase save error', e);
        return false;
    }
}

export function initModals(state, felt, resetFrameFn, updateHUDFn) {
    const saveNameBtn = document.getElementById('saveNameBtn');
    if (saveNameBtn) {
        saveNameBtn.addEventListener('click', () => {
            const input = document.getElementById('playerNameInput');
            const v = input ? input.value.trim() : '';
            if (v) setPoolPlayerName(v);
        });
    }

    const btnSaveScore = document.getElementById('btnSaveScore');
    if (btnSaveScore) {
        btnSaveScore.addEventListener('click', async () => {
            const input = document.getElementById('playerNameInput');
            const name = input ? input.value.trim() : 'Аноним';
            setPoolPlayerName(name);
            const btn = document.getElementById('btnSaveScore');
            if (btn) btn.textContent = '⏳ Сохраняю...';
            const ok = await savePoolHighScore(name, state.score);
            if (ok) {
                if (btn) btn.textContent = '✅ Сохранено!';
                setTimeout(() => {
                    closeGameOverModalPool();
                    resetFrameFn(true);
                    updateHUDFn();
                }, 1000);
            } else {
                if (btn) btn.textContent = '❌ Ошибка';
            }
        });
    }

    const btnRestart = document.getElementById('btnRestartAfterLose');
    if (btnRestart) {
        btnRestart.addEventListener('click', () => {
            closeGameOverModalPool();
            resetFrameFn(true);
            updateHUDFn();
        });
    }

    const hsModalClose = document.getElementById('hsModalClose');
    if (hsModalClose) hsModalClose.addEventListener('click', closeHsModalPool);
    
    const gameOverModal = document.getElementById('gameOverModal');
    if (gameOverModal) {
        gameOverModal.addEventListener('click', (e) => {
            if (e.target === gameOverModal) closeGameOverModalPool();
        });
    }
}

export function initPoolHotkeys() {
    document.addEventListener('keydown', (e) => {
        const k = e.key;
        const anyModal = () =>
            document.getElementById('hsModal')?.classList.contains('active') ||
            document.getElementById('gameOverModal')?.classList.contains('active');
        
        if (k === 't' || k === 'T' || k === 'е' || k === 'Е') {
            if (!anyModal()) openHsModalPool();
            return;
        }
        if (k === 'Escape') {
            if (document.getElementById('hsModal')?.classList.contains('active')) closeHsModalPool();
            if (document.getElementById('gameOverModal')?.classList.contains('active')) closeGameOverModalPool();
        }
    });
}
