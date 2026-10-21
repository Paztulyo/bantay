// Drawers burn away when they close: a ragged line of fire climbs the panel from the bottom, the paper browns and chars
// just ahead of it, and what burns goes up as sparks and smoke, the last embers crackling out after. Whatever closes a
// drawer (its Close button, Escape, a tap outside) still just sets `hidden`, so the open and close logic in app.js and
// guide.js stays as it is. This module notices, leaves a frozen, inert copy of the drawer where it was, clips that copy
// away behind the fire line, and draws the fire, sparks and smoke on a canvas over it. The panel is gone in about a
// second. Opening any drawer puts out a fire still burning. With reduced motion, or in a background tab, drawers simply
// close.
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');
const MAX_MS = 3400; // the whole effect, with a margin; a safety net if frames stall
const TAU = Math.PI * 2;
const runs = new Set();

// light or dark theme, read from the panel colour the stylesheet set
function darkTheme() {
  const m = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return matchMedia('(prefers-color-scheme: dark)').matches;
  const n = parseInt(m[1], 16);
  return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255 < 0.5;
}
// a lumpy wisp of smoke: a few soft blobs clustered off-centre, so stamped and turned it never reads as a circle
function puff(rgb, seed, size = 96) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 6; i++) {
    const cx = size * (0.32 + rnd() * 0.36), cy = size * (0.3 + rnd() * 0.4), r = size * (0.14 + rnd() * 0.2);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb},${0.5 + rnd() * 0.3})`); g.addColorStop(0.6, `rgba(${rgb},0.18)`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(0, 0, size, size);
  }
  return c;
}
// a soft tongue of flame, rooted at its bottom edge: a tall orange glow, a yellow core and a white-hot root
function flame() {
  const w = 40, h = 96, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const blob = (cy, ry, rgb, a) => {
    x.save(); x.translate(w / 2, cy); x.scale(1, ry / (w / 2));
    const g = x.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.45, `rgba(${rgb},${a * 0.5})`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, w / 2, 0, TAU); x.fill(); x.restore();
  };
  blob(h * 0.58, h * 0.42, '255,92,14', 0.8);
  blob(h * 0.74, h * 0.24, '255,176,58', 0.9);
  blob(h * 0.86, h * 0.13, '255,240,196', 0.95);
  return c;
}
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function burn(dr, scrollTop, onEnd) {
  const ghost = dr.cloneNode(true);
  ghost.hidden = false; ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true'); ghost.classList.add('drawer-ghost');
  ghost.querySelectorAll('[id]').forEach(e => e.removeAttribute('id')); // the root keeps its id for its layout rules
  document.body.appendChild(ghost);
  const panel = ghost.querySelector('.drawer-c') || ghost;
  panel.scrollTop = scrollTop;
  const r = panel.getBoundingClientRect();

  // sparks are fine points, so the canvas follows the screen's density (capped, and a little under it)
  const cv = document.createElement('canvas');
  cv.className = 'smoke-cv'; cv.setAttribute('aria-hidden', 'true');
  const W = innerWidth, H = innerHeight, K = Math.min(2, Math.max(1, devicePixelRatio || 1)) * 0.7;
  cv.width = Math.ceil(W * K); cv.height = Math.ceil(H * K);
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d'); ctx.scale(K, K);
  const dark = darkTheme();
  const smoke = [1, 2, 3].map(k => puff(dark ? '172,174,168' : '98,94,88', k));
  const fire = flame();

  // The fire line, one point per column. A column only ever climbs (paper doesn't un-burn). The front advances across
  // the whole width; along it, two smooth random fields set how ragged the edge starts out and which stretches race
  // ahead as it climbs, so the tongues of fire grow and change on the way up instead of sliding up as one shape. It
  // starts just under the panel, speeds up as it climbs, and ends just over the top.
  const A = clamp(r.width / 40, 9, 18); // how ragged the edge is, px
  const cols = Math.max(32, Math.round(r.width / 8)), step = r.width / cols;
  const X = i => r.left + i * step;
  const span = r.height + A * 5.5;
  const DUR = 1000 * clamp(0.62 + r.height / 1700, 0.8, 1.2);
  const P = Array.from({ length: 6 }, () => rand(0, TAU)), S = (x, w, ph) => Math.sin(TAU * x / w + ph);
  const shape = new Float32Array(cols + 1), race = new Float32Array(cols + 1), fph = new Float32Array(cols + 1), fjx = new Float32Array(cols + 1);
  for (let i = 0; i <= cols; i++) {
    const x = i * step;
    shape[i] = 1.2 * Math.pow(Math.max(0, S(x, 240, P[0])), 1.5) + 0.5 * S(x, 97, P[1]) + 0.3 * S(x, 41, P[2]) + 0.13 * S(x, 17, P[3]) + rand(-0.2, 0.2);
    race[i] = 0.6 * S(x, 180, P[4]) + 0.4 * S(x, 73, P[5]);
    fph[i] = rand(0, TAU); fjx[i] = rand(-step, step);
  }
  const cur = new Float32Array(cols + 1).fill(r.bottom + A * 6);

  // embers cool from white-hot through orange to deep red; on a light page they end as grey ash, on a dark one they fade
  const HOT = dark ? [[255, 244, 190], [255, 160, 50], [222, 64, 12], [120, 30, 8]] : [[255, 196, 60], [240, 116, 22], [184, 52, 16], [96, 86, 80]];
  const heat = h => { const v = (1 - h) * 3, k = Math.min(2, v | 0), f = v - k, a = HOT[k], b = HOT[k + 1]; return a.map((c, j) => Math.round(c + (b[j] - c) * f)).join(','); };
  const sparks = [], puffs = [];
  const spark = (x, y, big) => sparks.push({ x, y, big, vx: rand(-30, 30), vy: -rand(40, big ? 110 : 180), life: big ? rand(0.8, 1.4) : rand(0.4, 1), age: 0, r: big ? rand(1.7, 2.6) : rand(0.6, 1.4), f: rand(0, TAU) });
  const smokeAt = (x, y, big) => puffs.push({ x, y, vx: rand(-12, 12), vy: -rand(28, 62), r: rand(18, 34) * (big ? 1.4 : 1), life: rand(0.9, 1.6), age: 0, a: (dark ? 0.1 : 0.085) + rand(0, 0.05), k: (Math.random() * 3) | 0, rot: rand(0, TAU), spin: rand(-0.5, 0.5) });
  const line = dy => { ctx.beginPath(); for (let i = 0; i <= cols; i++) { const y = cur[i] + dy; if (i) ctx.lineTo(X(i), y); else ctx.moveTo(X(i), y); } };
  // the copy keeps what's above the line; the margin keeps its shadow until the fire gets there
  const M = 90, fx = v => v.toFixed(1) + 'px';
  function clip() {
    const y = i => fx(clamp(cur[i] - r.top, -M, r.height + M));
    let s = `polygon(${-M}px ${-M}px,${fx(r.width + M)} ${-M}px,${fx(r.width + M)} ${y(cols)}`;
    for (let i = cols; i >= 0; i--) s += `,${fx(X(i) - r.left)} ${y(i)}`;
    panel.style.clipPath = s + `,${-M}px ${y(0)})`;
  }

  const t0 = performance.now();
  let raf = 0, done = false, last = t0, burnt = false;
  function frame(now) {
    const t = (now - t0) / 1000, dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    if (!burnt) {
      const u = Math.min(1, (now - t0) / DUR), e = u * (0.3 + 0.7 * u);
      const base = r.bottom + A * 2.5 - span * e;
      for (let i = 0; i <= cols; i++) cur[i] = Math.min(cur[i], base - A * (shape[i] + 1.2 * u * race[i] + 0.12 * Math.sin(t * 9 + fph[i])));
      clip();
      // sparks and smoke come off the burning stretch of the edge, mostly from the flame tips
      const live = [];
      for (let i = 0; i <= cols; i++) if (cur[i] < r.bottom && cur[i] > r.top) live.push(i);
      if (live.length) {
        const k = r.width / 600 + 0.35;
        let nS = 90 * k * dt, nP = 14 * k * dt;
        for (; nS > 0 && sparks.length < 220; nS--) { if (nS < 1 && Math.random() > nS) break; const i = live[(Math.random() * live.length) | 0]; spark(X(i) + rand(-4, 4), cur[i] - rand(0, A), Math.random() < 0.12); }
        for (; nP > 0 && puffs.length < 60; nP--) { if (nP < 1 && Math.random() > nP) break; const i = live[(Math.random() * live.length) | 0]; smokeAt(X(i), cur[i] - A * 0.6); }
      }
      // the last of it goes up at the top edge
      if (u >= 1 || Math.max(...cur) < r.top - A) {
        burnt = true; ghost.remove();
        for (let i = 0; i < 22; i++) spark(rand(r.left, r.right), r.top + rand(-4, 6), Math.random() < 0.25);
        for (let i = 0; i < 6; i++) smokeAt(rand(r.left, r.right), r.top, true);
      }
    }

    ctx.clearRect(0, 0, W, H);
    // smoke under the fire
    for (let j = puffs.length - 1; j >= 0; j--) {
      const q = puffs[j]; q.age += dt; const v = q.age / q.life;
      if (v >= 1) { puffs.splice(j, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      const rad = q.r * (1 + 1.5 * v);
      ctx.globalAlpha = q.a * (v < 0.15 ? v / 0.15 : Math.pow(1 - (v - 0.15) / 0.85, 1.3));
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot + q.spin * q.age); ctx.drawImage(smoke[q.k], -rad, -rad, rad * 2, rad * 2); ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (!burnt) {
      // the paper browns ahead of the fire and chars black at the edge (painted only on what's left of it)
      ctx.save();
      ctx.beginPath(); ctx.rect(r.left, r.top, r.width, r.height); ctx.clip();
      ctx.beginPath(); ctx.moveTo(r.left - 8, r.top - 80); ctx.lineTo(r.right + 8, r.top - 80);
      for (let i = cols; i >= 0; i--) ctx.lineTo(X(i), cur[i]);
      ctx.closePath(); ctx.clip();
      ctx.lineJoin = 'round';
      const band = (dy, w, col, blur) => { line(dy); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.shadowColor = col; ctx.shadowBlur = blur; ctx.stroke(); };
      band(-15, 22, dark ? 'rgba(40,20,6,0.3)' : 'rgba(132,78,24,0.16)', 12);
      band(-5, 9, dark ? 'rgba(6,3,1,0.92)' : 'rgba(36,18,6,0.86)', 4);
      ctx.restore();
      // the burning edge: a glow, small flames licking up off it, and a white-hot line
      ctx.save();
      ctx.beginPath(); ctx.rect(r.left - 4, r.top - 40, r.width + 8, r.height + 44); ctx.clip();
      ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round';
      line(0); ctx.strokeStyle = 'rgba(255,104,18,0.9)'; ctx.lineWidth = 4; ctx.shadowColor = 'rgba(255,84,0,1)'; ctx.shadowBlur = 12; ctx.stroke();
      ctx.shadowBlur = 0;
      const fw = step * 2.6;
      for (let i = 2; i <= cols; i += 4) {
        const y = cur[i], vis = Math.min(1, (y - r.top + A) / (2 * A), (r.bottom + A - y) / (2 * A));
        if (vis <= 0) continue;
        const f = 0.5 + 0.5 * Math.sin(t * 13 + fph[i]) * Math.cos(t * 7.7 + fph[i] * 1.7), fh = A * (0.6 + 1.2 * f);
        ctx.globalAlpha = vis * (0.6 + 0.4 * f);
        ctx.drawImage(fire, X(i) + fjx[i] - fw / 2, y + 2 - fh, fw, fh);
      }
      ctx.globalAlpha = 1;
      line(0); ctx.strokeStyle = 'rgba(255,236,180,0.95)'; ctx.lineWidth = 1.4; ctx.shadowColor = 'rgba(255,200,90,1)'; ctx.shadowBlur = 4; ctx.stroke();
      ctx.restore();
    }
    // embers: hot points that rise, wander, cool and blink out; the bigger ones crackle apart as they go
    ctx.save(); ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'; ctx.lineCap = 'round';
    for (let j = sparks.length - 1; j >= 0; j--) {
      const s = sparks[j]; s.age += dt; const h = 1 - s.age / s.life;
      if (h <= 0) {
        sparks.splice(j, 1);
        if (s.big && Math.random() < 0.6) for (let n = 0; n < 3; n++) sparks.push({ x: s.x, y: s.y, big: false, vx: rand(-80, 80), vy: rand(-100, 10), life: rand(0.12, 0.3), age: 0, r: rand(0.5, 1), f: rand(0, TAU) });
        continue;
      }
      s.vy -= 30 * dt; s.vx += rand(-90, 90) * dt; s.vx *= Math.pow(0.4, dt);
      s.x += s.vx * dt; s.y += s.vy * dt;
      const tw = 0.7 + 0.3 * Math.sin(s.f + s.age * 30), c = heat(h), a = Math.min(1, (0.35 + 0.65 * h) * tw);
      if (dark && h > 0.3) { ctx.fillStyle = `rgba(${c},${(0.16 * a).toFixed(3)})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 3.2, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = `rgba(${c},${a.toFixed(3)})`; ctx.lineWidth = 2 * s.r * (0.6 + 0.4 * h);
      ctx.beginPath(); ctx.moveTo(s.x - s.vx * 0.016, s.y - s.vy * 0.016); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
    ctx.restore();

    if ((burnt && !sparks.length && !puffs.length) || now - t0 > MAX_MS) stop();
    else raf = requestAnimationFrame(frame);
  }
  const run = {
    stop() {
      if (done) return;
      done = true; cancelAnimationFrame(raf); clearTimeout(safety); runs.delete(run);
      cv.remove(); ghost.remove(); onEnd();
    },
  };
  const stop = run.stop;
  const safety = setTimeout(stop, MAX_MS);
  runs.add(run);
  raf = requestAnimationFrame(frame);
  return run;
}

function watch(dr) {
  let top = 0, run = null;
  // a hidden panel reports scrollTop 0, so remember where it was scrolled to while it is open
  dr.addEventListener('scroll', e => { if (e.target.classList && e.target.classList.contains('drawer-c')) top = e.target.scrollTop; }, true);
  new MutationObserver(() => {
    if (!dr.hidden) { // a drawer opened: put out any fire, so what was asked for shows at once
      [...runs].forEach(x => x.stop());
      requestAnimationFrame(() => { const p = dr.querySelector('.drawer-c'); top = p ? p.scrollTop : 0; });
      return;
    }
    if (run || REDUCE.matches || document.hidden) return;
    run = burn(dr, top, () => { run = null; });
  }).observe(dr, { attributes: true, attributeFilter: ['hidden'] });
}

document.querySelectorAll('.drawer').forEach(watch);
