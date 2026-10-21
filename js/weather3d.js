// Weather drawn over the 3D map, one patch per town, from Open-Meteo: the current conditions, or a forecast day
// picked in the weather card. Rain streaks, storm flashes, cloud, low fog, sunlight and heat haze. It renders on its
// own transparent canvas with the map's camera, between the terrain and the HTML labels, so animating it never
// redraws the terrain and the labels always stay on top. A forecast's rain is thinned by its chance of rain.
import { AREA } from './map3d.js';
import { TEST } from './util.js';

const PPD = 1500, LONC = (AREA[0] + AREA[2]) / 2, LATC = (AREA[1] + AREA[3]) / 2;
const KX = 111.32 * Math.cos(LATC * Math.PI / 180), KZ = 110.574;
const MOBILE = matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad/.test(navigator.userAgent);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000003) / 1000003; }; }
const hashStr = str => { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// soft sprites drawn once on a canvas: a cloud puff, a long mist bank, a round glow
function softTexture(kind) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = kind === 'mist' ? 96 : 256;
  const g = cv.getContext('2d');
  const blob = (x, y, r, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  if (kind === 'puff') {
    const R = rng(7); for (let i = 0; i < 11; i++) blob(62 + R() * 132, 96 + R() * 70, 34 + R() * 40, 0.42);
    // shade the underside so a puff reads as volume, not haze
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, 90, 0, 230); sh.addColorStop(0, 'rgba(120,135,142,0)'); sh.addColorStop(1, 'rgba(120,135,142,0.55)');
    g.fillStyle = sh; g.fillRect(0, 0, 256, 256); g.globalCompositeOperation = 'source-over';
  }
  else if (kind === 'mist') { const R = rng(11); for (let i = 0; i < 14; i++) blob(26 + R() * 204, 40 + R() * 18, 22 + R() * 26, 0.3); }
  else if (kind === 'sun') { // a warm disc in a soft halo
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,251,230,1)'); gr.addColorStop(0.2, 'rgba(255,224,130,1)'); gr.addColorStop(0.29, 'rgba(255,200,92,0.5)');
    gr.addColorStop(0.55, 'rgba(255,190,84,0.14)'); gr.addColorStop(1, 'rgba(255,190,84,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }
  else if (kind === 'rays') { // eight short rounded rays around an open middle, like the card's sun; the sprite turns slowly
    g.translate(128, 128); g.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      g.rotate(Math.PI / 4);
      const gr = g.createLinearGradient(0, -60, 0, -112); gr.addColorStop(0, 'rgba(255,204,88,1)'); gr.addColorStop(1, 'rgba(255,204,88,0.3)');
      g.strokeStyle = gr; g.lineWidth = 16; g.beginPath(); g.moveTo(0, -64); g.lineTo(0, -104); g.stroke();
    }
  }
  else blob(128, 128, 126, 0.85);
  const t = new THREE.CanvasTexture(cv); t.needsUpdate = true;
  return t;
}

const RAIN_VS = `
  attribute vec4 aDrop; uniform float uTime, uSize, uScale; varying float vA;
  void main(){
    float t = fract(uTime * aDrop.y + aDrop.x);
    vec3 p = vec3(position.x + (t - 0.5) * 0.22, mix(aDrop.w, aDrop.z, t), position.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uScale / -mv.z, 3.0, 56.0);
    vA = smoothstep(0.0, 0.14, t) * (1.0 - smoothstep(0.84, 1.0, t));
  }`;
