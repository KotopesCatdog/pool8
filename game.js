// Video Pool — HTML5 remake inspired by the ZX Spectrum game.
// Top-down view, mouse-only controls, Web Audio sound effects.

(() => {
    const canvas = document.getElementById('table');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // Felt playfield bounds (the wooden rail frame lives outside).
    const F = { x: 30, y: 30, w: W - 60, h: H - 60 };
    const FX2 = F.x + F.w;
    const FY2 = F.y + F.h;

    const POCKET_R = 30;
    const POCKETS = [
        { x: F.x,           y: F.y  },
        { x: F.x + F.w / 2, y: F.y  },
        { x: FX2,           y: F.y  },
        { x: F.x,           y: FY2  },
        { x: F.x + F.w / 2, y: FY2  },
        { x: FX2,           y: FY2  },
    ];

    const BALL_R = 15;
    const FRICTION = 0.986;
    const MIN_SPEED = 0.12;
    const MAX_POWER = 25;
    const CHARGE_RATE = 0.15;

    const BALL_COLORS = [
        '#e74c3c', // 1 red
        '#3498db', // 2 blue
        '#f1c40f', // 3 yellow
        '#27ae60', // 4 green
        '#9b59b6', // 5 purple
        '#e67e22', // 6 orange
    ];

    // -----------------------------------------------------------------------
    // Ball class (gameplay)
    // -----------------------------------------------------------------------
    class Ball {
        constructor(x, y, color, number) {
            this.x = x; this.y = y;
            this.vx = 0; this.vy = 0;
            this.color = color;
            this.number = number;
            this.isCue = number === 0;
            this.potted = false;
        }
    }

    // -----------------------------------------------------------------------
    // CineBall — animated ball for intro / outro cinematics
    // -----------------------------------------------------------------------
    class CineBall {
        constructor({ x, y, tx, ty, color, number, delay, speed, exitVx, exitVy }) {
            this.x = x; this.y = y;
            this.tx = tx; this.ty = ty;
            this.color = color;
            this.number = number;
            this.isCue = number === 0;
            this.delay = delay;
            this.speed = speed || 9;
            this.arrived = false;
            this.active = false;
            this.exitVx = exitVx || 0;
            this.exitVy = exitVy || 0;
            this.gone = false;
        }

        stepIntro() {
            if (this.arrived) return;
            if (this.delay > 0) { this.delay--; return; }
            this.active = true;
            const dx = this.tx - this.x;
            const dy = this.ty - this.y;
            const d = Math.hypot(dx, dy);
            if (d <= this.speed) {
                this.x = this.tx; this.y = this.ty;
                this.arrived = true;
            } else {
                this.x += (dx / d) * this.speed;
                this.y += (dy / d) * this.speed;
            }
        }

        stepOutro() {
            if (this.gone) return;
            if (this.delay > 0) { this.delay--; return; }
            this.active = true;
            this.exitVx *= 1.045;
            this.exitVy *= 1.045;
            this.x += this.exitVx;
            this.y += this.exitVy;
            if (this.x < -100 || this.x > W + 100 || this.y < -100 || this.y > H + 100) {
                this.gone = true;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Entry patterns for numbered balls (6 slots)
    // -----------------------------------------------------------------------
    const ENTRY_PATTERNS = [
        [{ex:-60,ey:null},{ex:-60,ey:null},{ex:-60,ey:null},
         {ex:-60,ey:null},{ex:-60,ey:null},{ex:-60,ey:null}],
        [{ex:W+60,ey:null},{ex:W+60,ey:null},{ex:W+60,ey:null},
         {ex:W+60,ey:null},{ex:W+60,ey:null},{ex:W+60,ey:null}],
        [{ex:null,ey:-60},{ex:null,ey:-60},{ex:null,ey:-60},
         {ex:null,ey:-60},{ex:null,ey:-60},{ex:null,ey:-60}],
        [{ex:null,ey:H+60},{ex:null,ey:H+60},{ex:null,ey:H+60},
         {ex:null,ey:H+60},{ex:null,ey:H+60},{ex:null,ey:H+60}],
        [{ex:null,ey:-60},{ex:null,ey:H+60},{ex:null,ey:-60},
         {ex:null,ey:H+60},{ex:null,ey:-60},{ex:null,ey:H+60}],
        [{ex:-60,ey:null},{ex:W+60,ey:null},{ex:-60,ey:null},
         {ex:W+60,ey:null},{ex:-60,ey:null},{ex:W+60,ey:null}],
        [{ex:-60,ey:-60},{ex:-60,ey:-60},{ex:W+60,ey:-60},
         {ex:W+60,ey:-60},{ex:-60,ey:H+60},{ex:W+60,ey:H+60}],
        [{ex:-60,ey:-60},{ex:-60,ey:-60},{ex:-60,ey:-60},
         {ex:-60,ey:-60},{ex:-60,ey:-60},{ex:-60,ey:-60}],
        [{ex:-60,ey:null},{ex:W+60,ey:null},{ex:null,ey:-60},
         {ex:null,ey:H+60},{ex:-60,ey:H+60},{ex:W+60,ey:-60}],
        [{ex:W+60,ey:H+60},{ex:W+60,ey:H+60},{ex:W+60,ey:H+60},
         {ex:W+60,ey:H+60},{ex:W+60,ey:H+60},{ex:W+60,ey:H+60}],
    ];

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    // AI plays at maximum skill — no aim scatter.

    const state = {
        balls: [],
        aim: { x: F.x + F.w * 0.75, y: F.y + F.h * 0.5 },
        power: 0,
        charging: false,
        moving: false,
        score: 0,
        lives: 5,
        shotsLeft: 5,
        frame: 1,
        potsThisShot: 0,
        cueFouled: false,
        hitBall: false, 
        gameOver: false,
        won: false,
        message: '',
        muted: false,
        phase: 'intro',
        cineBalls: [],
        pendingFullReset: true,
        // ── turn management ──
        turn: 'player',      // 'player' | 'ai'
        aiState: 'idle',     // 'idle' | 'thinking' | 'aiming' | 'shooting'
        aiTimer: 0,          // countdown frames
        aiShot: null,        // { aimX, aimY, power } decided shot
        aiAimProgress: 0,    // 0..1 smooth aim animation
        // scores per player
        playerScore: 0,
        aiScore: 0,
        playerLives: 5,
        aiLives: 5,
        // frame wins
        playerWins: 0,
        aiWins: 0,
        // who won the last frame (starts next frame)
        lastFrameWinner: 'player',
    };

    function setMessage(s) {
        state.message = s;
        const msgEl = document.getElementById('message');
        if (msgEl) msgEl.textContent = s;
    }

    // -----------------------------------------------------------------------
    // Rack positions
    // -----------------------------------------------------------------------
    function rackBalls() {
        const ox = F.x + F.w * 0.7;
        const oy = F.y + F.h * 0.5;
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

    // -----------------------------------------------------------------------
    // Build intro cinematic
    // -----------------------------------------------------------------------
    function buildIntro() {
        state.cineBalls = [];
        const rack = rackBalls();
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
        const cueX = F.x + F.w * 0.25;
        const cueY = F.y + F.h * 0.5;
        state.cineBalls.push(new CineBall({
            x: -60, y: cueY,
            tx: cueX, ty: cueY,
            color: '#ffffff', number: 0,
            delay: cueDelay, speed: BALL_SPEED,
        }));
    }

    // -----------------------------------------------------------------------
    // applyReset — applies gameplay state after intro finishes
    // -----------------------------------------------------------------------
    function applyReset(fullReset) {
        state.balls = [];
        const rack = rackBalls();
        state.balls.push(new Ball(F.x + F.w * 0.25, F.y + F.h * 0.5, '#ffffff', 0));
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
        state.aim = { x: F.x + F.w * 0.75, y: F.y + F.h * 0.5 };
        // Frame starts with whoever won the previous frame
        state.turn = state.lastFrameWinner;
        if (state.turn === 'ai') {
            state.aiState = 'thinking';
            state.aiTimer = 60;
            setMessage('Ход компьютера.');
        } else {
            state.aiState = 'idle';
            setMessage('Ваш ход.');
        }
        state.aiShot = null;
    }

    // -----------------------------------------------------------------------
    // resetFrame — public function to reset the game
    // -----------------------------------------------------------------------
    function resetFrame(fullReset) {
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
        buildIntro();
        state.phase = 'intro';
        state.moving = false;
        state.charging = false;
        state.power = 0;
        state.gameOver = false;
        state.won = false;
        setMessage('');
    }

    // -----------------------------------------------------------------------
    // Audio
    // -----------------------------------------------------------------------
    let audioCtx = null;
    let noiseBuffer = null;

    function initAudio() {
        if (audioCtx) return;
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        audioCtx = new Ctor();
        const sr = audioCtx.sampleRate;
        const len = Math.floor(sr * 0.5);
        noiseBuffer = audioCtx.createBuffer(1, len, sr);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }

    function resumeAudio() {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    }

    function playTone({ freq = 440, endFreq, duration = 0.1, type = 'sine', gain = 0.2, attack = 0.002 }) {
        if (!audioCtx || state.muted) return;
        const now = audioCtx.currentTime;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, now);
        if (endFreq !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(gain, now + attack);
        g.gain.exponentialRampToValueAtTime(0.0005, now + duration);
        o.connect(g).connect(audioCtx.destination);
        o.start(now); o.stop(now + duration + 0.02);
    }

    function playNoise({ duration = 0.08, gain = 0.2, filterFreq = 2000, filterType = 'bandpass', q = 2, attack = 0.002 }) {
        if (!audioCtx || state.muted) return;
        const now = audioCtx.currentTime;
        const src = audioCtx.createBufferSource();
        src.buffer = noiseBuffer;
        const filt = audioCtx.createBiquadFilter();
        filt.type = filterType;
        filt.frequency.value = filterFreq;
        filt.Q.value = q;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(gain, now + attack);
        g.gain.exponentialRampToValueAtTime(0.0005, now + duration);
        src.connect(filt).connect(g).connect(audioCtx.destination);
        src.start(now); src.stop(now + duration + 0.02);
    }

    function soundBallHit(speed) {
        const s = Math.min(1, speed / 18);
        const freq = 900 + s * 600;
        playTone({ freq, endFreq: freq * 0.55, duration: 0.07, type: 'triangle', gain: 0.08 + s * 0.18 });
        playNoise({ duration: 0.04, filterFreq: 3500, q: 4, gain: 0.05 + s * 0.12 });
    }
    function soundWall(speed) {
        const s = Math.min(1, speed / 14);
        playTone({ freq: 180 + s * 80, endFreq: 90, duration: 0.09, type: 'sine', gain: 0.05 + s * 0.14 });
        playNoise({ duration: 0.06, filterFreq: 400, filterType: 'lowpass', q: 1, gain: 0.03 + s * 0.08 });
    }
    function soundPocket() {
        playTone({ freq: 520, endFreq: 110, duration: 0.38, type: 'sine', gain: 0.22 });
        playNoise({ duration: 0.22, filterFreq: 300, filterType: 'lowpass', q: 1, gain: 0.08 });
    }
    function soundCueFoul() {
        if (!audioCtx || state.muted) return;
        // "ту - тууууу": short high note, then longer low note dropping further
        const now = audioCtx.currentTime;
        // First note: "ту" — short, starts at 420 Hz drops to 260
        const o1 = audioCtx.createOscillator();
        const g1 = audioCtx.createGain();
        o1.type = 'sine';
        o1.frequency.setValueAtTime(420, now);
        o1.frequency.exponentialRampToValueAtTime(260, now + 0.22);
        g1.gain.setValueAtTime(0, now);
        g1.gain.linearRampToValueAtTime(0.28, now + 0.015);
        g1.gain.exponentialRampToValueAtTime(0.0005, now + 0.22);
        o1.connect(g1).connect(audioCtx.destination);
        o1.start(now); o1.stop(now + 0.23);
        // Gap ~0.10s, then second note: "тууууу" — longer, starts at 300 drops to 90
        const o2 = audioCtx.createOscillator();
        const g2 = audioCtx.createGain();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(300, now + 0.32);
        o2.frequency.exponentialRampToValueAtTime(90, now + 1.1);
        g2.gain.setValueAtTime(0, now + 0.32);
        g2.gain.linearRampToValueAtTime(0.30, now + 0.345);
        g2.gain.exponentialRampToValueAtTime(0.0005, now + 1.1);
        o2.connect(g2).connect(audioCtx.destination);
        o2.start(now + 0.32); o2.stop(now + 1.12);
    }
    function soundShot(power) {
        const s = Math.min(1, power / MAX_POWER);
        playNoise({ duration: 0.05, filterFreq: 1800, q: 2.5, gain: 0.08 + s * 0.18 });
        playTone({ freq: 1200 + s * 300, endFreq: 400, duration: 0.06, type: 'triangle', gain: 0.04 + s * 0.1 });
    }
    function soundCharge() {
        playTone({ freq: 320, duration: 0.04, type: 'square', gain: 0.05 });
    }
    function soundArrival() {
        playTone({ freq: 260, endFreq: 160, duration: 0.06, type: 'triangle', gain: 0.07 });
        playNoise({ duration: 0.03, filterFreq: 800, q: 3, gain: 0.04 });
    }

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    function stepBalls() {
        for (const b of state.balls) {
            if (b.potted) continue;
            b.x += b.vx; b.y += b.vy;
            b.vx *= FRICTION; b.vy *= FRICTION;
            if (Math.hypot(b.vx, b.vy) < MIN_SPEED) { b.vx = 0; b.vy = 0; }
        }
    }

    function collideBalls(a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist >= 2 * BALL_R) return;

        // Sub-step: back up the faster-moving ball to the exact moment of contact
        // so the collision normal is geometrically precise (fixes trajectory mismatch
        // on thin cuts where overshoot reaches 12+ degrees).
        const spdA = Math.hypot(a.vx, a.vy);
        const spdB = Math.hypot(b.vx, b.vy);
        if (spdA > 0 || spdB > 0) {
            let lo = 0, hi = 1;
            for (let i = 0; i < 12; i++) {
                const mid = (lo + hi) / 2;
                const tx = (a.x - a.vx * mid) - (b.x - b.vx * mid);
                const ty = (a.y - a.vy * mid) - (b.y - b.vy * mid);
                (Math.hypot(tx, ty) < 2 * BALL_R) ? (lo = mid) : (hi = mid);
            }
            a.x -= a.vx * lo; a.y -= a.vy * lo;
            b.x -= b.vx * lo; b.y -= b.vy * lo;
        }

        const dx2 = b.x - a.x, dy2 = b.y - a.y;
        const dist2 = Math.hypot(dx2, dy2) || 1;
        const nx = dx2 / dist2, ny = dy2 / dist2;

        // Push apart to remove any residual overlap
        const overlap = 2 * BALL_R - dist2;
        if (overlap > 0) {
            a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
            b.x += nx * overlap / 2; b.y += ny * overlap / 2;
        }

        const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
        const vn = dvx * nx + dvy * ny;
        if (vn <= 0) return;
        a.vx -= vn * nx; a.vy -= vn * ny;
        b.vx += vn * nx; b.vy += vn * ny;
        soundBallHit(Math.abs(vn));
        if (a.isCue || b.isCue) state.hitBall = true; 
    }

    function nearPocket(b) {
        for (const p of POCKETS)
            if (Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R + BALL_R * 0.5) return true;
        return false;
    }

    function wallCollide(b) {
        if (nearPocket(b)) return;
        const e = 0.88; let bounced = false, speed = 0;
        if (b.x - BALL_R < F.x)  { b.x = F.x  + BALL_R; speed = Math.abs(b.vx); b.vx = -b.vx * e; bounced = true; }
        if (b.x + BALL_R > FX2)  { b.x = FX2  - BALL_R; speed = Math.abs(b.vx); b.vx = -b.vx * e; bounced = true; }
        if (b.y - BALL_R < F.y)  { b.y = F.y  + BALL_R; speed = Math.abs(b.vy); b.vy = -b.vy * e; bounced = true; }
        if (b.y + BALL_R > FY2)  { b.y = FY2  - BALL_R; speed = Math.abs(b.vy); b.vy = -b.vy * e; bounced = true; }
        if (bounced && speed > 0.6) soundWall(speed);
    }

    function checkPocket(b) {
        for (const p of POCKETS) {
            if (Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R) {
                b.potted = true; b.vx = 0; b.vy = 0; return true;
            }
        }
        return false;
    }

    function onPocket(b) {
        if (b.isCue) {
            soundCueFoul();
            state.cueFouled = true;
        } else {
            soundPocket();
            state.potsThisShot++;
            if (state.turn === 'player') {
    state.playerScore += b.number * 10 * state.frame;
    state.score = state.playerScore;
} else {
    state.aiScore += b.number * 10 * state.frame;
}
        }
    }

    function update() {
        stepBalls();
        for (let i = 0; i < state.balls.length; i++)
            for (let j = i + 1; j < state.balls.length; j++) {
                const a = state.balls[i], b = state.balls[j];
                if (a.potted || b.potted) continue;
                collideBalls(a, b);
            }
        for (const b of state.balls) if (!b.potted) wallCollide(b);
        for (const b of state.balls) if (!b.potted && checkPocket(b)) onPocket(b);
        const moving = state.balls.some(b => !b.potted && (b.vx !== 0 || b.vy !== 0));
        if (state.moving && !moving) { state.moving = false; onShotEnd(); }
    }

    function onShotEnd() {
        const potted  = state.potsThisShot;
        const fouled  = state.cueFouled;
        const isAI    = state.turn === 'ai';
        let msg = '';

        if (fouled) {
            const cue = state.balls.find(b => b.isCue);
            cue.potted = false;
            cue.x = F.x + F.w * 0.25; cue.y = F.y + F.h * 0.5;
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
             //   state.aiScore += potted * 10 * state.frame;
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
            resetFrame(false);
            updateHUD();
            return;
        }

        if (state.playerLives <= 0 || state.aiLives <= 0) {
            state.gameOver = true;
            state.score = state.playerScore;
            openGameOverModalPool();
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

        setMessage(msg);
    }

    // -----------------------------------------------------------------------
    // AI Engine
    // -----------------------------------------------------------------------

    // Check if the path from (x1,y1) to (x2,y2) is clear of all balls except
    // the cue and the target ball itself.
    // Check if segment (x1,y1)→(x2,y2) is free of balls (excluding two).
    // Uses BALL_R*2 clearance — the width a cue ball needs to pass through.
    function pathClear(x1, y1, x2, y2, excludeA, excludeB) {
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len === 0) return true;
        const nx = dx / len, ny = dy / len;
        for (const b of state.balls) {
            if (b.potted || b === excludeA || b === excludeB) continue;
            const tx = b.x - x1, ty = b.y - y1;
            const proj = tx * nx + ty * ny;
            // Only check obstacles that lie along the segment (with small margin)
            if (proj < -BALL_R || proj > len + BALL_R) continue;
            const clampedProj = Math.max(0, Math.min(len, proj));
            const closestX = x1 + nx * clampedProj;
            const closestY = y1 + ny * clampedProj;
            if (Math.hypot(b.x - closestX, b.y - closestY) < BALL_R * 2 - 1) return false;
        }
        return true;
    }

    // Predict where the cue ball ends up after striking the ghost position.
    // After elastic collision with equal masses, cue deflects along the tangent.
    // Returns predicted {x, y} after travelling ~travelDist pixels.
    function predictCuePos(cue, ghostX, ghostY, travelDist) {
        const aimDx = ghostX - cue.x, aimDy = ghostY - cue.y;
        const aimLen = Math.hypot(aimDx, aimDy);
        if (aimLen < 1) return { x: cue.x, y: cue.y };
        const ax = aimDx / aimLen, ay = aimDy / aimLen;   // unit aim vector
        // Normal (ball→ghost direction, reversed = ghost→ball = n of collision)
        // After collision cue velocity = original - vn*n  (vn = dot(v,n))
        // Since speed=1 unit: cue_after = a - dot(a,n)*n  (tangential component)
        // n points from ghost to target ball centre, i.e. opposite of aim-to-ghost
        // But ghost IS the contact point — n = (ball-ghost)/|ball-ghost|
        // At contact: ball-ghost direction = bpN (ball→pocket direction)
        // So n = bpN, and cue tangential = a - dot(a,n)*n
        // We don't have bpN here but: ghost = ball - bpN*2R → bpN = (ball-ghost)/2R
        // We pass ghostX/ghostY and know ball pos from caller, so approximate:
        // just use the perpendicular to aim as the cue's deflection direction
        // (exact for head-on; approximate for cuts — good enough for scoring)
        // Perpendicular to aim (choose sign so cue goes "off to the side")
        const tx = -ay, ty = ax;   // one perpendicular; direction depends on cut
        // The cue travels the tangential fraction of its original speed
        // For scoring we just want approximate exit direction — use both sides
        // and pick the one away from the pocket (safety heuristic)
        let px = ghostX + tx * travelDist;
        let py = ghostY + ty * travelDist;
        // Clamp to felt
        px = Math.max(F.x + BALL_R, Math.min(FX2 - BALL_R, px));
        py = Math.max(F.y + BALL_R, Math.min(FY2 - BALL_R, py));
        return { x: px, y: py };
    }

    // Count how many direct (ghost-ball) shots exist from position (px,py).
    function countShotsFrom(px, py, excludeBall) {
        let count = 0;
        for (const b of state.balls) {
            if (b.potted || b.isCue || b === excludeBall) continue;
            for (const p of POCKETS) {
                const dx = p.x - b.x, dy = p.y - b.y;
                const len = Math.hypot(dx, dy);
                if (len === 0) continue;
                const gx = b.x - (dx / len) * BALL_R * 2;
                const gy = b.y - (dy / len) * BALL_R * 2;
                if (gx < F.x + BALL_R || gx > FX2 - BALL_R) continue;
                if (gy < F.y + BALL_R || gy > FY2 - BALL_R) continue;
                // Use a temporary cue object for pathClear
                const fakeCue = { x: px, y: py, potted: false, isCue: true };
                if (pathClear(px, py, gx, gy, fakeCue, b) &&
                    pathClear(b.x, b.y, p.x, p.y, fakeCue, b)) {
                    count++;
                }
            }
        }
        return count;
    }

    // Score a candidate shot. Higher = better.
    function scoreShot(cue, ball, pocket, ghostX, ghostY, bpLen) {
        let s = 0;

        // 1. Prefer valuable balls
        s += ball.number * 8;

        // 2. Prefer shorter ball-to-pocket distance (easier pot)
        s -= bpLen * 0.04;

        // 3. Prefer shorter cue-to-ghost distance (easier to reach)
        const cueDist = Math.hypot(ghostX - cue.x, ghostY - cue.y);
        s -= cueDist * 0.025;

        // 4. Prefer more head-on shots (fuller contact = more predictable)
        const aimDx = ghostX - cue.x, aimDy = ghostY - cue.y;
        const aimLen = Math.hypot(aimDx, aimDy);
        if (aimLen > 0) {
            // nX/nY: direction from ghost to ball (= collision normal direction)
            const nX = ball.x - ghostX, nY = ball.y - ghostY;
            const nLen = Math.hypot(nX, nY);
            if (nLen > 0) {
                const dot = (aimDx / aimLen) * (nX / nLen) + (aimDy / aimLen) * (nY / nLen);
                // dot=1 head-on, dot→0 thin cut. Reward fuller contact.
                s += dot * 25;
            }
        }

        // 5. Positional bonus (hard difficulty only): reward shots that leave
        //    the cue ball near more follow-up opportunities.
        if (aimLen > 0) {
            const pred = predictCuePos(cue, ghostX, ghostY, 100);
            // Check cue won't scratch (land near a pocket)
            let scratch = false;
            for (const p of POCKETS) {
                if (Math.hypot(pred.x - p.x, pred.y - p.y) < POCKET_R * 2) {
                    scratch = true; break;
                }
            }
            if (scratch) {
                s -= 35;
            } else {
                const nextOpts = countShotsFrom(pred.x, pred.y, ball);
                s += Math.min(nextOpts * 4, 20);
            }
        }

        return s;
    }

    // Find the best shot for the AI. Returns { aimX, aimY, power } or null.
    function aiFindBestShot() {
        const cue = state.balls.find(b => b.isCue && !b.potted);
        if (!cue) return null;

        let best = null, bestScore = -Infinity;

        for (const ball of state.balls) {
            if (ball.isCue || ball.potted) continue;

            for (const pocket of POCKETS) {
                // Vector from ball to pocket
                const bpDx = pocket.x - ball.x, bpDy = pocket.y - ball.y;
                const bpLen = Math.hypot(bpDx, bpDy);
                if (bpLen < 1) continue;
                const bpNx = bpDx / bpLen, bpNy = bpDy / bpLen;

                // Ghost ball: where cue centre must be to pot this ball in this pocket
                const ghostX = ball.x - bpNx * BALL_R * 2;
                const ghostY = ball.y - bpNy * BALL_R * 2;

                // Ghost must be inside the felt (with full ball margin)
                if (ghostX < F.x + BALL_R || ghostX > FX2 - BALL_R) continue;
                if (ghostY < F.y + BALL_R || ghostY > FY2 - BALL_R) continue;

                // Path cue→ghost must be clear of other balls
                if (!pathClear(cue.x, cue.y, ghostX, ghostY, cue, ball)) continue;

                // Path ball→pocket must be clear of other balls
                if (!pathClear(ball.x, ball.y, pocket.x, pocket.y, cue, ball)) continue;

                const sc = scoreShot(cue, ball, pocket, ghostX, ghostY, bpLen);
                if (sc > bestScore) {
                    bestScore = sc;
                    const cueDist = Math.hypot(ghostX - cue.x, ghostY - cue.y);
                    // Power: enough to reach ghost AND send ball to pocket
                    const power = Math.min(MAX_POWER, Math.max(5, (cueDist + bpLen) * 0.055));
                    best = { aimX: ghostX, aimY: ghostY, power, ball, pocket };
                }
            }
        }

        // Fallback: no pottable shot found — nudge the nearest ball to open up the rack
        if (!best) {
            let nearestDist = Infinity, nearest = null;
            for (const b of state.balls) {
                if (b.isCue || b.potted) continue;
                const d = Math.hypot(b.x - cue.x, b.y - cue.y);
                if (d < nearestDist) { nearestDist = d; nearest = b; }
            }
            if (nearest) {
                const power = Math.min(MAX_POWER, Math.max(7, nearestDist * 0.06));
                best = { aimX: nearest.x, aimY: nearest.y, power, ball: nearest, pocket: null };
            }
        }

        if (!best) return null;



        return best;
    }

    // Update AI state machine each frame
    function updateAI() {
        if (state.turn !== 'ai' || state.moving || state.phase !== 'play') return;
        if (state.gameOver || state.won) return;

        if (state.aiState === 'thinking') {
            state.aiTimer--;
            if (state.aiTimer <= 0) {
                const shot = aiFindBestShot();
                if (!shot) {
                    // No shot found — pass turn
                    state.turn = 'player';
                    state.aiState = 'idle';
                    setMessage('Компьютер не нашёл удара. Ваш ход.');
                    return;
                }
                state.aiShot = shot;
                state.aiState = 'aiming';
                state.aiAimProgress = 0;
                // Set aim to current cue position first (will animate)
                const cue = state.balls.find(b => b.isCue && !b.potted);
                if (cue) state.aim = { x: cue.x, y: cue.y };
            }
        } else if (state.aiState === 'aiming') {
            // Smoothly animate aim toward target over ~40 frames
            state.aiAimProgress = Math.min(1, state.aiAimProgress + 0.035);
            const shot = state.aiShot;
            const cue = state.balls.find(b => b.isCue && !b.potted);
            if (!cue) return;
            // Ease-in-out interpolation
            const t = state.aiAimProgress < 0.5
                ? 2 * state.aiAimProgress * state.aiAimProgress
                : 1 - Math.pow(-2 * state.aiAimProgress + 2, 2) / 2;
            state.aim = {
                x: cue.x + (shot.aimX - cue.x) * t,
                y: cue.y + (shot.aimY - cue.y) * t,
            };
            // Build up power visually
            state.power = shot.power * t;
            if (state.aiAimProgress >= 1) {
                state.aiState = 'shooting';
                state.aiTimer = 8; // tiny pause before firing
            }
        } else if (state.aiState === 'shooting') {
            state.aiTimer--;
            if (state.aiTimer <= 0) {
                state.aiState = 'idle';
                const shot = state.aiShot;
                state.aim = { x: shot.aimX, y: shot.aimY };
                state.power = shot.power;
                shoot();
            }
        }
    }

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    function shoot() {
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
        soundShot(p);
    }

    function handleInput() {
        if (state.charging && state.phase === 'play' && !state.moving && !state.won && !state.gameOver) {
            state.power += CHARGE_RATE;
            if (state.power >= MAX_POWER) state.power = state.power % MAX_POWER;
        }
    }

    // -----------------------------------------------------------------------
    // Cinematic updates
    // -----------------------------------------------------------------------
    function updateIntro() {
        let allArrived = true;
        for (const cb of state.cineBalls) {
            const wasArrived = cb.arrived;
            cb.stepIntro();
            if (!wasArrived && cb.arrived) soundArrival();
            if (!cb.arrived) allArrived = false;
        }
        if (allArrived) {
            applyReset(state.pendingFullReset);
            state.phase = 'play';
        }
    }

    // -----------------------------------------------------------------------
    // Rendering helpers
    // -----------------------------------------------------------------------
    function shade(hex, pct) {
        const n = parseInt(hex.slice(1), 16);
        let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        r = Math.max(0, Math.min(255, r + 255 * pct));
        g = Math.max(0, Math.min(255, g + 255 * pct));
        b = Math.max(0, Math.min(255, b + 255 * pct));
        return `rgb(${r|0},${g|0},${b|0})`;
    }

    function drawRailsAndFelt() {
        const rail = ctx.createLinearGradient(0, 0, 0, H);
        rail.addColorStop(0, '#5a2e10');
        rail.addColorStop(1, '#2c1506');
        ctx.fillStyle = rail;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#7a4220';
        ctx.lineWidth = 2;
        ctx.strokeRect(16, 16, W - 32, H - 32);

        const grad = ctx.createRadialGradient(W/2, H/2, 40, W/2, H/2, Math.max(W, H) / 1.1);
        grad.addColorStop(0, '#0e7d43');
        grad.addColorStop(1, '#063d20');
        ctx.fillStyle = grad;
        ctx.fillRect(F.x, F.y, F.w, F.h);

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(F.x + F.w * 0.25, F.y);
        ctx.lineTo(F.x + F.w * 0.25, FY2);
        ctx.stroke();

        for (const p of POCKETS) {
            const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, POCKET_R);
            g.addColorStop(0, '#000'); g.addColorStop(1, '#0a0a0a');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
        }
    }

    function drawBallAt(x, y, color, number, isCue) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.arc(x + 2, y + 3, BALL_R, 0, Math.PI * 2); ctx.fill();

        const g = ctx.createRadialGradient(x - 4, y - 5, 1, x, y, BALL_R);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.25, color);
        g.addColorStop(1, shade(color, -0.4));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, BALL_R, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.ellipse(x - 4, y - 5, BALL_R * 0.35, BALL_R * 0.22, -Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();

        if (!isCue) {
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(x, y + 1, 6.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.font = 'bold 11px system-ui, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(number), x, y + 1.5);
        }
    }

    function drawBall(b) {
        drawBallAt(b.x, b.y, b.color, b.number, b.isCue);
    }

    function drawAim() {
        if (state.moving || state.phase !== 'play' || state.won || state.gameOver) return;
        const cue = state.balls.find(b => b.isCue && !b.potted);
        if (!cue) return;
        const dx = state.aim.x - cue.x, dy = state.aim.y - cue.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return;
        const nx = dx / dist, ny = dy / dist;

        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.setLineDash([6, 5]); ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cue.x + nx * BALL_R, cue.y + ny * BALL_R);
        ctx.lineTo(state.aim.x + nx * 40, state.aim.y + ny * 40);
        ctx.stroke(); ctx.setLineDash([]);

        const pull = 14 + state.power * 3.0;
        const s1 = { x: cue.x - nx * (BALL_R + pull),       y: cue.y - ny * (BALL_R + pull) };
        const s2 = { x: cue.x - nx * (BALL_R + pull + 120), y: cue.y - ny * (BALL_R + pull + 120) };

        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s1.x+2, s1.y+3); ctx.lineTo(s2.x+2, s2.y+3); ctx.stroke();

        const stickGrad = ctx.createLinearGradient(s1.x, s1.y, s2.x, s2.y);
        stickGrad.addColorStop(0, '#f3d597');
        stickGrad.addColorStop(0.5, '#b58048');
        stickGrad.addColorStop(1, '#4a2a10');
        ctx.strokeStyle = stickGrad; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();

        ctx.strokeStyle = '#2a6bb0'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s1.x - nx*4, s1.y - ny*4); ctx.stroke();
        ctx.lineCap = 'butt';

        ctx.save();
        ctx.strokeStyle = '#f1c40f'; ctx.fillStyle = 'rgba(241,196,15,0.15)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(state.aim.x, state.aim.y, 7, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(state.aim.x-10, state.aim.y); ctx.lineTo(state.aim.x-4, state.aim.y);
        ctx.moveTo(state.aim.x+4, state.aim.y);  ctx.lineTo(state.aim.x+10, state.aim.y);
        ctx.moveTo(state.aim.x, state.aim.y-10); ctx.lineTo(state.aim.x, state.aim.y-4);
        ctx.moveTo(state.aim.x, state.aim.y+4);  ctx.lineTo(state.aim.x, state.aim.y+10);
        ctx.stroke(); ctx.restore();
    }

    function drawTargetBallTrajectory() {
        if (state.moving || state.phase !== 'play' || state.won || state.gameOver) return;
        const cue = state.balls.find(b => b.isCue && !b.potted);
        if (!cue) return;
        const aimX = state.aim.x - cue.x, aimY = state.aim.y - cue.y;
        const aimLen = Math.hypot(aimX, aimY);
        if (aimLen === 0) return;
        const aimDirX = aimX / aimLen, aimDirY = aimY / aimLen;

        let targetBall = null, minGhostDist = Infinity, ghostX = 0, ghostY = 0;
        for (const ball of state.balls) {
            if (ball.isCue || ball.potted) continue;
            const toBallX = ball.x - cue.x, toBallY = ball.y - cue.y;
            const proj = toBallX * aimDirX + toBallY * aimDirY;
            if (proj <= 0) continue;
            const perpX = toBallX - proj * aimDirX, perpY = toBallY - proj * aimDirY;
            const perpDist = Math.hypot(perpX, perpY);
            const hitDiam = 2 * BALL_R;
            if (perpDist >= hitDiam) continue;
            const distAlongAim = proj - Math.sqrt(hitDiam*hitDiam - perpDist*perpDist);
            if (distAlongAim < 0) continue;
            if (distAlongAim < minGhostDist) {
                minGhostDist = distAlongAim;
                targetBall = ball;
                ghostX = cue.x + aimDirX * distAlongAim;
                ghostY = cue.y + aimDirY * distAlongAim;
            }
        }
        if (!targetBall) return;

        const nX = targetBall.x - ghostX, nY = targetBall.y - ghostY;
        const nLen = Math.hypot(nX, nY);
        if (nLen === 0) return;
        const finalDirX = nX / nLen, finalDirY = nY / nLen;

        ctx.save();
        ctx.globalAlpha = 0.35; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ghostX, ghostY, BALL_R, 0, Math.PI*2); ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.setLineDash([8, 6]); ctx.lineWidth = 1.8; ctx.strokeStyle = 'rgba(255,220,100,0.85)';
        ctx.beginPath();
        let x = targetBall.x + finalDirX * (BALL_R + 2);
        let y = targetBall.y + finalDirY * (BALL_R + 2);
        ctx.moveTo(x, y);
        let vx = finalDirX * 7, vy = finalDirY * 7;
        for (let i = 0; i < 45; i++) {
            let newX = x + vx, newY = y + vy, bounced = false;
            if (newX - BALL_R < F.x)  { newX = F.x  + BALL_R; vx = -vx*0.94; bounced = true; }
            if (newX + BALL_R > FX2)  { newX = FX2  - BALL_R; vx = -vx*0.94; bounced = true; }
            if (newY - BALL_R < F.y)  { newY = F.y  + BALL_R; vy = -vy*0.94; bounced = true; }
            if (newY + BALL_R > FY2)  { newY = FY2  - BALL_R; vy = -vy*0.94; bounced = true; }
            ctx.lineTo(newX, newY); x = newX; y = newY;
            if (Math.abs(vx) < 0.4 && Math.abs(vy) < 0.4) break;
            if (!bounced) { vx *= 0.995; vy *= 0.995; }
        }
        ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    }

    function drawCineBalls() {
        for (const cb of state.cineBalls) {
            if (cb.gone) continue;
            if (!cb.active && !cb.arrived) continue;
            drawBallAt(cb.x, cb.y, cb.color, cb.number, cb.isCue);
        }
    }

    function drawCineOverlay() {
        if (state.phase !== 'intro') return;

        const stripH = 60;
        const grd = ctx.createLinearGradient(0, F.y, 0, F.y + stripH);
        grd.addColorStop(0, 'rgba(0,0,0,0.6)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(F.x, F.y, F.w, stripH);

        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#f1c40f';
        ctx.font = 'bold 24px system-ui, sans-serif';
        ctx.fillText(`ФРЕЙМ  ${state.frame}`, W / 2, F.y + 21);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillText('Шары занимают позиции…', W / 2, F.y + 42);
        ctx.restore();
    }

    function drawAIAimLine() {
        if (state.aiState !== 'aiming' && state.aiState !== 'shooting') return;
        const cue = state.balls.find(b => b.isCue && !b.potted);
        if (!cue) return;
        // Draw a subtle red aim line to show AI is thinking/aiming
        const dx = state.aim.x - cue.x, dy = state.aim.y - cue.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const nx = dx / len, ny = dy / len;
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = '#e74c3c';
        ctx.setLineDash([5, 6]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cue.x + nx * BALL_R, cue.y + ny * BALL_R);
        ctx.lineTo(state.aim.x + nx * 60, state.aim.y + ny * 60);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        drawRailsAndFelt();

        if (state.phase === 'play') {
            for (const b of state.balls) if (!b.potted) drawBall(b);
            drawAim();
            if (state.turn === 'player') drawTargetBallTrajectory();
            else drawAIAimLine();
        } else {
            drawCineBalls();
            drawCineOverlay();
        }
    }

    function updateHUD() {
        const scoreEl    = document.getElementById('score');
        const livesEl    = document.getElementById('lives');
        const frameEl    = document.getElementById('frame');
        const powerFillEl = document.getElementById('powerFill');
        const aiScoreEl  = document.getElementById('aiScore');
        const aiLivesEl  = document.getElementById('aiLives');
        const turnEl     = document.getElementById('turnIndicator');

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

    // -----------------------------------------------------------------------
    // Input
    // -----------------------------------------------------------------------
    function canvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (W / rect.width),
            y: (e.clientY - rect.top)  * (H / rect.height),
        };
    }
    function clampToFelt(p) {
        return {
            x: Math.max(F.x, Math.min(FX2, p.x)),
            y: Math.max(F.y, Math.min(FY2, p.y)),
        };
    }

    canvas.addEventListener('mousemove', (e) => { if (state.turn !== 'ai') state.aim = clampToFelt(canvasCoords(e)); });

    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        initAudio(); resumeAudio();
        if (state.turn === 'ai') return;   // block input during AI turn
        if (state.moving || state.phase !== 'play' || state.won || state.gameOver) return;
        state.aim = clampToFelt(canvasCoords(e));
        state.charging = true;
        soundCharge();
    });

    const onRelease = () => {
        if (state.charging) { state.charging = false; shoot(); }
    };
    canvas.addEventListener('mouseup', onRelease);
    window.addEventListener('mouseup', onRelease);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            initAudio(); resumeAudio();
            resetFrame(true);
            updateHUD();
        });
    }

    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            state.muted = !state.muted;
            muteBtn.textContent = state.muted ? '🔇' : '🔊';
            initAudio(); resumeAudio();
        });
    }

    // -----------------------------------------------------------------------
    // SUPABASE (новая таблица pool_scores)
    // -----------------------------------------------------------------------
    const SUPABASE_URL = 'https://hewlajcgcyaoitdethhq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhld2xhamNnY3lhb2l0ZGV0aGhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MDIyNTcsImV4cCI6MjA5MTQ3ODI1N30.-OYgXzzjUXJA2Bc95CZVpKCErZED6HMNdEFwZpslbD4';
