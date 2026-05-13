// American 8-Ball Pool — HTML5 Canvas game
// Based on "Video Pool" engine, rewritten with full 8-ball rules.

(() => {
    const canvas = document.getElementById('table');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // Felt playfield bounds
    const F = { x: 30, y: 30, w: W - 60, h: H - 60 };
    const FX2 = F.x + F.w;
    const FY2 = F.y + F.h;

    const POCKET_R = 26;
    const POCKETS = [
        { x: F.x,           y: F.y  },
        { x: F.x + F.w / 2, y: F.y - 4 },
        { x: FX2,           y: F.y  },
        { x: F.x,           y: FY2  },
        { x: F.x + F.w / 2, y: FY2 + 4 },
        { x: FX2,           y: FY2  },
    ];

    const BALL_R = 12;
    const FRICTION = 0.986;
    const MIN_SPEED = 0.1;
    const MAX_POWER = 22;
    const CHARGE_RATE = 0.12;

    // Standard 8-ball colors
    // Solids 1-7, 8-ball, Stripes 9-15
    const BALL_COLORS = {
        1:  '#f1c40f', // yellow
        2:  '#2980b9', // blue
        3:  '#e74c3c', // red
        4:  '#8e44ad', // purple
        5:  '#e67e22', // orange
        6:  '#27ae60', // green
        7:  '#8b0000', // dark red / maroon
        8:  '#111111', // black (8-ball)
        9:  '#f1c40f', // yellow stripe
        10: '#2980b9', // blue stripe
        11: '#e74c3c', // red stripe
        12: '#8e44ad', // purple stripe
        13: '#e67e22', // orange stripe
        14: '#27ae60', // green stripe
        15: '#8b0000', // dark red stripe
    };

    function isSolid(num) { return num >= 1 && num <= 7; }
    function isStripe(num) { return num >= 9 && num <= 15; }
    function isEightBall(num) { return num === 8; }

    // -----------------------------------------------------------------------
    // Ball class
    // -----------------------------------------------------------------------
    class Ball {
        constructor(x, y, number) {
            this.x = x; this.y = y;
            this.vx = 0; this.vy = 0;
            this.number = number;
            this.color = number === 0 ? '#ffffff' : BALL_COLORS[number];
            this.isCue = number === 0;
            this.potted = false;
        }
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    const state = {
        balls: [],
        aim: { x: F.x + F.w * 0.75, y: F.y + F.h * 0.5 },
        power: 0,
        charging: false,
        moving: false,
        gameOver: false,
        message: '',
        muted: false,
        phase: 'intro', // 'intro' | 'play'

        // Turn management
        turn: 'player',        // 'player' | 'ai'
        aiState: 'idle',
        aiTimer: 0,
        aiShot: null,
        aiAimProgress: 0,

        // 8-ball specific
        isBreakShot: true,
        playerGroup: null,     // 'solids' | 'stripes' | null (not yet assigned)
        aiGroup: null,
        playerPotted: [],      // numbers of balls potted by player
        aiPotted: [],
        ballInHand: false,     // after foul, active player can place cue
        placingCue: false,     // currently placing cue ball

        // Shot tracking
        firstHitBall: null,    // first object ball the cue touched
        pottedThisShot: [],    // balls potted this shot
        cuePotted: false,
        railHitAfterContact: false,
        anyBallHit: false,

        // Intro
        cineBalls: [],
        pendingFullReset: true,

        // Score tracking
        playerWins: 0,
        aiWins: 0,
    };

    function setMessage(s) {
        state.message = s;
        const msgEl = document.getElementById('message');
        if (msgEl) msgEl.textContent = s;
    }

    // -----------------------------------------------------------------------
    // Rack positions — standard triangle, 5 rows, 15 balls
    // 8-ball in center (row 3, pos 2), one solid and one stripe at back corners
    // -----------------------------------------------------------------------
    function rackBalls() {
        const ox = F.x + F.w * 0.72;
        const oy = F.y + F.h * 0.5;
        const d = BALL_R * 2 + 0.5;
        const hx = Math.sqrt(3) / 2 * d;

        // Triangle positions: row 0 (apex, 1 ball) .. row 4 (5 balls)
        const positions = [];
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col <= row; col++) {
                const x = ox + row * hx;
                const y = oy + (col - row / 2) * d;
                positions.push({ x, y, row, col });
            }
        }

        // Place balls with 8-ball constraints:
        // Position index in triangle:
        // Row 0: [0]
        // Row 1: [1, 2]
        // Row 2: [3, 4, 5]
        // Row 3: [6, 7, 8, 9]
        // Row 4: [10, 11, 12, 13, 14]
        // 8-ball goes to index 4 (row 2, center)
        // Back corners (indices 10 and 14) must be one solid and one stripe

        const solids = [1, 2, 3, 4, 5, 6, 7];
        const stripes = [9, 10, 11, 12, 13, 14, 15];

        // Shuffle
        for (let i = solids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [solids[i], solids[j]] = [solids[j], solids[i]];
        }
        for (let i = stripes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [stripes[i], stripes[j]] = [stripes[j], stripes[i]];
        }

        const arrangement = new Array(15).fill(0);
        // 8-ball at index 4
        arrangement[4] = 8;
        // Back corners: one solid, one stripe
        if (Math.random() < 0.5) {
            arrangement[10] = solids.pop();
            arrangement[14] = stripes.pop();
        } else {
            arrangement[10] = stripes.pop();
            arrangement[14] = solids.pop();
        }
        // Apex (index 0) is random
        // Fill remaining slots alternating
        const remaining = [...solids, ...stripes];
        for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }

        let rIdx = 0;
        for (let i = 0; i < 15; i++) {
            if (arrangement[i] === 0) {
                arrangement[i] = remaining[rIdx++];
            }
        }

        const result = [];
        for (let i = 0; i < 15; i++) {
            result.push({ x: positions[i].x, y: positions[i].y, number: arrangement[i] });
        }
        return result;
    }

    // -----------------------------------------------------------------------
    // CineBall — animated ball for intro
    // -----------------------------------------------------------------------
    class CineBall {
        constructor({ x, y, tx, ty, color, number, delay, speed }) {
            this.x = x; this.y = y;
            this.tx = tx; this.ty = ty;
            this.color = color;
            this.number = number;
            this.isCue = number === 0;
            this.delay = delay;
            this.speed = speed || 7;
            this.arrived = false;
            this.active = false;
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
    }

    // -----------------------------------------------------------------------
    // Build intro cinematic
    // -----------------------------------------------------------------------
    function buildIntro() {
        state.cineBalls = [];
        const rack = rackBalls();
        state._rackData = rack; // save for applyReset

        const BALL_DELAY = 10;
        const BALL_SPEED = 8;
        for (let i = 0; i < rack.length; i++) {
            const { x: tx, y: ty, number } = rack[i];
            // Enter from left
            const sx = -40;
            const sy = ty;
            state.cineBalls.push(new CineBall({
                x: sx, y: sy, tx, ty,
                color: number === 0 ? '#ffffff' : BALL_COLORS[number],
                number,
                delay: i * BALL_DELAY,
                speed: BALL_SPEED,
            }));
        }

        // Cue ball enters last
        const cueDelay = rack.length * BALL_DELAY + 40;
        const cueX = F.x + F.w * 0.25;
        const cueY = F.y + F.h * 0.5;
        state.cineBalls.push(new CineBall({
            x: -40, y: cueY, tx: cueX, ty: cueY,
            color: '#ffffff', number: 0,
            delay: cueDelay, speed: BALL_SPEED,
        }));
    }

    // -----------------------------------------------------------------------
    // applyReset
    // -----------------------------------------------------------------------
    function applyReset(fullReset) {
        const rack = state._rackData || rackBalls();
        state.balls = [];
        state.balls.push(new Ball(F.x + F.w * 0.25, F.y + F.h * 0.5, 0)); // cue
        for (const { x, y, number } of rack) {
            state.balls.push(new Ball(x, y, number));
        }

        if (fullReset) {
            state.playerGroup = null;
            state.aiGroup = null;
            state.playerPotted = [];
            state.aiPotted = [];
        }

        state.power = 0;
        state.charging = false;
        state.moving = false;
        state.gameOver = false;
        state.isBreakShot = true;
        state.ballInHand = false;
        state.placingCue = false;
        state.firstHitBall = null;
        state.pottedThisShot = [];
        state.cuePotted = false;
        state.railHitAfterContact = false;
        state.anyBallHit = false;
        state.aim = { x: F.x + F.w * 0.75, y: F.y + F.h * 0.5 };
        state.turn = 'player';
        state.aiState = 'idle';
        state.aiShot = null;
        setMessage('Ваш ход. Разбивайте!');
    }

    function resetGame(fullReset) {
        state.pendingFullReset = fullReset;
        if (fullReset) {
            state.playerGroup = null;
            state.aiGroup = null;
            state.playerPotted = [];
            state.aiPotted = [];
        }
        buildIntro();
        state.phase = 'intro';
        state.moving = false;
        state.charging = false;
        state.power = 0;
        state.gameOver = false;
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
        playTone({ freq: 900 + s * 600, endFreq: (900 + s * 600) * 0.55, duration: 0.07, type: 'triangle', gain: 0.08 + s * 0.18 });
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
    function soundFoul() {
        if (!audioCtx || state.muted) return;
        const now = audioCtx.currentTime;
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
    function soundWin() {
        playTone({ freq: 523, duration: 0.15, type: 'sine', gain: 0.25 });
        setTimeout(() => playTone({ freq: 659, duration: 0.15, type: 'sine', gain: 0.25 }), 150);
        setTimeout(() => playTone({ freq: 784, duration: 0.3, type: 'sine', gain: 0.3 }), 300);
    }

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    let ballsTouchedRail = new Set();

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

        // Track first hit for foul detection
        if (a.isCue && !b.isCue && state.firstHitBall === null) {
            state.firstHitBall = b;
            state.anyBallHit = true;
        } else if (b.isCue && !a.isCue && state.firstHitBall === null) {
            state.firstHitBall = a;
            state.anyBallHit = true;
        }
    }

    function nearPocket(b) {
        for (const p of POCKETS)
            if (Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R + BALL_R * 0.4) return true;
        return false;
    }

    function wallCollide(b) {
        if (nearPocket(b)) return;
        const e = 0.85; let bounced = false, speed = 0;
        if (b.x - BALL_R < F.x)  { b.x = F.x  + BALL_R; speed = Math.abs(b.vx); b.vx = -b.vx * e; bounced = true; }
        if (b.x + BALL_R > FX2)  { b.x = FX2  - BALL_R; speed = Math.abs(b.vx); b.vx = -b.vx * e; bounced = true; }
        if (b.y - BALL_R < F.y)  { b.y = F.y  + BALL_R; speed = Math.abs(b.vy); b.vy = -b.vy * e; bounced = true; }
        if (b.y + BALL_R > FY2)  { b.y = FY2  - BALL_R; speed = Math.abs(b.vy); b.vy = -b.vy * e; bounced = true; }
        if (bounced) {
            if (speed > 0.6) soundWall(speed);
            // Track rail contact for foul detection (must happen after ball contact)
            if (state.anyBallHit) {
                ballsTouchedRail.add(b);
                state.railHitAfterContact = true;
            }
        }
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
            soundFoul();
            state.cuePotted = true;
        } else {
            soundPocket();
            state.pottedThisShot.push(b);
            // A potted ball also counts as "rail contact" for foul purposes
            state.railHitAfterContact = true;
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

    // -----------------------------------------------------------------------
    // 8-Ball shot resolution
    // -----------------------------------------------------------------------
    function getPlayerGroup(who) {
        return who === 'player' ? state.playerGroup : state.aiGroup;
    }

    function getAllGroupBallsPotted(who, excludeBalls) {
        const group = getPlayerGroup(who);
        if (!group) return false;
        // excludeBalls: balls potted this shot - pretend they are still on table
        // so we evaluate the pre-shot state (before this shot's balls dropped)
        const excluded = excludeBalls ? new Set(excludeBalls) : new Set();
        const groupBallsOnTable = state.balls.filter(b => {
            if (isEightBall(b.number)) return false;
            const stillOnTable = !b.potted || excluded.has(b); // potted-this-shot count as still on table
            if (!stillOnTable) return false;
            if (group === 'solids') return isSolid(b.number);
            return isStripe(b.number);
        });
        return groupBallsOnTable.length === 0;
    }

    function canShootEightBall(who, excludeBalls) {
        return getAllGroupBallsPotted(who, excludeBalls);
    }

    function onShotEnd() {
        const isAI = state.turn === 'ai';
        const who = state.turn;
        const opponent = isAI ? 'player' : 'ai';
        const potted = state.pottedThisShot;
        const cuePotted = state.cuePotted;
        const firstHit = state.firstHitBall;
        let foul = false;
        let loseGame = false;
        let winGame = false;
        let msg = '';
        let eightPotted = potted.some(b => isEightBall(b.number));

        // --- Break shot special rules ---
        if (state.isBreakShot) {
            state.isBreakShot = false;

            if (cuePotted) {
                foul = true;
                msg = (isAI ? 'Снеговик' : 'Вы') + ': фол на разбитии (биток в лузу). ';
            }

            if (eightPotted) {
                // 8-ball potted on break: re-rack (special rule)
                msg = 'Шар 8 забит на разбитии! Переигровка. ';
                resetGame(true);
                updateHUD();
                setMessage(msg);
                return;
            }

            // Assign groups if any non-8 ball was potted
            if (!foul && potted.length > 0) {
                const solidsPotted = potted.filter(b => isSolid(b.number));
                const stripesPotted = potted.filter(b => isStripe(b.number));

                if (solidsPotted.length > 0 || stripesPotted.length > 0) {
                    if (solidsPotted.length > stripesPotted.length) {
                        assignGroups(who, 'solids');
                    } else if (stripesPotted.length > solidsPotted.length) {
                        assignGroups(who, 'stripes');
                    } else {
                        // Equal: assign solids to breaker
                        assignGroups(who, 'solids');
                    }
                }

                // Record potted balls
                for (const b of potted) {
                    recordPottedBall(who, b.number);
                }

                if (!foul) {
                    msg = (isAI ? 'Снеговик' : 'Вы') + ' забили на разбитии. ';
                    // Breaker continues
                    startTurn(who, msg);
                    return;
                }
            }

            if (foul) {
                respotCueBall();
                switchTurnWithBallInHand(opponent, msg);
                return;
            }

            // No balls potted on break — switch turn
            msg = (isAI ? 'Снеговик' : 'Вы') + ': ни одного шара на разбитии. ';
            switchTurn(opponent, msg);
            return;
        }

        // --- Normal shot rules ---
        const myGroup = getPlayerGroup(who);

        // Check fouls
        if (cuePotted) {
            foul = true;
            msg += (isAI ? 'Снеговик' : 'Вы') + ': биток в лузу! Фол. ';
        }

        if (!state.anyBallHit) {
            foul = true;
            msg += (isAI ? 'Снеговик' : 'Вы') + ': не задет ни один шар! Фол. ';
        } else if (firstHit && myGroup) {
            // Must hit own group first (unless shooting at 8)
            // Pass potted-this-shot so we check state BEFORE this shot's balls dropped
            const shootingEight = canShootEightBall(who, potted);
            if (shootingEight) {
                if (!isEightBall(firstHit.number)) {
                    foul = true;
                    msg += (isAI ? 'Снеговик' : 'Вы') + ': нужно бить по шару 8! Фол. ';
                }
            } else {
                if (!isBallInMyGroup(who, firstHit.number)) {
                    foul = true;
                    msg += (isAI ? 'Снеговик' : 'Вы') + ': первое касание не своего шара! Фол. ';
                }
            }
        }

        // Rail rule: after contact, at least one ball must touch a rail or be potted
        if (state.anyBallHit && !state.railHitAfterContact && potted.length === 0 && !cuePotted) {
            foul = true;
            msg += 'Ни один шар не коснулся борта после контакта! Фол. ';
        }

        // Check 8-ball potted
        if (eightPotted) {
            if (!canShootEightBall(who)) {
                // 8-ball potted too early — lose
                loseGame = true;
                msg = (isAI ? 'Снеговик' : 'Вы') + ' забили шар 8 раньше времени! ';
            } else if (cuePotted) {
                // 8-ball + cue potted — lose
                loseGame = true;
                msg = (isAI ? 'Снеговик' : 'Вы') + ' забили шар 8, но биток тоже в лузе! ';
            } else if (!state.anyBallHit) {
                // No contact at all — lose
                loseGame = true;
                msg += (isAI ? 'Снеговик' : 'Вы') + ' забили шар 8 с фолом (нет контакта)! ';
            } else {
                // Legal 8-ball pot — win!
                winGame = true;
                msg = (isAI ? 'Снеговик' : 'Вы') + ' забили шар 8! ';
            }
        }

        if (loseGame) {
            if (isAI) {
                state.playerWins++;
                endGame(true, msg + 'Вы выиграли!');
            } else {
                state.aiWins++;
                endGame(false, msg + 'ИИ выиграл!');
            }
            return;
        }

        if (winGame) {
            if (isAI) {
                state.aiWins++;
                endGame(false, msg + 'ИИ выиграл!');
            } else {
                state.playerWins++;
                endGame(true, msg + 'Вы выиграли!');
            }
            return;
        }

        // Record potted balls
        let ownBallPotted = false;
        for (const b of potted) {
            if (isEightBall(b.number)) continue;
            recordPottedBall(who, b.number);
            if (myGroup && isBallInMyGroup(who, b.number)) ownBallPotted = true;
        }

        // Assign groups if not yet assigned and a ball was potted
        if (!state.playerGroup && potted.length > 0) {
            const solidsPotted = potted.filter(b => isSolid(b.number));
            const stripesPotted = potted.filter(b => isStripe(b.number));
            if (solidsPotted.length > 0 && stripesPotted.length === 0) {
                assignGroups(who, 'solids');
                ownBallPotted = true;
            } else if (stripesPotted.length > 0 && solidsPotted.length === 0) {
                assignGroups(who, 'stripes');
                ownBallPotted = true;
            } else if (solidsPotted.length > 0 && stripesPotted.length > 0) {
                // Mixed: assign based on which has more
                if (solidsPotted.length >= stripesPotted.length) {
                    assignGroups(who, 'solids');
                } else {
                    assignGroups(who, 'stripes');
                }
                ownBallPotted = true;
            }
        }

        if (foul) {
            if (cuePotted) respotCueBall();
            switchTurnWithBallInHand(opponent, msg);
            return;
        }

        if (potted.length > 0 && ownBallPotted) {
            msg += (isAI ? 'Снеговик' : 'Вы') + ' забили. ';
            if (canShootEightBall(who)) msg += 'Можно бить шар 8! '; // no exclusions: balls are already recorded
            startTurn(who, msg);
        } else if (potted.length > 0 && !ownBallPotted) {
            msg += (isAI ? 'Снеговик' : 'Вы') + ` забили шар соперника. Переход хода. `;
            // Opponent's balls were potted — still counts, but turn switches
            switchTurn(opponent, msg);
        } else {
            msg += (isAI ? 'Снеговик' : 'Вы') + ': промах. ';
            switchTurn(opponent, msg);
        }
    }

    function isBallInMyGroup(who, num) {
        const group = getPlayerGroup(who);
        if (!group) return true; // groups not yet assigned, any ball is fine
        if (group === 'solids') return isSolid(num);
        return isStripe(num);
    }

    function assignGroups(who, group) {
        if (who === 'player') {
            state.playerGroup = group;
            state.aiGroup = group === 'solids' ? 'stripes' : 'solids';
        } else {
            state.aiGroup = group;
            state.playerGroup = group === 'solids' ? 'stripes' : 'solids';
        }
    }

    function recordPottedBall(who, num) {
        if (isEightBall(num)) return;
        if (who === 'player') {
            if (!state.playerPotted.includes(num)) state.playerPotted.push(num);
        } else {
            if (!state.aiPotted.includes(num)) state.aiPotted.push(num);
        }
    }

    function respotCueBall() {
        const cue = state.balls.find(b => b.isCue);
        if (cue) {
            cue.potted = false;
            cue.x = F.x + F.w * 0.25;
            cue.y = F.y + F.h * 0.5;
            cue.vx = 0; cue.vy = 0;
        }
    }

    function switchTurn(to, msg) {
        state.turn = to;
        if (to === 'ai') {
            state.aiState = 'thinking';
            state.aiTimer = 60;
            msg += 'Ход Снеговика.';
        } else {
            state.aiState = 'idle';
            msg += 'Ваш ход.';
        }
        state.ballInHand = false;
        state.placingCue = false;
        setMessage(msg);
    }

    function switchTurnWithBallInHand(to, msg) {
        state.turn = to;
        state.ballInHand = true;
        if (to === 'ai') {
            // AI places cue ball automatically
            state.aiState = 'thinking';
            state.aiTimer = 40;
            state.ballInHand = false; // AI handles it internally
            aiPlaceCueBall();
            msg += 'Ход Снеговика (свободный шар).';
        } else {
            state.placingCue = true;
            state.aiState = 'idle';
            msg += 'Ваш ход. Кликните на стол для установки битка.';
        }
        setMessage(msg);
    }

    function startTurn(who, msg) {
        state.turn = who;
        if (who === 'ai') {
            state.aiState = 'thinking';
            state.aiTimer = 50;
            msg += 'Ход Снеговика.';
        } else {
            state.aiState = 'idle';
            msg += 'Ваш ход.';
        }
        state.ballInHand = false;
        state.placingCue = false;
        setMessage(msg);
    }

    function endGame(playerWon, msg) {
        state.gameOver = true;
        setMessage(msg);
        if (playerWon) {
            soundWin();
            const modal = document.getElementById('winModal');
            const text = document.getElementById('winText');
            if (text) text.textContent = msg;
            if (modal) modal.classList.add('active');
        } else {
            soundFoul();
            const modal = document.getElementById('gameOverModal');
            const title = document.getElementById('gameOverTitle');
            const text = document.getElementById('gameOverText');
            if (title) title.textContent = 'ПРОИГРЫШ';
            if (text) text.textContent = msg;
            if (modal) modal.classList.add('active');
        }
    }

    // -----------------------------------------------------------------------
    // AI
    // -----------------------------------------------------------------------
    function aiPlaceCueBall() {
        // Place cue ball at a good position
        const cue = state.balls.find(b => b.isCue);
        if (!cue) return;
        cue.potted = false;

        // Try center-left area, find a spot not overlapping other balls
        let bestX = F.x + F.w * 0.25;
        let bestY = F.y + F.h * 0.5;

        for (let attempt = 0; attempt < 50; attempt++) {
            const tx = F.x + BALL_R + Math.random() * (F.w - 2 * BALL_R);
            const ty = F.y + BALL_R + Math.random() * (F.h - 2 * BALL_R);
            let valid = true;
            for (const b of state.balls) {
                if (b.isCue || b.potted) continue;
                if (Math.hypot(tx - b.x, ty - b.y) < BALL_R * 2.5) { valid = false; break; }
            }
            if (valid) { bestX = tx; bestY = ty; break; }
        }

        cue.x = bestX; cue.y = bestY;
        cue.vx = 0; cue.vy = 0;
    }

    function pathClear(x1, y1, x2, y2, excludeA, excludeB) {
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len === 0) return true;
        const nx = dx / len, ny = dy / len;
        for (const b of state.balls) {
            if (b.potted || b === excludeA || b === excludeB) continue;
            const tx = b.x - x1, ty = b.y - y1;
            const proj = tx * nx + ty * ny;
            if (proj < -BALL_R || proj > len + BALL_R) continue;
            const clampedProj = Math.max(0, Math.min(len, proj));
            const closestX = x1 + nx * clampedProj;
            const closestY = y1 + ny * clampedProj;
            if (Math.hypot(b.x - closestX, b.y - closestY) < BALL_R * 2 - 1) return false;
        }
        return true;
    }

    function aiFindBestShot() {
        const cue = state.balls.find(b => b.isCue && !b.potted);
        if (!cue) return null;

        const myGroup = state.aiGroup;
        const canShoot8 = canShootEightBall('ai');

        // Determine which balls AI should target
        function isTargetBall(b) {
            if (b.isCue || b.potted) return false;
            if (canShoot8) return isEightBall(b.number);
            if (!myGroup) return !isEightBall(b.number); // groups not assigned yet
            if (myGroup === 'solids') return isSolid(b.number);
            return isStripe(b.number);
        }

        let best = null, bestScore = -Infinity;

        for (const ball of state.balls) {
            if (!isTargetBall(ball)) continue;

            for (const pocket of POCKETS) {
                const bpDx = pocket.x - ball.x, bpDy = pocket.y - ball.y;
                const bpLen = Math.hypot(bpDx, bpDy);
                if (bpLen < 1) continue;
                const bpNx = bpDx / bpLen, bpNy = bpDy / bpLen;

                const ghostX = ball.x - bpNx * BALL_R * 2;
                const ghostY = ball.y - bpNy * BALL_R * 2;

                if (ghostX < F.x + BALL_R || ghostX > FX2 - BALL_R) continue;
                if (ghostY < F.y + BALL_R || ghostY > FY2 - BALL_R) continue;

                if (!pathClear(cue.x, cue.y, ghostX, ghostY, cue, ball)) continue;
                if (!pathClear(ball.x, ball.y, pocket.x, pocket.y, cue, ball)) continue;

                let sc = 0;

                // Prefer shorter ball-to-pocket
                sc -= bpLen * 0.04;

                // Prefer shorter cue-to-ghost
                const cueDist = Math.hypot(ghostX - cue.x, ghostY - cue.y);
                sc -= cueDist * 0.025;

                // Prefer head-on shots
                const aimDx = ghostX - cue.x, aimDy = ghostY - cue.y;
                const aimLen = Math.hypot(aimDx, aimDy);
                if (aimLen > 0) {
                    const nX = ball.x - ghostX, nY = ball.y - ghostY;
                    const nLen = Math.hypot(nX, nY);
                    if (nLen > 0) {
                        const dot = (aimDx / aimLen) * (nX / nLen) + (aimDy / aimLen) * (nY / nLen);
                        sc += dot * 25;
                    }
                }

                // Bonus for 8-ball when ready
                if (isEightBall(ball.number) && canShoot8) sc += 30;

                if (sc > bestScore) {
                    bestScore = sc;
                    const power = Math.min(MAX_POWER, Math.max(4, (cueDist + bpLen) * 0.05));
                    best = { aimX: ghostX, aimY: ghostY, power, ball, pocket };
                }
            }
        }

        // Fallback: hit nearest legal ball
        if (!best) {
            let nearestDist = Infinity, nearest = null;
            for (const b of state.balls) {
                if (b.isCue || b.potted || isEightBall(b.number)) continue;
                if (myGroup === 'solids' && !isSolid(b.number)) continue;
                if (myGroup === 'stripes' && !isStripe(b.number)) continue;
                const d = Math.hypot(b.x - cue.x, b.y - cue.y);
                if (d < nearestDist) { nearestDist = d; nearest = b; }
            }
            if (!nearest) {
                // No legal balls, try any non-eight ball
                for (const b of state.balls) {
                    if (b.isCue || b.potted || isEightBall(b.number)) continue;
                    const d = Math.hypot(b.x - cue.x, b.y - cue.y);
                    if (d < nearestDist) { nearestDist = d; nearest = b; }
                }
            }
            if (nearest) {
                const power = Math.min(MAX_POWER, Math.max(6, nearestDist * 0.06));
                best = { aimX: nearest.x, aimY: nearest.y, power, ball: nearest, pocket: null };
            }
        }

        return best;
    }

    function updateAI() {
        if (state.turn !== 'ai' || state.moving || state.phase !== 'play') return;
        if (state.gameOver) return;

        if (state.aiState === 'thinking') {
            state.aiTimer--;
            if (state.aiTimer <= 0) {
                const shot = aiFindBestShot();
                if (!shot) {
                    state.turn = 'player';
                    state.aiState = 'idle';
                    setMessage('ИИ не нашёл удара. Ваш ход.');
                    return;
                }
                state.aiShot = shot;
                state.aiState = 'aiming';
                state.aiAimProgress = 0;
                const cue = state.balls.find(b => b.isCue && !b.potted);
                if (cue) state.aim = { x: cue.x, y: cue.y };
            }
        } else if (state.aiState === 'aiming') {
            state.aiAimProgress = Math.min(1, state.aiAimProgress + 0.03);
            const shot = state.aiShot;
            const cue = state.balls.find(b => b.isCue && !b.potted);
            if (!cue) return;
            const t = state.aiAimProgress < 0.5
                ? 2 * state.aiAimProgress * state.aiAimProgress
                : 1 - Math.pow(-2 * state.aiAimProgress + 2, 2) / 2;
            state.aim = {
                x: cue.x + (shot.aimX - cue.x) * t,
                y: cue.y + (shot.aimY - cue.y) * t,
            };
            state.power = shot.power * t;
            if (state.aiAimProgress >= 1) {
                state.aiState = 'shooting';
                state.aiTimer = 8;
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
        if (p < 0.5) return;
        cue.vx = (dx / dist) * p;
        cue.vy = (dy / dist) * p;
        state.power = 0;
        state.moving = true;

        // Reset shot tracking
        state.pottedThisShot = [];
        state.cuePotted = false;
        state.firstHitBall = null;
        state.railHitAfterContact = false;
        state.anyBallHit = false;
        ballsTouchedRail = new Set();

        soundShot(p);
    }

    function handleInput() {
        if (state.charging && state.phase === 'play' && !state.moving && !state.gameOver && !state.placingCue) {
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
    // Rendering
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

        // Head string line
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(F.x + F.w * 0.25, F.y);
        ctx.lineTo(F.x + F.w * 0.25, FY2);
        ctx.stroke();

        // Foot spot
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.arc(F.x + F.w * 0.72, F.y + F.h * 0.5, 3, 0, Math.PI * 2);
        ctx.fill();

        for (const p of POCKETS) {
            const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, POCKET_R);
            g.addColorStop(0, '#000'); g.addColorStop(1, '#0a0a0a');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
        }
    }

    function drawBallAt(x, y, color, number, isCue) {
        const R = BALL_R;

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.arc(x + 2, y + 2, R, 0, Math.PI * 2); ctx.fill();

        if (isCue) {
            // Cue ball — white with gradient
            const g = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, R);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.6, '#f0f0f0');
            g.addColorStop(1, '#c0c0c0');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.beginPath();
            ctx.ellipse(x - 3, y - 4, R * 0.3, R * 0.2, -Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        if (isEightBall(number)) {
            // 8-ball — solid black
            const g = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, R);
            g.addColorStop(0, '#555555');
            g.addColorStop(0.3, '#222222');
            g.addColorStop(1, '#000000');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();

            // White circle for number
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(x, y + 0.5, 5.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.font = 'bold 8px system-ui, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('8', x, y + 1);

            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.beginPath();
            ctx.ellipse(x - 3, y - 4, R * 0.3, R * 0.18, -Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        if (isSolid(number)) {
            // Solid ball — full color
            const g = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, R);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.25, color);
            g.addColorStop(1, shade(color, -0.35));
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();

            // White number circle
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(x, y + 0.5, 5.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.font = 'bold 8px system-ui, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(number), x, y + 1);

            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.beginPath();
            ctx.ellipse(x - 3, y - 4, R * 0.32, R * 0.2, -Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Stripe ball — white base with colored stripe band
            // White base
            const g = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, R);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.7, '#f5f5f5');
            g.addColorStop(1, '#d0d0d0');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();

            // Color stripe band (horizontal across center)
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, R - 0.5, 0, Math.PI * 2);
            ctx.clip();

            const bandH = R * 1.1;
            const bandG = ctx.createLinearGradient(x - R, y - bandH/2, x - R, y + bandH/2);
            bandG.addColorStop(0, shade(color, 0.15));
            bandG.addColorStop(0.5, color);
            bandG.addColorStop(1, shade(color, -0.2));
            ctx.fillStyle = bandG;
            ctx.fillRect(x - R, y - bandH / 2, R * 2, bandH);
            ctx.restore();

            // White number circle
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(x, y + 0.5, 5.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.font = 'bold 8px system-ui, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(number), x, y + 1);

            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.beginPath();
            ctx.ellipse(x - 3, y - 4, R * 0.3, R * 0.18, -Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawBall(b) {
        drawBallAt(b.x, b.y, b.color, b.number, b.isCue);
    }

    function drawAim() {
        if (state.moving || state.phase !== 'play' || state.gameOver) return;
        if (state.placingCue) return;
        if (state.turn === 'ai') return;
        const cue = state.balls.find(b => b.isCue && !b.potted);
        if (!cue) return;
        const dx = state.aim.x - cue.x, dy = state.aim.y - cue.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return;
        const nx = dx / dist, ny = dy / dist;

        // Aim line
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.setLineDash([6, 5]); ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cue.x + nx * BALL_R, cue.y + ny * BALL_R);
        ctx.lineTo(state.aim.x + nx * 40, state.aim.y + ny * 40);
        ctx.stroke(); ctx.setLineDash([]);

        // Cue stick
        const pull = 12 + state.power * 2.5;
        const s1 = { x: cue.x - nx * (BALL_R + pull),       y: cue.y - ny * (BALL_R + pull) };
        const s2 = { x: cue.x - nx * (BALL_R + pull + 110), y: cue.y - ny * (BALL_R + pull + 110) };

        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s1.x+2, s1.y+2); ctx.lineTo(s2.x+2, s2.y+2); ctx.stroke();

        const stickGrad = ctx.createLinearGradient(s1.x, s1.y, s2.x, s2.y);
        stickGrad.addColorStop(0, '#f3d597');
        stickGrad.addColorStop(0.5, '#b58048');
        stickGrad.addColorStop(1, '#4a2a10');
        ctx.strokeStyle = stickGrad; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();

        // Tip
        ctx.strokeStyle = '#2a6bb0'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s1.x - nx*4, s1.y - ny*4); ctx.stroke();
        ctx.lineCap = 'butt';

        // Crosshair
        ctx.save();
        ctx.strokeStyle = '#f1c40f'; ctx.fillStyle = 'rgba(241,196,15,0.15)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(state.aim.x, state.aim.y, 6, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(state.aim.x-9, state.aim.y); ctx.lineTo(state.aim.x-3, state.aim.y);
        ctx.moveTo(state.aim.x+3, state.aim.y);  ctx.lineTo(state.aim.x+9, state.aim.y);
        ctx.moveTo(state.aim.x, state.aim.y-9); ctx.lineTo(state.aim.x, state.aim.y-3);
        ctx.moveTo(state.aim.x, state.aim.y+3);  ctx.lineTo(state.aim.x, state.aim.y+9);
        ctx.stroke(); ctx.restore();
    }

    function drawTargetBallTrajectory() {
        if (state.moving || state.phase !== 'play' || state.gameOver) return;
        if (state.placingCue || state.turn === 'ai') return;
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

        // Ghost ball outline
        ctx.save();
        ctx.globalAlpha = 0.3; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ghostX, ghostY, BALL_R, 0, Math.PI*2); ctx.stroke();
        ctx.restore();

        // Target ball trajectory
        ctx.save();
        ctx.setLineDash([7, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,220,100,0.7)';
        ctx.beginPath();
        let x = targetBall.x + finalDirX * (BALL_R + 2);
        let y = targetBall.y + finalDirY * (BALL_R + 2);
        ctx.moveTo(x, y);
        let vx = finalDirX * 6, vy = finalDirY * 6;
        for (let i = 0; i < 40; i++) {
            let newX = x + vx, newY = y + vy;
            if (newX - BALL_R < F.x)  { newX = F.x  + BALL_R; vx = -vx*0.9; }
            if (newX + BALL_R > FX2)  { newX = FX2  - BALL_R; vx = -vx*0.9; }
            if (newY - BALL_R < F.y)  { newY = F.y  + BALL_R; vy = -vy*0.9; }
            if (newY + BALL_R > FY2)  { newY = FY2  - BALL_R; vy = -vy*0.9; }
            ctx.lineTo(newX, newY); x = newX; y = newY;
            if (Math.abs(vx) < 0.3 && Math.abs(vy) < 0.3) break;
            vx *= 0.995; vy *= 0.995;
        }
        ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    }

    function drawAIAimLine() {
        if (state.aiState !== 'aiming' && state.aiState !== 'shooting') return;
        const cue = state.balls.find(b => b.isCue && !b.potted);
        if (!cue) return;
        const dx = state.aim.x - cue.x, dy = state.aim.y - cue.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const nx = dx / len, ny = dy / len;
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = '#e74c3c';
        ctx.setLineDash([5, 6]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cue.x + nx * BALL_R, cue.y + ny * BALL_R);
        ctx.lineTo(state.aim.x + nx * 50, state.aim.y + ny * 50);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    function drawPlacingCue() {
        if (!state.placingCue) return;
        // Draw semi-transparent cue ball at mouse position
        ctx.save();
        ctx.globalAlpha = 0.5;
        drawBallAt(state.aim.x, state.aim.y, '#ffffff', 0, true);
        ctx.restore();

        // Draw placement zone indicator
        ctx.save();
        ctx.strokeStyle = 'rgba(46, 204, 113, 0.4)';
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(F.x + 2, F.y + 2, F.w - 4, F.h - 4);
        ctx.setLineDash([]);
        ctx.restore();
    }

    function drawCineBalls() {
        for (const cb of state.cineBalls) {
            if (!cb.active && !cb.arrived) continue;
            drawBallAt(cb.x, cb.y, cb.color, cb.number, cb.isCue);
        }
    }

    function drawCineOverlay() {
        if (state.phase !== 'intro') return;
        const stripH = 55;
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
        ctx.font = 'bold 22px system-ui, sans-serif';
        ctx.fillText('🎱 ВОСЬМЁРКА', W / 2, F.y + 20);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('Шары занимают позиции…', W / 2, F.y + 40);
        ctx.restore();
    }

    function draw() {
        ctx.clearRect(0, 0, W, H);
        drawRailsAndFelt();

        if (state.phase === 'play') {
            for (const b of state.balls) if (!b.potted) drawBall(b);
            drawAim();
            drawTargetBallTrajectory();
            drawAIAimLine();
            drawPlacingCue();
        } else {
            drawCineBalls();
            drawCineOverlay();
        }
    }

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    function updateHUD() {
        const powerFillEl = document.getElementById('powerFill');
        if (powerFillEl) powerFillEl.style.width = (state.power / MAX_POWER * 100) + '%';

        const turnEl = document.getElementById('turnIndicator');
        if (turnEl) {
            if (state.turn === 'player') {
                turnEl.textContent = 'ВАШ ХОД';
                turnEl.className = 'turn-player';
            } else {
                turnEl.textContent = 'ХОД Снеговика';
                turnEl.className = 'turn-ai';
            }
        }

        const bihEl = document.getElementById('ballInHandIndicator');
        if (bihEl) bihEl.style.display = state.placingCue ? '' : 'none';

        // Player group
        const pgEl = document.getElementById('playerGroup');
        if (pgEl) {
            if (state.playerGroup === 'solids') pgEl.textContent = '● Сплошные (1-7)';
            else if (state.playerGroup === 'stripes') pgEl.textContent = '◐ Полосатые (9-15)';
            else pgEl.textContent = '—';
        }

        const agEl = document.getElementById('aiGroup');
        if (agEl) {
            if (state.aiGroup === 'solids') agEl.textContent = '● Сплошные (1-7)';
            else if (state.aiGroup === 'stripes') agEl.textContent = '◐ Полосатые (9-15)';
            else agEl.textContent = '—';
        }

        // Potted balls display
        updatePottedDisplay('playerPotted', state.playerPotted);
        updatePottedDisplay('aiPotted', state.aiPotted);

        // Active turn highlight
        const playerBlock = document.getElementById('playerBlock');
        const aiBlock = document.getElementById('aiBlock');
        if (playerBlock) playerBlock.classList.toggle('active-turn', state.turn === 'player');
        if (aiBlock) aiBlock.classList.toggle('active-turn', state.turn === 'ai');
    }

    function updatePottedDisplay(elId, potted) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.innerHTML = '';
        const sorted = [...potted].sort((a, b) => a - b);
        for (const num of sorted) {
            const div = document.createElement('div');
            div.className = 'mini-ball' + (isStripe(num) ? ' stripe' : '');
            div.style.backgroundColor = BALL_COLORS[num];
            if (isStripe(num)) {
                div.style.setProperty('--ball-color', BALL_COLORS[num]);
                div.style.backgroundColor = 'transparent';
            }
            div.textContent = num;
            el.appendChild(div);
        }
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
            x: Math.max(F.x + BALL_R, Math.min(FX2 - BALL_R, p.x)),
            y: Math.max(F.y + BALL_R, Math.min(FY2 - BALL_R, p.y)),
        };
    }

    canvas.addEventListener('mousemove', (e) => {
        if (state.turn === 'ai' && !state.placingCue) return;
        state.aim = clampToFelt(canvasCoords(e));
    });

    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        initAudio(); resumeAudio();

        if (state.placingCue && state.turn === 'player') {
            // Place cue ball
            const pos = clampToFelt(canvasCoords(e));
            const cue = state.balls.find(b => b.isCue);
            if (!cue) return;

            // Check not overlapping any ball
            let valid = true;
            for (const b of state.balls) {
                if (b.isCue || b.potted) continue;
                if (Math.hypot(pos.x - b.x, pos.y - b.y) < BALL_R * 2.2) { valid = false; break; }
            }
            if (!valid) {
                setMessage('Нельзя ставить биток вплотную к шару! Выберите другое место.');
                return;
            }

            cue.potted = false;
            cue.x = pos.x; cue.y = pos.y;
            cue.vx = 0; cue.vy = 0;
            state.placingCue = false;
            state.ballInHand = false;
            setMessage('Биток установлен. Ваш ход.');
            return;
        }

        if (state.turn === 'ai') return;
        if (state.moving || state.phase !== 'play' || state.gameOver) return;
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

    // Buttons
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            initAudio(); resumeAudio();
            closeAllModals();
            resetGame(true);
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
    // Modals
    // -----------------------------------------------------------------------
    function closeAllModals() {
        document.getElementById('gameOverModal')?.classList.remove('active');
        document.getElementById('winModal')?.classList.remove('active');
    }

    const btnRestart = document.getElementById('btnRestartAfterLose');
    if (btnRestart) {
        btnRestart.addEventListener('click', () => {
            closeAllModals();
            resetGame(true);
            updateHUD();
        });
    }

    const btnNewGameWin = document.getElementById('btnNewGameAfterWin');
    if (btnNewGameWin) {
        btnNewGameWin.addEventListener('click', () => {
            closeAllModals();
            resetGame(true);
            updateHUD();
        });
    }

    document.getElementById('gameOverModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'gameOverModal') closeAllModals();
    });
    document.getElementById('winModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'winModal') closeAllModals();
    });

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

    resetGame(true);
    updateHUD();
    loop();
})();
