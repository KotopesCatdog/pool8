// Pool8 — Physics Engine
// Handles ball movement, collision detection, wall bounces, and pockets

export class Ball {
    constructor(x, y, color, number) {
        this.x = x; this.y = y;
        this.vx = 0; this.vy = 0;
        this.color = color;
        this.number = number;
        this.isCue = number === 0;
        this.potted = false;
    }
}

export class CineBall {
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
        if (this.x < -100 || this.x > window.innerWidth + 100 || this.y < -100 || this.y > window.innerHeight + 100) {
            this.gone = true;
        }
    }
}

export function stepBalls(balls, friction, minSpeed) {
    for (const b of balls) {
        if (b.potted) continue;
        b.x += b.vx; b.y += b.vy;
        b.vx *= friction; b.vy *= friction;
        if (Math.hypot(b.vx, b.vy) < minSpeed) { b.vx = 0; b.vy = 0; }
    }
}

export function collideBalls(a, b, ballRadius, onCollide) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0 || dist >= 2 * ballRadius) return;

    // Sub-step: back up the faster-moving ball to exact moment of contact
    const spdA = Math.hypot(a.vx, a.vy);
    const spdB = Math.hypot(b.vx, b.vy);
    if (spdA > 0 || spdB > 0) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2;
            const tx = (a.x - a.vx * mid) - (b.x - b.vx * mid);
            const ty = (a.y - a.vy * mid) - (b.y - b.vy * mid);
            (Math.hypot(tx, ty) < 2 * ballRadius) ? (lo = mid) : (hi = mid);
        }
        a.x -= a.vx * lo; a.y -= a.vy * lo;
        b.x -= b.vx * lo; b.y -= b.vy * lo;
    }

    const dx2 = b.x - a.x, dy2 = b.y - a.y;
    const dist2 = Math.hypot(dx2, dy2) || 1;
    const nx = dx2 / dist2, ny = dy2 / dist2;

    // Push apart to remove residual overlap
    const overlap = 2 * ballRadius - dist2;
    if (overlap > 0) {
        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2; b.y += ny * overlap / 2;
    }

    const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
    const vn = dvx * nx + dvy * ny;
    if (vn <= 0) return;
    a.vx -= vn * nx; a.vy -= vn * ny;
    b.vx += vn * nx; b.vy += vn * ny;
    
    // Call collision callback (sound effects handled there)
    if (onCollide) onCollide(Math.abs(vn));
    if (a.isCue || b.isCue) return true; // hitBall flag
}

export function nearPocket(b, pockets, ballRadius) {
    const POCKET_R = 30;
    for (const p of pockets)
        if (Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R + ballRadius * 0.5) return true;
    return false;
}

export function wallCollide(b, felt, ballRadius, onWallBounce) {
    const POCKET_R = 30;
    const { x: Fx, y: Fy, w: Fw, h: Fh } = felt;
    const FX2 = Fx + Fw;
    const FY2 = Fy + Fh;
    const e = 0.88;
    let bounced = false, speed = 0;
    
    if (nearPocket(b, getPockets(felt), ballRadius)) return;
    
    if (b.x - ballRadius < Fx)  { b.x = Fx + ballRadius; speed = Math.abs(b.vx); b.vx = -b.vx * e; bounced = true; }
    if (b.x + ballRadius > FX2)  { b.x = FX2 - ballRadius; speed = Math.abs(b.vx); b.vx = -b.vx * e; bounced = true; }
    if (b.y - ballRadius < Fy)  { b.y = Fy + ballRadius; speed = Math.abs(b.vy); b.vy = -b.vy * e; bounced = true; }
    if (b.y + ballRadius > FY2)  { b.y = FY2 - ballRadius; speed = Math.abs(b.vy); b.vy = -b.vy * e; bounced = true; }
    if (bounced && speed > 0.6 && onWallBounce) onWallBounce(speed);
}

export function checkPocket(b, pockets, ballRadius) {
    const POCKET_R = 30;
    for (const p of pockets) {
        if (Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R) {
            b.potted = true; b.vx = 0; b.vy = 0; return true;
        }
    }
    return false;
}

export function getPockets(felt) {
    const { x: Fx, y: Fy, w: Fw, h: Fh } = felt;
    const FX2 = Fx + Fw;
    const FY2 = Fy + Fh;
    const POCKET_R = 30;
    
    return [
        { x: Fx,         y: Fy   },
        { x: Fx + Fw / 2, y: Fy   },
        { x: FX2,        y: Fy   },
        { x: Fx,         y: FY2  },
        { x: Fx + Fw / 2, y: FY2  },
        { x: FX2,        y: FY2  },
    ];
}

export function updatePhysics(state, felt, ballRadius, callbacks) {
    // state has balls array
    // callbacks: { onBallCollide, onWallBounce, onPocket }
    
    stepBalls(state.balls, 0.986, 0.12);
    
    for (let i = 0; i < state.balls.length; i++) {
        for (let j = i + 1; j < state.balls.length; j++) {
            const a = state.balls[i], b = state.balls[j];
            if (a.potted || b.potted) continue;
            const hitBall = collideBalls(a, b, ballRadius, callbacks.onBallCollide);
            if (hitBall) state.hitBall = true;
        }
    }
    
    for (const b of state.balls) {
        if (!b.potted) wallCollide(b, felt, ballRadius, callbacks.onWallBounce);
    }
    
    for (const b of state.balls) {
        if (!b.potted && checkPocket(b, getPockets(felt), ballRadius)) {
            if (callbacks.onPocket) callbacks.onPocket(b);
        }
    }
    
    const moving = state.balls.some(b => !b.potted && (b.vx !== 0 || b.vy !== 0));
    if (state.moving && !moving) {
        state.moving = false;
        if (callbacks.onShotEnd) callbacks.onShotEnd();
    }
}