const TABLE_POOL = 'pool_scores';

    async function sbFetchPool(path, opts = {}) {
        const headers = {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            ...(opts.headers || {})
        };
        const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, { ...opts, headers });
        if (!res.ok) {
            const txt = await res.text();
            console.error('Supabase error:', res.status, txt);
            throw new Error(txt);
        }
        const txt = await res.text();
        return txt ? JSON.parse(txt) : null;
    }

    async function loadPoolHighScores() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_POOL}?select=name,score&order=score.desc&limit=20`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_KEY
            }
        });
        
        if (!res.ok) {
            console.error('Load error:', res.status);
            return null;
        }
        
        return await res.json();
    } catch(e) {
        console.error('Supabase load error', e);
        return null;
    }
}

    async function savePoolHighScore(name, scoreVal) {
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
        
        if (!res.ok) {
            const txt = await res.text();
            console.error('Save error:', res.status, txt);
            return false;
        }
        return true;
    } catch(e) {
        console.error('Supabase save error', e);
        return false;
    }
}

    function getPoolPlayerName() {
        return localStorage.getItem('poolPlayerName') || '';
    }
    function setPoolPlayerName(n) {
        localStorage.setItem('poolPlayerName', n.trim());
        updatePlayerLabel();
    }

        // -----------------------------------------------------------------------
    // МОДАЛЬНЫЕ ОКНА
    // -----------------------------------------------------------------------
    function openGameOverModalPool() {
        const goScoreEl = document.getElementById('goScore');
        const playerNameInput = document.getElementById('playerNameInput');
        if (goScoreEl) goScoreEl.textContent = state.score;
        if (playerNameInput) playerNameInput.value = getPoolPlayerName();
        const modal = document.getElementById('gameOverModal');
        if (modal) modal.classList.add('active');
    }
    
    function closeGameOverModalPool() {
        const modal = document.getElementById('gameOverModal');
        if (modal) modal.classList.remove('active');
    }

    function openWinModal() {
        const winScoreEl = document.getElementById('winScore');
        if (winScoreEl) winScoreEl.textContent = state.score;
        const modal = document.getElementById('winModal');
        if (modal) modal.classList.add('active');
    }
    
    function closeWinModal() {
        const modal = document.getElementById('winModal');
        if (modal) modal.classList.remove('active');
    }

    async function openHsModalPool() {
        const modal = document.getElementById('hsModal');
        const list = document.getElementById('hsList');
        if (!modal || !list) return;
        
        modal.classList.add('active');
        list.innerHTML = '<div class="hs-loading">Загрузка...</div>';
        const rows = await loadPoolHighScores();
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
    }
    
    function closeHsModalPool() {
        const modal = document.getElementById('hsModal');
        if (modal) modal.classList.remove('active');
    }

    function escapeHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // -----------------------------------------------------------------------
    // ПОДКЛЮЧЕНИЕ СОБЫТИЙ МОДАЛЬНЫХ ОКОН (с проверкой наличия элементов)
    // -----------------------------------------------------------------------
    function updatePlayerLabel() {
        const lbl = document.getElementById('playerLabel');
        if (!lbl) return;
        const name = localStorage.getItem('poolPlayerName');
        lbl.textContent = name && name.trim() ? name.trim() : 'ВЫ';
    }

    function initModals() {
        console.log('initModals called');
        
        const saveNameBtn = document.getElementById('saveNameBtn');
        if (saveNameBtn) {
            saveNameBtn.addEventListener('click', () => {
                const input = document.getElementById('playerNameInput');
                const v = input ? input.value.trim() : '';
                if (v) setPoolPlayerName(v);
            });
        } else {
            console.warn('saveNameBtn not found');
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
                        resetFrame(true);
                        updateHUD();
                    }, 1000);
                } else {
                    if (btn) btn.textContent = '❌ Ошибка';
                }
            });
        } else {
            console.warn('btnSaveScore not found');
        }

        const btnRestart = document.getElementById('btnRestartAfterLose');
        if (btnRestart) {
            btnRestart.addEventListener('click', () => {
                closeGameOverModalPool();
                resetFrame(true);
                updateHUD();
            });
        } else {
            console.warn('btnRestartAfterLose not found');
        }

        const btnNextFrame = document.getElementById('btnNextFrame');
        if (btnNextFrame) {
            btnNextFrame.addEventListener('click', () => {
                closeWinModal();
                state.frame++;
                resetFrame(false);
                updateHUD();
            });
        } else {
            console.warn('btnNextFrame not found');
        }

        const btnResetGame = document.getElementById('btnResetGame');
        if (btnResetGame) {
            btnResetGame.addEventListener('click', () => {
                closeWinModal();
                resetFrame(true);
                updateHUD();
            });
        } else {
            console.warn('btnResetGame not found');
        }

        const hsModalClose = document.getElementById('hsModalClose');
        if (hsModalClose) hsModalClose.addEventListener('click', closeHsModalPool);
        
        const hsCloseBtn = document.getElementById('hsCloseBtn');
        if (hsCloseBtn) hsCloseBtn.addEventListener('click', closeHsModalPool);
        
        const hsModal = document.getElementById('hsModal');
        if (hsModal) {
            hsModal.addEventListener('click', (e) => {
                if (e.target === hsModal) closeHsModalPool();
            });
        }
        
        const gameOverModal = document.getElementById('gameOverModal');
        if (gameOverModal) {
            gameOverModal.addEventListener('click', (e) => {
                if (e.target === gameOverModal) closeGameOverModalPool();
            });
        }
        
        const winModal = document.getElementById('winModal');
        if (winModal) {
            winModal.addEventListener('click', (e) => {
                if (e.target === winModal) closeWinModal();
            });
        }
    }

    function initPoolHotkeys() {
        document.addEventListener('keydown', (e) => {
            const k = e.key;
            const anyModal = () =>
                document.getElementById('hsModal')?.classList.contains('active') ||
                document.getElementById('gameOverModal')?.classList.contains('active') ||
                document.getElementById('winModal')?.classList.contains('active');
            
            if (k === 't' || k === 'T' || k === 'е' || k === 'Е') {
                if (!anyModal()) openHsModalPool();
                return;
            }
            if (k === 'Escape') {
                if (document.getElementById('hsModal')?.classList.contains('active')) closeHsModalPool();
                if (document.getElementById('gameOverModal')?.classList.contains('active')) closeGameOverModalPool();
                if (document.getElementById('winModal')?.classList.contains('active')) closeWinModal();
            }
        });
    }

    // -----------------------------------------------------------------------
    // Main loop
    // -----------------------------------------------------------------------
    function loop() {
        handleInput();
        updateAI();
        if (state.phase === 'play' && state.moving) update();
        if (state.phase === 'intro') updateIntro();
        draw();
        updateHUD();
        requestAnimationFrame(loop);
    }

    // Ждём загрузки DOM перед инициализацией модалок
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initModals();
            initPoolHotkeys();
            resetFrame(true);
            updateHUD();
            updatePlayerLabel();
            loop();
        });
    } else {
        initModals();
        initPoolHotkeys();
        resetFrame(true);
        updateHUD();
        updatePlayerLabel();
        loop();
    }
})();