(() => {
  'use strict';
  const W = 400, H = 560, DELAY = .7, TOTAL = 18;
  const PLAYER_Y = 464, SPEED = 178, GATE_HALF = 15, HIT_RADIUS = 11;
  const LANES = [[75, 145], [255, 325]];
  const C = { ink: '#071416', panel: '#0b2123', line: '#173a3c', mint: '#9cf6cf', orange: '#ffb878', pink: '#ff6686', pale: '#ecfff5', muted: '#729b95' };

  function normalizeSeed(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0 || 1;
    const value = String(seed || 'shadow-lag');
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return hash >>> 0 || 1;
  }
  function randomFor(seed) {
    let a = normalizeSeed(seed);
    return () => {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function generateWaves(seed) {
    const random = randomFor(seed);
    const waves = [];
    const opening = [[0, 0], [1, 1], [0, 1], [0, 0]];
    let previous = 0;
    for (let i = 0; i < TOTAL; i++) {
      let you, shadow;
      if (i < opening.length) [you, shadow] = opening[i];
      else {
        // Alternating the leading lane keeps every reverse gate solvable with
        // one well-timed switch. A following sync gate lets the shadow settle.
        const opposite = i % 3 === 2 || (i > 9 && random() < .3);
        you = opposite ? 1 - previous : (random() < .6 ? 1 - previous : previous);
        shadow = opposite ? 1 - you : you;
      }
      previous = you;
      waves.push({ id: i, at: 3.1 + i * 1.85, safe: [you, shadow], kind: you === shadow ? 'sync' : 'reverse' });
    }
    return waves;
  }
  function gateY(wave, time) { return PLAYER_Y - (wave.at - time) * SPEED; }
  function isGateCollision(wave, time, lanes) {
    return Math.abs(gateY(wave, time) - PLAYER_Y) <= GATE_HALF + HIT_RADIUS &&
      (lanes[0] !== wave.safe[0] || lanes[1] !== wave.safe[1]);
  }
  function rounded(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
  }

  class ShadowGame {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      if (!this.ctx) throw new Error('Canvas 2D is unavailable');
      this.callbacks = options;
      this.sound = false;
      this.audio = null;
      this.raf = null;
      this.active = false;
      this.paused = false;
      this.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.seed = 1;
      this._reset();
      this._frame = this._frame.bind(this);
      this._draw();
    }
    _reset() {
      this.time = 0;
      this.score = 0;
      this.lives = 3;
      this.passed = 0;
      this.lanes = [0, 0];
      this.visualLanes = [0, 0];
      this.queue = [];
      this.waves = generateWaves(this.seed).map(w => ({ ...w, safe: [...w.safe], hit: false, passed: false }));
      this.particles = [];
      this.flash = 0;
      this.tapFlash = 0;
      this.lastStamp = 0;
      this.lastUpdate = -1;
      this.ended = false;
      this.combo = 0;
      this.message = '';
      this.messageUntil = 0;
    }
    get state() {
      return { seed: this.seed, active: this.active, paused: this.paused, time: this.time, score: this.score,
        lives: this.lives, wave: this.passed, total: TOTAL, lanes: [...this.lanes],
        queue: this.queue.map(q => ({ ...q })), waves: this.waves.map(w => ({ ...w, safe: [...w.safe] })) };
    }
    start(seed) {
      this.stop();
      this.seed = normalizeSeed(seed);
      this._reset();
      this.active = true;
      this.paused = false;
      this._notify(true);
      this._draw();
      this.raf = requestAnimationFrame(this._frame);
    }
    action() {
      if (!this.active || this.paused || this.ended) return false;
      this.lanes[0] = 1 - this.lanes[0];
      this.queue.push({ at: this.time + DELAY, lane: this.lanes[0] });
      this.tapFlash = 1;
      this._tone(440 + this.lanes[0] * 110, .035, .025);
      if (this.callbacks.onPulse) this.callbacks.onPulse({ type: 'switch', lane: this.lanes[0] });
      return true;
    }
    pause() {
      if (!this.active || this.paused) return;
      this.paused = true;
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
      this._notify(true);
      this._draw();
    }
    resume() {
      if (!this.active || !this.paused || this.ended) return;
      this.paused = false;
      this.lastStamp = 0;
      this._notify(true);
      this.raf = requestAnimationFrame(this._frame);
    }
    stop() {
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.active = false;
      this.paused = false;
    }
    setSound(enabled) { this.sound = !!enabled; }
    _tone(frequency, duration, volume) {
      if (!this.sound) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!this.audio) this.audio = new AudioContext();
        if (this.audio.state === 'suspended') this.audio.resume().catch(() => {});
        const osc = this.audio.createOscillator(), gain = this.audio.createGain();
        osc.type = 'sine'; osc.frequency.value = frequency;
        gain.gain.setValueAtTime(volume, this.audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, this.audio.currentTime + duration);
        osc.connect(gain); gain.connect(this.audio.destination);
        osc.start(); osc.stop(this.audio.currentTime + duration);
      } catch (_) { /* Sound is optional, including in restricted WebViews. */ }
    }
    _notify(force = false) {
      if (!force && Math.floor(this.time * 10) === this.lastUpdate) return;
      this.lastUpdate = Math.floor(this.time * 10);
      if (this.callbacks.onUpdate) this.callbacks.onUpdate({ score: this.score, lives: this.lives,
        wave: this.passed, total: TOTAL, paused: this.paused, time: this.time, seed: this.seed });
    }
    _frame(stamp) {
      if (!this.active || this.paused) return;
      const dt = this.lastStamp ? Math.min(.08, Math.max(0, (stamp - this.lastStamp) / 1000)) : 0;
      this.lastStamp = stamp;
      let remain = dt;
      // Small simulation steps preserve queued inputs and collisions on slow phones.
      while (remain > 0 && this.active) {
        const step = Math.min(1 / 120, remain);
        this._step(step); remain -= step;
      }
      this._draw();
      this._notify();
      if (this.active && !this.paused) this.raf = requestAnimationFrame(this._frame);
    }
    _step(dt) {
      this.time += dt;
      while (this.queue.length && this.queue[0].at <= this.time) {
        this.lanes[1] = this.queue.shift().lane;
        this._burst(LANES[1][this.lanes[1]], PLAYER_Y, C.orange, 5);
      }
      const easing = this.reducedMotion ? 1 : Math.min(1, dt * 24);
      this.visualLanes[0] += (this.lanes[0] - this.visualLanes[0]) * easing;
      this.visualLanes[1] += (this.lanes[1] - this.visualLanes[1]) * easing;
      this.flash = Math.max(0, this.flash - dt * 3.5);
      this.tapFlash = Math.max(0, this.tapFlash - dt * 4);
      for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      this.particles = this.particles.filter(p => p.life > 0);
      for (const wave of this.waves) {
        if (wave.passed) continue;
        if (!wave.hit && isGateCollision(wave, this.time, this.lanes)) {
          wave.hit = true;
          this.lives--;
          this.combo = 0;
          this.flash = 1;
          this.message = this.lives === 1 ? '最后一颗心 · 稳住' : '慢半拍，也要一起过';
          this.messageUntil = this.time + 1.1;
          this._tone(130, .15, .08);
          for (let panel = 0; panel < 2; panel++) {
            if (this.lanes[panel] !== wave.safe[panel]) this._burst(LANES[panel][this.lanes[panel]], PLAYER_Y, C.pink, 15);
          }
          if (this.callbacks.onPulse) this.callbacks.onPulse({ type: 'hit', lives: this.lives });
          this._notify(true);
          if (this.lives <= 0) { this._finish(false); return; }
        }
        if (gateY(wave, this.time) > PLAYER_Y + GATE_HALF + HIT_RADIUS + 2) {
          wave.passed = true;
          this.passed++;
          if (!wave.hit) {
            this.score += 150;
            this.combo++;
            if (wave.kind === 'reverse') {
              this.message = '漂亮！骗过了 0.7 秒';
              this.messageUntil = this.time + .95;
            } else if (this.combo > 1) {
              this.message = this.combo + ' 连过';
              this.messageUntil = this.time + .7;
            }
            this._burst(110, PLAYER_Y - 8, C.mint, 7);
            this._burst(290, PLAYER_Y - 8, C.orange, 7);
            this._tone(wave.kind === 'reverse' ? 880 : 660, .065, .025);
            if (this.callbacks.onPulse) this.callbacks.onPulse({ type: 'pass', score: this.score, wave: this.passed });
          }
          this._notify(true);
          if (this.passed === TOTAL) { this._finish(true); return; }
        }
      }
    }
    _finish(won) {
      if (this.ended) return;
      this.ended = true;
      this.active = false;
      this.raf = null;
      this._draw();
      this._notify(true);
      if (this.callbacks.onEnd) this.callbacks.onEnd({ score: this.score, wave: this.passed, total: TOTAL,
        won, seed: this.seed, lives: this.lives, time: this.time });
    }
    _burst(x, y, color, count) {
      if (this.reducedMotion) return;
      for (let i = 0; i < count; i++) {
        const a = i * Math.PI * 2 / count;
        this.particles.push({ x, y, vx: Math.cos(a) * (30 + i * 3), vy: Math.sin(a) * (30 + i * 3), color, life: .4 });
      }
    }
    _fit() {
      const bounds = this.canvas.getBoundingClientRect();
      const width = bounds.width || W, height = bounds.height || width * H / W;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
        this.canvas.width = pixelWidth; this.canvas.height = pixelHeight;
      }
      this.ctx.setTransform(pixelWidth / W, 0, 0, pixelHeight / H, 0, 0);
    }
    _text(text, x, y, size, color, align = 'center', weight = 600) {
      const ctx = this.ctx;
      ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y);
    }
    _draw() {
      this._fit();
      const ctx = this.ctx;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
      this._text('现在的你', 110, 23, 13, C.mint);
      this._text('0.7 秒前的你', 290, 23, 13, C.orange);
      for (let panel = 0; panel < 2; panel++) {
        const x = panel === 0 ? 32 : 212;
        rounded(ctx, x, 45, 156, 466, 19); ctx.fillStyle = C.panel; ctx.fill();
        ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();
        ctx.save();
        rounded(ctx, x, 45, 156, 466, 19); ctx.clip();
        ctx.strokeStyle = '#153638'; ctx.lineWidth = 1;
        for (let gy = 70 + (this.time * SPEED % 45); gy < 530; gy += 45) {
          ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + 156, gy); ctx.stroke();
        }
        ctx.setLineDash([4, 9]); ctx.strokeStyle = '#254447';
        ctx.beginPath(); ctx.moveTo(x + 78, 45); ctx.lineTo(x + 78, 510); ctx.stroke(); ctx.setLineDash([]);
        // The landing line makes the exact danger window visible.
        ctx.fillStyle = panel ? '#ffb87809' : '#9cf6cf09'; ctx.fillRect(x, PLAYER_Y - 27, 156, 54);
        ctx.strokeStyle = panel ? '#ffb87836' : '#9cf6cf36';
        ctx.beginPath(); ctx.moveTo(x + 5, PLAYER_Y); ctx.lineTo(x + 151, PLAYER_Y); ctx.stroke();
        for (const wave of this.waves) {
          const y = gateY(wave, this.time);
          if (y < 58 || y > 535) continue;
          const safeLane = wave.safe[panel], blockX = LANES[panel][1 - safeLane];
          const faded = wave.hit || wave.passed;
          ctx.globalAlpha = faded ? .32 : 1;
          rounded(ctx, blockX - 29, y - GATE_HALF, 58, GATE_HALF * 2, 8);
          ctx.fillStyle = wave.hit ? '#765166' : '#ff6686'; ctx.fill();
          ctx.strokeStyle = '#ffb4c5'; ctx.lineWidth = 1; ctx.stroke();
          ctx.strokeStyle = '#751f3c'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(blockX - 5, y - 5); ctx.lineTo(blockX + 5, y + 5);
          ctx.moveTo(blockX + 5, y - 5); ctx.lineTo(blockX - 5, y + 5); ctx.stroke();
          const safeX = LANES[panel][safeLane];
          ctx.strokeStyle = panel ? '#ffb87870' : '#9cf6cf70'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(safeX - 8, y - 4); ctx.lineTo(safeX, y + 3); ctx.lineTo(safeX + 8, y - 4); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        const visualX = LANES[panel][0] + this.visualLanes[panel] * 70;
        this._avatar(visualX, PLAYER_Y, panel, this.flash > 0 && Math.floor(this.time * 14) % 2 === 0);
        ctx.restore();
      }
      // Tiny bridge in the gutter connects both worlds without obscuring lanes.
      ctx.strokeStyle = '#315251'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(190, PLAYER_Y); ctx.lineTo(210, PLAYER_Y); ctx.stroke(); ctx.setLineDash([]);
      for (const p of this.particles) {
        ctx.globalAlpha = Math.min(1, p.life * 3); ctx.fillStyle = p.color;
        rounded(ctx, p.x - 2, p.y - 2, 4, 4, 1); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const next = this.waves.find(w => !w.passed && gateY(w, this.time) < PLAYER_Y + 26);
      if (next && this.active) {
        const reverse = next.kind === 'reverse';
        const until = next.at - this.time;
        const label = reverse ? '错开过门' : '一起过门';
        rounded(ctx, 164, 56, 72, 24, 12); ctx.fillStyle = reverse ? '#513633' : '#163c35'; ctx.fill();
        this._text(label, 200, 68, 10, reverse ? C.orange : C.mint);
        if (until > .14 && until < 1.05 && reverse) {
          const radius = 14;
          ctx.strokeStyle = '#ffb87828'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(200, 426, radius, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = C.orange;
          ctx.beginPath(); ctx.arc(200, 426, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, until / 1.05))); ctx.stroke();
        }
      }
      // Inputs move from left to right over the same 0.7 s as the shadow.
      this._text('现在', 46, 536, 10, C.muted, 'left', 500);
      this._text('影子', 354, 536, 10, C.muted, 'right', 500);
      ctx.strokeStyle = '#294744'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(80, 536); ctx.lineTo(320, 536); ctx.stroke();
      for (const q of this.queue) {
        const progress = 1 - Math.max(0, (q.at - this.time) / DELAY);
        ctx.fillStyle = C.orange;
        ctx.beginPath(); ctx.arc(80 + 240 * progress, 536, 4, 0, Math.PI * 2); ctx.fill();
      }
      if (this.time < 2.5 && this.active) this._text('点一下换边，影子晚 0.7 秒照做', 200, 393, 12, C.pale);
      if (this.message && this.time < this.messageUntil) {
        rounded(ctx, 80, 105, 240, 30, 15); ctx.fillStyle = '#071416e8'; ctx.fill();
        this._text(this.message, 200, 120, 12, this.flash > .1 ? C.pink : C.mint);
      }
      if (this.flash > 0) {
        ctx.fillStyle = `rgba(255,60,100,${this.flash * .12})`; ctx.fillRect(0, 0, W, H);
      }
      if (this.paused) {
        ctx.fillStyle = '#071416bb'; ctx.fillRect(0, 0, W, H);
        this._text('时间暂停了', 200, 263, 23, C.pale);
        this._text('你的影子在等你', 200, 299, 13, C.muted);
      }
    }
    _avatar(x, y, panel, flash) {
      const ctx = this.ctx, color = flash ? C.pink : (panel ? C.orange : C.mint);
      const bob = this.reducedMotion ? 0 : Math.sin(this.time * 5 + panel) * 1.5;
      ctx.fillStyle = panel ? '#ffb87813' : '#9cf6cf13';
      ctx.beginPath(); ctx.ellipse(x, y + 19, 20, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(x, y + bob);
      if (this.tapFlash > 0 && !panel && !this.reducedMotion) ctx.scale(1 + this.tapFlash * .12, 1 - this.tapFlash * .08);
      ctx.fillStyle = color;
      rounded(ctx, -13, -15, 26, 30, panel ? 13 : 9); ctx.fill();
      // A clipped corner and tiny ears give the two avatars an identifiable silhouette.
      ctx.beginPath(); ctx.moveTo(-11, -10); ctx.lineTo(-12, -21); ctx.lineTo(-3, -14); ctx.fill();
      ctx.beginPath(); ctx.moveTo(11, -10); ctx.lineTo(12, -21); ctx.lineTo(3, -14); ctx.fill();
      ctx.fillStyle = '#103332';
      ctx.beginPath(); ctx.arc(-4, -3, 2, 0, Math.PI * 2); ctx.arc(4, -3, 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#103332'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 1, 3, .25, Math.PI - .25); ctx.stroke();
      ctx.restore();
    }
  }

  window.ShadowEngine = Object.freeze({ normalizeSeed, randomFor, generateWaves, gateY, isGateCollision,
    constants: Object.freeze({ W, H, DELAY, TOTAL, PLAYER_Y, SPEED, GATE_HALF, HIT_RADIUS }) });
  window.ShadowGame = ShadowGame;
})();