const RAIN_FS = `
  uniform vec3 uColor; uniform float uOpacity; varying float vA;
  void main(){
    vec2 pc = gl_PointCoord - 0.5;
    float a = (1.0 - smoothstep(0.02, 0.06, abs(pc.x + pc.y * 0.14))) * (1.0 - smoothstep(0.2, 0.5, abs(pc.y))) * vA * uOpacity;
    if (a < 0.012) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

const RAINY = new Set(['drizzle', 'rain', 'storm']);
const PALETTE = {
  light: { rain: 0x2f6688, rainA: 0.4, cloud: 0xffffff, cloudRain: 0xd0d8dc, cloudStorm: 0xa3aeb5, fog: 0xffffff, heat: 0xff8a3d, sunA: 0.95, sunHot: 0xffb27a, flash: 0xfffbe6, cloudK: 1, fogA: 0.42 },
  dark: { rain: 0xb7d8ea, rainA: 0.36, cloud: 0xd3ddd8, cloudRain: 0xaab6ba, cloudStorm: 0x8e9ca5, fog: 0xe2ebe6, heat: 0xffa45e, sunA: 0.85, sunHot: 0xffb27a, flash: 0xffffff, cloudK: 0.6, fogA: 0.3 },
};

export function createWeather3D(G, towns) {
  const host = G.renderer.domElement.parentElement;
  const cv = document.createElement('canvas'); cv.className = 'wx3d'; cv.setAttribute('aria-hidden', 'true');
  host.insertBefore(cv, G.renderer.domElement.nextSibling);
  const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.5 : 2));
  const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
  const TEX = { puff: softTexture('puff'), mist: softTexture('mist'), glow: softTexture('glow'), sun: softTexture('sun'), rays: softTexture('rays') };
  const rainMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSize: { value: 0.85 }, uScale: { value: 900 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.55 } },
    vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, depthTest: false,
  });
  const boltMat = new THREE.LineMaterial({ color: 0xfff6c8, linewidth: 2.2, transparent: true, opacity: 0, depthTest: false });
  const bolt = new THREE.LineSegments2(new THREE.LineSegmentsGeometry(), boltMat); bolt.visible = false; bolt.renderOrder = 8; bolt.frustumCulled = false;
  group.add(bolt);

  let relief = G.world.scale.y, data = null, enabled = true, inView = true, raf = 0, rain = null, W = 1, H = 1;
  let parts = [], storms = [], nextFlash = 0, flash = null, pal = PALETTE.light, hasRain = false, strikes = 0;
  const cOfX = x => (x / KX + LONC - AREA[0]) * PPD - 0.5, rOfZ = z => (z / KZ - LATC + AREA[3]) * PPD - 0.5;
  const ground = (x, z) => G.meshH(cOfX(x), rOfZ(z)) / 1000 * relief;
  const T = towns.map(t => ({ ...t, x: (t.lon - LONC) * KX, z: (LATC - t.lat) * KZ, rad: clamp(Math.sqrt((t.area || 60) / Math.PI) * 0.72, 2.6, 7.2) }));

  function resize() {
    const r = host.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false); boltMat.resolution.set(W, H);
  }
  new ResizeObserver(() => { resize(); draw(performance.now()); }).observe(host); resize();

  function themeNow() {
    const c = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--vp').trim() || '#e9efe7');
    pal = c.r + c.g + c.b < 1.0 ? PALETTE.dark : PALETTE.light;
  }
  function clear() {
    if (rain) { group.remove(rain); rain.geometry.dispose(); rain = null; }
    parts.forEach(p => { group.remove(p.obj); p.obj.material.dispose(); });
    parts = []; storms = []; flash = null; bolt.visible = false;
  }
  function sprite(tex, color, opacity, x, y, z, w, h, info) {
    const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, depthTest: false });
    const s = new THREE.Sprite(m); s.position.set(x, y, z); s.scale.set(w, h, 1); s.renderOrder = info.order || 5;
    group.add(s); const p = { obj: s, bx: x, bz: z, a0: opacity, w0: w, h0: h, ...info }; parts.push(p); return p;
  }

  function build() {
    clear(); themeNow(); relief = G.world.scale.y;
    if (data) {
      const lift = relief / 1.8; // heights follow the relief slider
      const pos = [], drop = [];
      for (const t of T) {
        const w = data[t.n]; if (!w) continue;
        const R = rng(hashStr(t.n)), gy = ground(t.x, t.z), k = w.k, chance = w.chance == null ? 1 : clamp(w.chance, 0, 1);
        // cloud deck: more and thicker puffs as cover rises; darker over rain and storms, lighter when rain is unlikely
        const nCloud = k === 'partly' ? 2 : k === 'cloudy' ? 4 : RAINY.has(k) ? 5 : k === 'fog' ? 2 : 0;
        const col = k === 'storm' ? pal.cloudStorm : RAINY.has(k) ? pal.cloudRain : pal.cloud;
        const a = pal.cloudK * (k === 'partly' ? 0.4 : k === 'cloudy' ? 0.55 : k === 'storm' ? 0.82 : RAINY.has(k) ? 0.68 : 0.32) * (RAINY.has(k) ? 0.75 + 0.25 * chance : 1);
        const top = gy + 2.5 * lift, townParts = [];
        for (let i = 0; i < nCloud; i++) {
          const an = R() * Math.PI * 2, rr = t.rad * 0.75 * Math.sqrt(R()), wv = (2.8 + R() * 2.4) * clamp(t.rad / 4.5, 0.8, 1.35);
          townParts.push(sprite(TEX.puff, col, a * (0.75 + R() * 0.35), t.x + Math.cos(an) * rr, top + (R() - 0.3) * 0.5 * lift, t.z + Math.sin(an) * rr, wv, wv * 0.62,
            { kind: 'cloud', sp: 0.05 + R() * 0.07, ph: R() * 6.28, amp: 0.35 + R() * 0.5, col }));
        }
        if (k === 'fog') { // low mist banks that sit over the town
          for (let i = 0; i < 4; i++) {
            const an = R() * Math.PI * 2, rr = t.rad * 0.8 * Math.sqrt(R()), x = t.x + Math.cos(an) * rr, z = t.z + Math.sin(an) * rr, wv = 5.5 + R() * 3.5;
            sprite(TEX.mist, pal.fog, pal.fogA * (0.8 + R() * 0.3), x, ground(x, z) + (0.12 + R() * 0.3) * lift, z, wv, wv * 0.3,
              { kind: 'fog', sp: 0.03 + R() * 0.04, ph: R() * 6.28, amp: 0.6 + R() * 0.6, order: 4 });
          }
        }
        if (w.hot) sprite(TEX.glow, pal.heat, pal === PALETTE.dark ? 0.2 : 0.24, t.x, gy + 0.35 * lift, t.z, t.rad * 1.9, t.rad * 1.2, { kind: 'heat', sp: 0.6, ph: R() * 6.28, amp: 0, order: 3 });
        // a sun over clear and broken-cloud towns by day, so a dry day reads as sun rather than as no weather at all;
        // it sits just above the cloud deck, half hidden behind the puffs on a partly cloudy day, and runs hotter when it is hot
        if (w.day !== 0 && (k === 'clear' || k === 'partly')) {
          const part = k === 'partly', d = clamp(t.rad * 0.95, 3.2, 5) * (part ? 0.8 : 1) * clamp(lift, 0.85, 1.25), tint = w.hot ? pal.sunHot : 0xffffff;
          const sx = t.x - (part ? t.rad * 0.22 : 0), sy = top + 0.3 * lift, sz = t.z - (part ? t.rad * 0.12 : 0);
          sprite(TEX.rays, tint, pal.sunA, sx, sy, sz, d * 2.3, d * 2.3, { kind: 'rays', spin: (R() < 0.5 ? -1 : 1) * (0.1 + R() * 0.05), ph: R() * 6.28, order: 4 });
          sprite(TEX.sun, tint, Math.min(1, pal.sunA + 0.15), sx, sy, sz, d * 1.7, d * 1.7, { kind: 'sun', sp: 0.9, ph: R() * 6.28, amp: 0, order: 4 });
        }
        if (RAINY.has(k)) {
          const n = Math.round((MOBILE ? 240 : 460) * (0.35 + (w.i || 0.4)) * clamp(t.rad / 5, 0.7, 1.4) * (0.2 + 0.8 * chance));
          for (let i = 0; i < n; i++) {
            const an = R() * Math.PI * 2, rr = t.rad * 0.78 * Math.sqrt(R());
            const x = t.x + Math.cos(an) * rr, z = t.z + Math.sin(an) * rr, g = ground(x, z);
            pos.push(x, 0, z);
            drop.push(R(), (0.5 + R() * 0.35) * (k === 'drizzle' ? 0.55 : 1), g + 0.02, Math.max(top - 0.15 * lift, g + 0.6) - R() * 0.25 * lift);
          }
        }
        if (k === 'storm') storms.push({ t, top, parts: townParts });
      }
      hasRain = pos.length > 0;
      if (hasRain) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('aDrop', new THREE.Float32BufferAttribute(drop, 4));
        rain = new THREE.Points(geo, rainMat); rain.frustumCulled = false; rain.renderOrder = 6; group.add(rain);
      }
      rainMat.uniforms.uColor.value.set(pal.rain); rainMat.uniforms.uOpacity.value = pal.rainA;
      rainMat.uniforms.uSize.value = 0.85 * lift + 0.15;
      boltMat.color.set(pal.flash);
    }
    draw(performance.now()); kick();
  }

  function makeBolt(s) { // a jagged strike from the cloud base to a random spot in the town
    const R = Math.random, an = R() * Math.PI * 2, rr = s.t.rad * 0.5 * Math.sqrt(R());
    const gx = s.t.x + Math.cos(an) * rr, gz = s.t.z + Math.sin(an) * rr, gy = ground(gx, gz);
    const sx = gx + (R() - 0.5), sz = gz + (R() - 0.5), sy = s.top - 0.1, steps = 9, pts = [];
    let px = sx, py = sy, pz = sz;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps, j = (1 - f * 0.6) * 0.5;
      const qx = i === steps ? gx : sx + (gx - sx) * f + (R() - 0.5) * j;
      const qz = i === steps ? gz : sz + (gz - sz) * f + (R() - 0.5) * j;
      pts.push(px, py, pz, qx, sy + (gy - sy) * f, qz); px = qx; py = sy + (gy - sy) * f; pz = qz;
    }
    bolt.geometry.dispose(); bolt.geometry = new THREE.LineSegmentsGeometry(); bolt.geometry.setPositions(pts);
    strikes++;
  }

  const shown = () => enabled && !G.renderer.domElement.hidden && (parts.length > 0 || hasRain);
  function draw(now) {
    cv.hidden = !shown();
    if (cv.hidden) return;
    if (Math.abs(G.world.scale.y - relief) > 1e-3) { build(); return; }
    const s = now / 1000;
    rainMat.uniforms.uTime.value = REDUCED ? 0 : s;
    rainMat.uniforms.uScale.value = H * renderer.getPixelRatio() / (2 * Math.tan(G.camera.fov * Math.PI / 360));
    // streaks shrink with distance, so lift their opacity a little in the wide view
    const far = clamp((G.camera.position.distanceTo(G.controls.target) - 50) / 70, 0, 1);
    rainMat.uniforms.uOpacity.value = pal.rainA * (1 + 0.4 * far);
    if (!REDUCED) for (const p of parts) {
      if (p.kind === 'heat') { p.obj.material.opacity = p.a0 * (0.8 + 0.2 * Math.sin(s * p.sp + p.ph)); continue; }
      if (p.kind === 'sun') { const b = Math.sin(s * p.sp + p.ph); p.obj.material.opacity = p.a0 * (0.88 + 0.12 * b); p.obj.scale.set(p.w0 * (1 + 0.04 * b), p.h0 * (1 + 0.04 * b), 1); continue; }
      if (p.kind === 'rays') { p.obj.material.rotation = p.ph + s * p.spin; p.obj.material.opacity = p.a0 * (0.8 + 0.2 * Math.sin(s * 0.7 + p.ph)); continue; }
      p.obj.position.x = p.bx + Math.sin(s * p.sp + p.ph) * p.amp;
      p.obj.position.z = p.bz + Math.cos(s * p.sp * 0.8 + p.ph) * p.amp * 0.6;
    }
    // lightning: at most one strike every 1.8 s across the map, and none with reduced motion
    if (!REDUCED && storms.length) {
      if (!flash && now > nextFlash) { const st = storms[Math.floor(Math.random() * storms.length)]; makeBolt(st); flash = { st, t0: now }; }
      if (flash) {
        const e = (now - flash.t0) / 1000;
        const k = e < 0.07 ? 1 : e < 0.14 ? 0.2 : e < 0.22 ? 0.85 : Math.max(0, 1 - (e - 0.22) / 0.22);
        bolt.visible = e < 0.26; boltMat.opacity = bolt.visible ? 0.95 * k : 0;
        flash.st.parts.forEach(p => { p.obj.material.color.set(p.col).lerp(new THREE.Color(pal.flash), 0.75 * k); p.obj.material.opacity = Math.min(0.95, p.a0 + 0.3 * k); });
        if (e > 0.5) { flash.st.parts.forEach(p => { p.obj.material.color.set(p.col); p.obj.material.opacity = p.a0; }); bolt.visible = false; flash = null; nextFlash = now + 1800 + Math.random() * 4200; }
      }
    }
    renderer.render(scene, G.camera);
  }
  // the overlay follows the map's camera every frame; it is cheap because only the weather is drawn
  // Rain animates at 30-40 fps; a camera move redraws at once so the weather never lags the terrain.
  const running = () => shown() && inView && !document.hidden && !REDUCED;
  const FRAME = TEST ? 250 : MOBILE ? 1000 / 30 : 1000 / 40, lastM = new Float64Array(16);
  let lastDraw = 0;
  function camMoved() {
    const e = G.camera.matrixWorld.elements; let moved = false;
    for (let i = 0; i < 16; i++) if (e[i] !== lastM[i]) { moved = true; lastM[i] = e[i]; }
    return moved;
  }
  function tick(now) {
    raf = 0;
    if (!running()) { draw(now); return; }
    raf = requestAnimationFrame(tick);
    if (camMoved() || now - lastDraw >= FRAME) { lastDraw = now; draw(now); }
  }
  function kick() { if (!raf && running()) raf = requestAnimationFrame(tick); }
  // with reduced motion there is no loop, so redraw whenever the camera moves
  G.controls.addEventListener('change', () => { if (REDUCED || !raf) requestAnimationFrame(t => draw(t)); });

  try { new IntersectionObserver(es => { inView = es.some(e => e.isIntersecting); kick(); }).observe(host); } catch (e) { /* always on */ }
  document.addEventListener('visibilitychange', kick);
  new MutationObserver(() => { draw(performance.now()); kick(); }).observe(G.renderer.domElement, { attributes: true, attributeFilter: ['hidden'] });
  const retheme = () => { if (data) build(); };
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme); } catch (e) { }
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // switching to another day fades the old weather out and the new one in, instead of popping
  let fadeT = 0;
  function swap(byTown, fade) {
    clearTimeout(fadeT);
    if (!fade || REDUCED) { data = byTown; cv.style.opacity = ''; build(); return; }
    cv.style.transition = 'opacity .18s ease-in'; cv.style.opacity = '0';
    fadeT = setTimeout(() => {
      data = byTown; build();
      fadeT = setTimeout(() => { cv.style.transition = 'opacity .38s ease-out'; cv.style.opacity = '1'; }, 20);
    }, cv.hidden ? 0 : 180);
  }

  return {
    update(byTown, opts = {}) { swap(byTown, !!opts.fade); },
    setEnabled(on) { enabled = !!on; draw(performance.now()); kick(); },
    get enabled() { return enabled; },
    stats: () => {
      const n = kind => parts.filter(p => p.kind === kind).length;
      return { parts: parts.length, clouds: n('cloud'), fog: n('fog'), sun: n('sun'), heat: n('heat'), drops: rain ? rain.geometry.attributes.position.count : 0, storms: storms.length, strikes, running: !!raf, shown: !cv.hidden, opacity: cv.style.opacity };
    },
  };
}
