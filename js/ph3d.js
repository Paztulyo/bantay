// The national map in 3D. Terrain from AWS Terrain Tiles (Terrarium) for the whole country, coloured by
// whatever the page is showing (PAGASA's dry stage, rain, heat), with fires as points and a Weather view that
// draws each province's forecast as cloud, rain, fog and sun. Tapping a province flies the camera in and loads
// sharper terrain for it. Relief is exaggerated more when zoomed out, so the mountains read at country scale.
// js/ph.js owns the data and the flat map; this module only draws. If WebGL or three.js is missing, the page
// keeps the flat map.
import { TEST } from './util.js';

const AREA = [116.8, 4.4, 126.8, 21.3]; // W S E N, the whole country (matches api/phfires.js)
const LONC = (AREA[0] + AREA[2]) / 2, LATC = (AREA[1] + AREA[3]) / 2;
const KX = 111.32 * Math.cos(LATC * Math.PI / 180), KZ = 110.574; // km per degree
const X = lon => (lon - LONC) * KX, Z = lat => (LATC - lat) * KZ;
const LON = x => x / KX + LONC, LAT = z => LATC - z / KZ;
const MOBILE = matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad/.test(navigator.userAgent);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const V = '0.147.0';
const THREE_URL = `https://cdn.jsdelivr.net/npm/three@${V}/build/three.min.js`;
const ORBIT_URL = `https://cdn.jsdelivr.net/npm/three@${V}/examples/js/controls/OrbitControls.js`;
const TILE_URL = TEST ? (z, x, y) => `/test-tiles/${z}/${x}/${y}.png` : (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------------- loading ---------------- */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = false; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => rej(new Error('could not load ' + src.split('/').pop()));
    document.head.append(s);
  });
}
export async function loadThree() {
  if (!window.THREE) await loadScript(THREE_URL);
  if (!THREE.OrbitControls) await loadScript(ORBIT_URL);
}
export function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
async function fetchBitmap(url) {
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}
function pixels(bmp) {
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  return cx.getImageData(0, 0, bmp.width, bmp.height).data;
}
const tileX = (lon, n) => (lon + 180) / 360 * n;
const tileY = (lat, n) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; };

// heights (m) on a lon/lat grid of gw x gh points covering bb, from Terrarium tiles at zoom z; sea is flat at 0
async function loadHeights(bb, z, gw, gh, signal) {
  const n = 2 ** z;
  const x0 = Math.floor(tileX(bb[0], n)), x1 = Math.floor(tileX(bb[2], n)), y0 = Math.floor(tileY(bb[3], n)), y1 = Math.floor(tileY(bb[1], n));
  const MW = (x1 - x0 + 1) * 256, MH = (y1 - y0 + 1) * 256, mos = new Float32Array(MW * MH);
  const list = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) list.push([x, y]);
  await Promise.all(list.map(async ([x, y]) => {
    let px = null, err;
    for (let k = 0; k < 3 && !px; k++) { try { px = pixels(await fetchBitmap(TILE_URL(z, x, y))); } catch (e) { err = e; } }
    if (!px) throw err;
    if (signal?.aborted) return;
    const ox = (x - x0) * 256, oy = (y - y0) * 256;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const k = (j * 256 + i) * 4;
      mos[(oy + j) * MW + ox + i] = px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768;
    }
  }));
  const H = new Float32Array(gw * gh), colX = new Float32Array(gw);
  for (let c = 0; c < gw; c++) colX[c] = (tileX(bb[0] + c / (gw - 1) * (bb[2] - bb[0]), n) - x0) * 256 - 0.5;
  for (let r = 0; r < gh; r++) {
    const fy = (tileY(bb[3] - r / (gh - 1) * (bb[3] - bb[1]), n) - y0) * 256 - 0.5;
    const j0 = clamp(Math.floor(fy), 0, MH - 2), wy = clamp(fy - j0, 0, 1);
    for (let c = 0; c < gw; c++) {
      const fx = colX[c], i0 = clamp(Math.floor(fx), 0, MW - 2), wx = clamp(fx - i0, 0, 1);
      const a = mos[j0 * MW + i0], b = mos[j0 * MW + i0 + 1], d = mos[(j0 + 1) * MW + i0], e = mos[(j0 + 1) * MW + i0 + 1];
      const h = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
      H[r * gw + c] = h > 0 ? h : 0;
    }
  }
  return H;
}

// a grid as a mesh in km (x east, z south, y up); skirts hang below the edges so a patch laid into a hole shows no gaps
function gridGeometry(H, gw, gh, bb, skirt) {
  const nv = gw * gh, ns = skirt ? 2 * (gw + gh) - 4 : 0;
  const pos = new Float32Array((nv + ns) * 3), uv = new Float32Array((nv + ns) * 2);
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    const v = r * gw + c, lon = bb[0] + c / (gw - 1) * (bb[2] - bb[0]), lat = bb[3] - r / (gh - 1) * (bb[3] - bb[1]);
    pos[v * 3] = X(lon); pos[v * 3 + 1] = H[v] / 1000; pos[v * 3 + 2] = Z(lat);
    uv[v * 2] = c / (gw - 1); uv[v * 2 + 1] = 1 - r / (gh - 1);
  }
  const nt = (gw - 1) * (gh - 1) * 6 + ns * 6, idx = nv + ns > 65535 ? new Uint32Array(nt) : new Uint16Array(nt);
  let q = 0;
  for (let r = 0; r < gh - 1; r++) for (let c = 0; c < gw - 1; c++) { const a = r * gw + c, b = a + 1, d = a + gw, e = d + 1; idx[q++] = a; idx[q++] = d; idx[q++] = b; idx[q++] = b; idx[q++] = d; idx[q++] = e; }
  if (skirt) { // walk the edge, add a vertex below each edge vertex, stitch
    const ring = [];
    for (let c = 0; c < gw; c++) ring.push(c);
    for (let r = 1; r < gh; r++) ring.push(r * gw + gw - 1);
    for (let c = gw - 2; c >= 0; c--) ring.push((gh - 1) * gw + c);
    for (let r = gh - 2; r > 0; r--) ring.push(r * gw);
    ring.forEach((v, k) => {
      const s = nv + k; pos[s * 3] = pos[v * 3]; pos[s * 3 + 1] = -0.6; pos[s * 3 + 2] = pos[v * 3 + 2]; uv[s * 2] = uv[v * 2]; uv[s * 2 + 1] = uv[v * 2 + 1];
    });
    for (let k = 0; k < ring.length; k++) { const a = ring[k], b = ring[(k + 1) % ring.length], sa = nv + k, sb = nv + (k + 1) % ring.length; idx[q++] = a; idx[q++] = sa; idx[q++] = b; idx[q++] = b; idx[q++] = sa; idx[q++] = sb; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

/* ---------------- shaders ---------------- */
const TERRAIN_VS = `
  varying vec2 vUv; varying vec3 vN; varying float vH; varying vec2 vXZ;
  void main(){ vUv = uv; vN = normal; vH = position.y; vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TERRAIN_FS = `
  uniform sampler2D uMap; uniform vec3 uSea, uForeign, uLight; uniform float uRelief; uniform vec4 uHole;
  varying vec2 vUv; varying vec3 vN; varying float vH; varying vec2 vXZ;
  void main(){
    if (vXZ.x > uHole.x && vXZ.x < uHole.z && vXZ.y > uHole.y && vXZ.y < uHole.w) discard;
    vec4 m = texture2D(uMap, vUv);
    bool land = vH > 0.004 || m.a > 0.5;
    vec3 base = mix(vH > 0.004 ? uForeign : uSea, m.rgb, m.a);
    // normals of the exaggerated surface: scaling y by s turns a normal's y by 1/s
    vec3 n = normalize(vec3(vN.x, vN.y / uRelief, vN.z));
    float sh = land ? clamp((0.6 + 0.5 * max(dot(n, uLight), 0.0)) / 0.93, 0.55, 1.12) : 1.0;
    gl_FragColor = vec4(base * sh, 1.0);
  }`;
// soft billboards (cloud puffs, mist, suns): one draw call for all of them
const BB_VS = `
  attribute vec3 iPos; attribute vec2 iSize; attribute vec4 iColor; attribute vec4 iMeta;
  uniform float uTime, uGrow, uFlashG, uFlash; uniform vec3 uFlashC;
  varying vec2 vUv; varying vec4 vC;
  void main(){
    vec3 c = iPos;
    c.x += sin(uTime * iMeta.y + iMeta.x) * iMeta.z;
    c.z += cos(uTime * iMeta.y * 0.8 + iMeta.x) * iMeta.z * 0.6;
    vec4 mv = modelViewMatrix * vec4(c, 1.0);
    mv.xy += position.xy * iSize * uGrow;
    gl_Position = projectionMatrix * mv;
    vUv = uv; vC = iColor;
    if (abs(iMeta.w - uFlashG) < 0.5) { vC.rgb = mix(vC.rgb, uFlashC, 0.75 * uFlash); vC.a = min(0.95, vC.a + 0.3 * uFlash); }
  }`;
const BB_FS = `
  uniform sampler2D uTex; varying vec2 vUv; varying vec4 vC;
  void main(){ vec4 t = texture2D(uTex, vUv); float a = t.a * vC.a; if (a < 0.01) discard; gl_FragColor = vec4(t.rgb * vC.rgb, a); }`;
const RAIN_VS = `
  attribute vec4 aDrop; uniform float uTime, uSize, uScale; varying float vA;
  void main(){
    float t = fract(uTime * aDrop.y + aDrop.x);
    vec3 p = vec3(position.x, mix(aDrop.w, aDrop.z, t), position.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uScale / -mv.z, 3.0, 48.0);
    vA = smoothstep(0.0, 0.14, t) * (1.0 - smoothstep(0.84, 1.0, t));
  }`;
const RAIN_FS = `
  uniform vec3 uColor; uniform float uOpacity; varying float vA;
  void main(){
    vec2 pc = gl_PointCoord - 0.5;
    float a = (1.0 - smoothstep(0.03, 0.08, abs(pc.x + pc.y * 0.14))) * (1.0 - smoothstep(0.2, 0.5, abs(pc.y))) * vA * uOpacity;
    if (a < 0.012) discard;
    gl_FragColor = vec4(uColor, a);
  }`;
const FIRE_VS = `uniform float uPx; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uPx; }`;
const FIRE_FS = `
  uniform vec3 uColor, uRing;
  void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(r > 0.3 ? uRing : uColor, 1.0); }`;

// soft sprites drawn once on a canvas (the same shapes as the Benguet map's weather)
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000003) / 1000003; }; }
const hashStr = str => { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function softTexture(kind) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  const blob = (x, y, r, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.55, `rgba(255,255,255,${a * 0.55})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  if (kind === 'puff') {
    const R = rng(7); for (let i = 0; i < 11; i++) blob(62 + R() * 132, 96 + R() * 70, 34 + R() * 40, 0.42);
    g.globalCompositeOperation = 'source-atop'; // a shaded underside, so a puff reads as volume
    const sh = g.createLinearGradient(0, 90, 0, 230); sh.addColorStop(0, 'rgba(120,135,142,0)'); sh.addColorStop(1, 'rgba(120,135,142,0.55)');
    g.fillStyle = sh; g.fillRect(0, 0, 256, 256); g.globalCompositeOperation = 'source-over';
  } else if (kind === 'mist') {
    const R = rng(11); for (let i = 0; i < 14; i++) blob(26 + R() * 204, 118 + R() * 20, 22 + R() * 26, 0.3);
  } else { // sun: a warm disc in a soft halo
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,251,230,1)'); gr.addColorStop(0.2, 'rgba(255,224,130,1)'); gr.addColorStop(0.29, 'rgba(255,200,92,0.5)');
    gr.addColorStop(0.55, 'rgba(255,190,84,0.14)'); gr.addColorStop(1, 'rgba(255,190,84,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }
  const t = new THREE.CanvasTexture(cv); t.needsUpdate = true;
  return t;
}
const RAINY = new Set(['drizzle', 'rain', 'storm']);
const PAL = {
  light: { rain: '#2f6688', rainA: 0.5, cloud: '#fbfcfc', cloudRain: '#bcc6cc', cloudStorm: '#8d99a2', night: '#bcc6cf', fog: '#ffffff', flash: '#fffbe6', k: 1 },
  dark: { rain: '#b7d8ea', rainA: 0.4, cloud: '#d3ddd8', cloudRain: '#aab6ba', cloudStorm: '#8e9ca5', night: '#9fb0be', fog: '#e2ebe6', flash: '#ffffff', k: 0.7 },
};

/* ================= the map ================= */
export async function createPH3D({ box, geo, provinceAt, onPick, onHover, onStatus }) {
  await loadThree();
  if (!THREE.OrbitControls) throw new Error('three.js did not load');
  const canvas = document.createElement('canvas');
  canvas.className = 'gl3d';
  canvas.setAttribute('aria-label', 'Map of the Philippines in 3D. Drag to turn, pinch or scroll to zoom, tap a province.');
  const labelsEl = document.createElement('div'); labelsEl.className = 'labels3d'; labelsEl.setAttribute('aria-hidden', 'true');
  box.prepend(canvas); box.append(labelsEl);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { canvas.remove(); labelsEl.remove(); throw e; }
  renderer.setPixelRatio(Math.min(MOBILE ? 1.5 : 2, devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
  const controls = new THREE.OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.09, maxPolarAngle: Math.PI * 0.44, minDistance: 18, maxDistance: 4200, screenSpacePanning: false, rotateSpeed: 0.6, zoomSpeed: 1.0 });
  const world = new THREE.Group(); scene.add(world);
  const LIGHT = new THREE.Vector3(-0.55, 0.66, -0.52).normalize();
  let dirty = true, relief = 18, visible = true, inView = true, destroyed = false;
  world.scale.y = relief;

  /* ---- colours from the page's theme ---- */
  const P = {};
  function theme() {
    P.sea = css('--sea') || '#e1eae7'; P.land = css('--land') || '#dfe6dc'; P.edge = css('--edge') || '#ffffff';
    P.sel = css('--forest') || '#153f36'; P.fire = css('--fire') || '#2a0d06'; P.ring = css('--fire-ring') || '#fff6ea';
    const c = new THREE.Color(P.sea); P.dark = c.r + c.g + c.b < 1.0;
    P.foreign = '#' + new THREE.Color(P.land).lerp(new THREE.Color(P.sea), 0.45).getHexString();
    P.wx = P.dark ? PAL.dark : PAL.light;
    scene.background = new THREE.Color(P.sea);
  }
  theme();

  /* ---- province paths, painted onto a canvas texture ---- */
  const FEAT = geo.features.map(f => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity, area = 0;
    for (const poly of polys) {
      for (const [lon, lat] of poly[0]) { a = Math.min(a, lon); b = Math.min(b, lat); c = Math.max(c, lon); d = Math.max(d, lat); }
      poly.forEach((ring, k) => { let s = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (X(ring[j][0]) - X(ring[i][0])) * (Z(ring[j][1]) + Z(ring[i][1])); area += (k ? -1 : 1) * Math.abs(s / 2); });
    }
    const p = f.properties;
    return { name: p.name, polys, bb: [a, b, c, d], area, lon: p.lon, lat: p.lat, rad: clamp(Math.sqrt(area / Math.PI) * 0.8, 7, 55) };
  });
  const byName = Object.fromEntries(FEAT.map(f => [f.name, f]));
  let fills = {}, sel = null;
  function paintCanvas(cv, bb, lineScale) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const sx = cv.width / (bb[2] - bb[0]), sy = cv.height / (bb[3] - bb[1]);
    const trace = f => { g.beginPath(); for (const poly of f.polys) for (const ring of poly) ring.forEach(([lon, lat], i) => { const x = (lon - bb[0]) * sx, y = (bb[3] - lat) * sy; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); };
    const vis = FEAT.filter(f => f.bb[2] >= bb[0] && f.bb[0] <= bb[2] && f.bb[3] >= bb[1] && f.bb[1] <= bb[3]);
    for (const f of vis) { trace(f); g.fillStyle = fills[f.name] || P.land; g.fill('evenodd'); }
    g.lineJoin = 'round'; g.strokeStyle = P.edge; g.lineWidth = 1.1 * lineScale;
    for (const f of vis) { trace(f); g.stroke(); }
    if (sel && byName[sel]) { trace(byName[sel]); g.strokeStyle = P.sel; g.lineWidth = 3.2 * lineScale; g.stroke(); }
  }
  const TW = MOBILE ? 1024 : 1536;
  const natCanvas = document.createElement('canvas');
  natCanvas.width = TW; natCanvas.height = Math.round(TW * ((AREA[3] - AREA[1]) * KZ) / ((AREA[2] - AREA[0]) * KX));
  const natTex = new THREE.CanvasTexture(natCanvas);
  natTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  natTex.minFilter = THREE.LinearMipmapLinearFilter;

  const mkMat = tex => new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uSea: { value: new THREE.Color(P.sea) }, uForeign: { value: new THREE.Color(P.foreign) }, uLight: { value: LIGHT }, uRelief: { value: relief }, uHole: { value: new THREE.Vector4(1e9, 1e9, -1e9, -1e9) } },
    vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS,
  });
  const natMat = mkMat(natTex);
  const mats = [natMat];

  /* ---- national terrain ---- */
  const Z0 = MOBILE ? 5 : 6, PPD = MOBILE ? 22 : 45;
  const GW = Math.round((AREA[2] - AREA[0]) * PPD) + 1, GH = Math.round((AREA[3] - AREA[1]) * PPD) + 1;
  onStatus?.('Loading 3D terrain…');
  const HN = await loadHeights(AREA, Z0, GW, GH);
  for (let c = 0; c < GW; c++) { HN[c] = 0; HN[(GH - 1) * GW + c] = 0; } // no cliffs at the map's edge
  for (let r = 0; r < GH; r++) { HN[r * GW] = 0; HN[r * GW + GW - 1] = 0; }
  const natMesh = new THREE.Mesh(gridGeometry(HN, GW, GH, AREA, false), natMat);
  world.add(natMesh);
  const sampler = (H, gw, gh, bb) => (lon, lat) => {
    const fx = (lon - bb[0]) / (bb[2] - bb[0]) * (gw - 1), fy = (bb[3] - lat) / (bb[3] - bb[1]) * (gh - 1);
    if (fx < 0 || fy < 0 || fx > gw - 1 || fy > gh - 1) return null;
    const i0 = Math.min(Math.floor(fx), gw - 2), j0 = Math.min(Math.floor(fy), gh - 2), wx = fx - i0, wy = fy - j0;
    const a = H[j0 * gw + i0], b = H[j0 * gw + i0 + 1], d = H[(j0 + 1) * gw + i0], e = H[(j0 + 1) * gw + i0 + 1];
    return ((a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy) / 1000;
  };
  const natH = sampler(HN, GW, GH, AREA);
  let detail = null; // { bb, mesh, h, tex, cv, name }
  const hAt = (lon, lat) => {
    if (detail && lon >= detail.bb[0] && lon <= detail.bb[2] && lat >= detail.bb[1] && lat <= detail.bb[3]) { const v = detail.h(lon, lat); if (v != null) return v; }
    return natH(lon, lat) ?? 0;
  };

  /* ---- camera ---- */
  const tmpCam = new THREE.PerspectiveCamera(32, 1, 1, 20000), vt = new THREE.Vector3();
  function frameBox(bb, polar, az, margin = 0.86) {
    const tgt = new THREE.Vector3(X((bb[0] + bb[2]) / 2), 0, Z((bb[1] + bb[3]) / 2));
    const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az));
    const pts = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]], [(bb[0] + bb[2]) / 2, bb[1]], [(bb[0] + bb[2]) / 2, bb[3]]].map(([lo, la]) => new THREE.Vector3(X(lo), 0, Z(la)));
    tmpCam.aspect = camera.aspect; tmpCam.updateProjectionMatrix();
    let lo = 5, hi = 12000;
    for (let k = 0; k < 30; k++) {
      const D = (lo + hi) / 2;
      tmpCam.position.copy(tgt).addScaledVector(dir, D); tmpCam.lookAt(tgt); tmpCam.updateMatrixWorld();
      const fits = pts.every(p => { vt.copy(p).project(tmpCam); return vt.z < 1 && Math.abs(vt.x) < margin && Math.abs(vt.y) < margin; });
      if (fits) hi = D; else lo = D;
    }
    return { pos: tgt.clone().addScaledVector(dir, hi), tgt };
  }
  const HOME_BB = [116.9, 4.6, 126.65, 21.1];
  const homeView = () => frameBox(HOME_BB, camera.aspect < 0.8 ? 0.55 : 0.92, 0, 0.94); // less tilt on a tall phone screen, so the country fills it
  let tween = null, userMoved = false;
  const tweenTo = (v, ms = 900) => {
    if (REDUCED.matches || document.hidden) { camera.position.copy(v.pos); controls.target.copy(v.tgt); controls.update(); dirty = true; return; }
    tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: v.pos, t1: v.tgt, s: performance.now(), ms }; dirty = true;
  };
  controls.addEventListener('start', () => { userMoved = true; tween = null; });
  controls.addEventListener('change', () => { dirty = true; });
  function resize() {
    const r = box.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
    if (!userMoved && !tween) { const v = sel ? frameBox(padBox(byName[sel].bb), 0.85, 0) : homeView(); camera.position.copy(v.pos); controls.target.copy(v.tgt); controls.update(); }
  }
  const ro = new ResizeObserver(resize); ro.observe(box); resize();
  // keep the camera over the country
  controls.addEventListener('change', () => {
    const t = controls.target, bx = clamp(t.x, X(AREA[0]), X(AREA[2])), bz = clamp(t.z, Z(AREA[3]), Z(AREA[1]));
    if (bx !== t.x || bz !== t.z) { camera.position.x += bx - t.x; camera.position.z += bz - t.z; t.x = bx; t.z = bz; }
  });

  /* ---- fires ---- */
  const fireMat = new THREE.ShaderMaterial({ uniforms: { uPx: { value: (MOBILE ? 5 : 6) * renderer.getPixelRatio() }, uColor: { value: new THREE.Color(P.fire) }, uRing: { value: new THREE.Color(P.ring) } }, vertexShader: FIRE_VS, fragmentShader: FIRE_FS, depthWrite: false });
  let fires = null, fireRows = null, firesOn = true;
  function buildFires() {
    if (fires) { world.remove(fires); fires.geometry.dispose(); fires = null; }
    if (!fireRows || !fireRows.length) return;
    const pos = new Float32Array(fireRows.length * 3);
    fireRows.forEach((r, i) => { pos[i * 3] = X(r[1]); pos[i * 3 + 1] = hAt(r[1], r[0]) + 0.04; pos[i * 3 + 2] = Z(r[0]); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    fires = new THREE.Points(g, fireMat); fires.renderOrder = 3; fires.frustumCulled = false; fires.visible = firesOn;
    world.add(fires); dirty = true;
  }

  /* ---- weather ---- */
  const TEX = { puff: softTexture('puff'), mist: softTexture('mist'), sun: softTexture('sun') };
  const bbMat = tex => new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uTime: { value: 0 }, uGrow: { value: 1 }, uFlashG: { value: -1 }, uFlash: { value: 0 }, uFlashC: { value: new THREE.Color('#fffbe6') } },
    vertexShader: BB_VS, fragmentShader: BB_FS, transparent: true, depthWrite: false, depthTest: false,
  });
  const cloudMat = bbMat(TEX.puff), mistMat = bbMat(TEX.mist), sunMat = bbMat(TEX.sun);
  const rainMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uSize: { value: 2.4 }, uScale: { value: 900 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.5 } }, vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, depthTest: false });
  const wxGroup = new THREE.Group(); world.add(wxGroup);
  let wxData = null, wxObjs = [], storms = [], flash = null, nextFlash = 0, hasRain = false, wxMoving = false;
  function billboards(list, mat, order) {
    if (!list.length) return null;
    const base = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('uv', base.getAttribute('uv'));
    const n = list.length, iPos = new Float32Array(n * 3), iSize = new Float32Array(n * 2), iColor = new Float32Array(n * 4), iMeta = new Float32Array(n * 4);
    const col = new THREE.Color();
    list.forEach((b, i) => {
      iPos.set([b.x, b.y, b.z], i * 3); iSize.set([b.w, b.h], i * 2);
      col.set(b.c); iColor.set([col.r, col.g, col.b, b.a], i * 4); iMeta.set([b.ph, b.sp, b.amp, b.grp], i * 4);
    });
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3)); g.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 2));
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor, 4)); g.setAttribute('iMeta', new THREE.InstancedBufferAttribute(iMeta, 4));
    g.instanceCount = n;
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = order;
    return m;
  }
  function clearWeather() {
    wxObjs.forEach(o => { wxGroup.remove(o); o.geometry.dispose(); });
    wxObjs = []; storms = []; flash = null; hasRain = false; wxMoving = false;
    [cloudMat].forEach(m => { m.uniforms.uFlashG.value = -1; m.uniforms.uFlash.value = 0; });
  }
  function buildWeather() {
    clearWeather();
    if (!wxData) { dirty = true; return; }
    const W = P.wx, clouds = [], mists = [], suns = [], pos = [], drop = [];
    FEAT.forEach((f, gi) => {
      const w = wxData[f.name]; if (!w) return;
      const R = rng(hashStr(f.name)), k = w.k, chance = w.chance == null ? 1 : clamp(w.chance, 0, 1);
      const gy = Math.max(0, hAt(f.lon, f.lat)), top = gy + 2.2, rad = f.rad;
      const nCloud = k === 'partly' ? 2 : k === 'cloudy' ? 4 : RAINY.has(k) ? 5 : k === 'fog' ? 1 : 0;
      const c = k === 'storm' ? W.cloudStorm : RAINY.has(k) ? W.cloudRain : w.day === 0 ? W.night : W.cloud;
      const a = W.k * (k === 'partly' ? 0.5 : k === 'cloudy' ? 0.66 : k === 'storm' ? 0.88 : RAINY.has(k) ? 0.76 : 0.4) * (RAINY.has(k) ? 0.7 + 0.3 * chance : 1);
      for (let i = 0; i < nCloud; i++) {
        const an = R() * Math.PI * 2, rr = rad * 0.6 * Math.sqrt(R()), wv = (rad * 0.62 + 5) * (0.8 + R() * 0.5);
        clouds.push({ x: X(f.lon) + Math.cos(an) * rr, y: top + R() * 0.4, z: Z(f.lat) + Math.sin(an) * rr, w: wv, h: wv * 0.62, c, a: a * (0.75 + R() * 0.35), ph: R() * 6.28, sp: 0.05 + R() * 0.07, amp: rad * 0.06, grp: k === 'storm' ? gi : -2 });
      }
      if (k === 'fog') for (let i = 0; i < 3; i++) {
        const an = R() * Math.PI * 2, rr = rad * 0.6 * Math.sqrt(R()), x = X(f.lon) + Math.cos(an) * rr, z = Z(f.lat) + Math.sin(an) * rr, wv = rad * 0.9 + 6;
        mists.push({ x, y: Math.max(0, hAt(LON(x), LAT(z))) + 0.15, z, w: wv, h: wv * 0.4, c: W.fog, a: 0.5 * W.k, ph: R() * 6.28, sp: 0.03 + R() * 0.04, amp: rad * 0.05, grp: -2 });
      }
      if (w.day !== 0 && (k === 'clear' || k === 'partly')) {
        const d = clamp(rad * 0.55 + 6, 9, 30) * (k === 'partly' ? 0.8 : 1);
        suns.push({ x: X(f.lon) - (k === 'partly' ? rad * 0.2 : 0), y: top + 0.3, z: Z(f.lat), w: d * 1.7, h: d * 1.7, c: w.hot ? '#ffb27a' : '#ffffff', a: P.dark ? 0.85 : 0.95, ph: R() * 6.28, sp: 0, amp: 0, grp: -2 });
      }
      if (RAINY.has(k)) {
        const n = Math.round((MOBILE ? 70 : 150) * (0.35 + (w.i || 0.4)) * clamp(rad / 22, 0.6, 1.7) * (0.2 + 0.8 * chance));
        for (let i = 0; i < n; i++) {
          const an = R() * Math.PI * 2, rr = rad * 0.65 * Math.sqrt(R()), x = X(f.lon) + Math.cos(an) * rr, z = Z(f.lat) + Math.sin(an) * rr;
          const g = Math.max(0, hAt(LON(x), LAT(z)));
          pos.push(x, 0, z);
          drop.push(R(), (0.5 + R() * 0.35) * (k === 'drizzle' ? 0.55 : 1), g + 0.02, Math.max(top - 0.2, g + 0.8));
        }
      }
      if (k === 'storm') storms.push(gi);
    });
    const cap = MOBILE ? 5000 : 12000; // keep cheap phones smooth: thin the rain evenly if there's too much
    if (pos.length / 3 > cap) {
      const keep = cap / (pos.length / 3), p2 = [], d2 = [], R = rng(3);
      for (let i = 0; i < pos.length / 3; i++) if (R() < keep) { p2.push(pos[i * 3], 0, pos[i * 3 + 2]); d2.push(drop[i * 4], drop[i * 4 + 1], drop[i * 4 + 2], drop[i * 4 + 3]); }
      pos.length = 0; drop.length = 0; pos.push(...p2); drop.push(...d2);
    }
    const add = o => { if (o) { wxGroup.add(o); wxObjs.push(o); } };
    add(billboards(mists, mistMat, 5)); add(billboards(clouds, cloudMat, 7)); add(billboards(suns, sunMat, 6));
    hasRain = pos.length > 0;
    if (hasRain) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aDrop', new THREE.Float32BufferAttribute(drop, 4));
      const pts = new THREE.Points(g, rainMat); pts.frustumCulled = false; pts.renderOrder = 6; add(pts);
    }
    rainMat.uniforms.uColor.value.set(W.rain); rainMat.uniforms.uOpacity.value = W.rainA;
    cloudMat.uniforms.uFlashC.value.set(W.flash);
    wxMoving = wxObjs.length > 0;
    dirty = true;
  }

  /* ---- sharper terrain for the chosen province ---- */
  function padBox(bb, k = 0.18, min = 0.12) {
    const w = bb[2] - bb[0], h = bb[3] - bb[1], m = Math.max(min, Math.max(w, h) * k);
    return [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m];
  }
  let detailJob = 0;
  function dropDetail() {
    detailJob++;
    if (!detail) return;
    world.remove(detail.mesh); detail.mesh.geometry.dispose(); detail.mesh.material.dispose(); detail.tex.dispose();
    mats.splice(mats.indexOf(detail.mesh.material), 1);
    detail = null; natMat.uniforms.uHole.value.set(1e9, 1e9, -1e9, -1e9); dirty = true;
  }
  async function loadDetail(name) {
    dropDetail();
    const f = byName[name]; if (!f) return;
    const job = detailJob, p = padBox(f.bb, 0.55, 0.25);
    const bb = [Math.max(p[0], AREA[0]), Math.max(p[1], AREA[1]), Math.min(p[2], AREA[2]), Math.min(p[3], AREA[3])];
    const span = Math.max(bb[2] - bb[0], bb[3] - bb[1]), cap = MOBILE ? 300 : 560;
    const z = clamp(Math.floor(Math.log2(cap * 360 / (256 * span))), Z0 + 1, MOBILE ? 9 : 10);
    const ppd = Math.min(256 * 2 ** z / 360, cap / span);
    const gw = Math.max(8, Math.round((bb[2] - bb[0]) * ppd) + 1), gh = Math.max(8, Math.round((bb[3] - bb[1]) * ppd) + 1);
    onStatus?.('Loading sharper terrain…');
    let H;
    try { H = await loadHeights(bb, z, gw, gh); } catch (e) { onStatus?.(''); console.warn('[ph3d] detail terrain', e); return; }
    if (job !== detailJob || destroyed) return;
    // ease the patch's outer band into the country-wide surface, so there is no step where they meet
    const band = Math.max(4, Math.round(Math.min(gw, gh) * 0.1));
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
      const e = Math.min(r, c, gh - 1 - r, gw - 1 - c);
      if (e >= band) continue;
      const w = (e / band) * (e / band) * (3 - 2 * e / band), lon = bb[0] + c / (gw - 1) * (bb[2] - bb[0]), lat = bb[3] - r / (gh - 1) * (bb[3] - bb[1]);
      H[r * gw + c] = (natH(lon, lat) ?? 0) * 1000 * (1 - w) + H[r * gw + c] * w;
    }
    const cv = document.createElement('canvas');
    const tw = MOBILE ? 1024 : 1536, aspect = ((bb[3] - bb[1]) * KZ) / ((bb[2] - bb[0]) * KX);
    if (aspect > 1) { cv.height = tw; cv.width = Math.max(64, Math.round(tw / aspect)); } else { cv.width = tw; cv.height = Math.max(64, Math.round(tw * aspect)); }
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = natTex.anisotropy; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = mkMat(tex); mat.uniforms.uRelief.value = relief; mat.side = THREE.DoubleSide; mats.push(mat);
    const mesh = new THREE.Mesh(gridGeometry(H, gw, gh, bb, true), mat);
    world.add(mesh);
    detail = { bb, mesh, h: sampler(H, gw, gh, bb), tex, cv, name };
    paintDetail();
    // a hair inside the patch, so the coarse surface never shows at its edge
    const e = 0.004;
    natMat.uniforms.uHole.value.set(X(bb[0] + e), Z(bb[3] - e), X(bb[2] - e), Z(bb[1] + e));
    buildFires(); buildWeather();
    onStatus?.('');
    dirty = true;
  }
  function paintDetail() {
    if (!detail) return;
    paintCanvas(detail.cv, detail.bb, Math.max(1, detail.cv.width / ((detail.bb[2] - detail.bb[0]) * 760))); // borders about 150 m wide
    detail.tex.needsUpdate = true;
  }
  function repaint() {
    paintCanvas(natCanvas, AREA, TW / 1536);
    natTex.needsUpdate = true; paintDetail(); dirty = true;
  }

  /* ---- picking ---- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction, dist = camera.position.distanceTo(controls.target);
    const ground = t => { const x = o.x + d.x * t, z = o.z + d.z * t; return hAt(LON(x), LAT(z)) * relief; };
    let t = 0, prev = 0; const step = Math.max(0.4, dist * 0.004), end = dist * 6;
    while (t < end) {
      if (o.y + d.y * t <= ground(t)) {
        let a = prev, b = t;
        for (let k = 0; k < 16; k++) { const m = (a + b) / 2; if (o.y + d.y * m <= ground(m)) b = m; else a = m; }
        return { lon: LON(o.x + d.x * b), lat: LAT(o.z + d.z * b) };
      }
      prev = t; t += step * (1 + t / (dist * 1.5));
    }
    return null;
  }
  let downAt = null, hoverRAF = 0, lastEv = null;
  canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (!downAt) return; const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]); downAt = null;
    if (moved > 6) return;
    const p = pick(e.clientX, e.clientY);
    onPick?.(p ? provinceAt(p.lon, p.lat) : null);
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || e.buttons) { if (e.buttons) onHover?.(null); return; }
    lastEv = e; if (hoverRAF) return;
    hoverRAF = requestAnimationFrame(() => { hoverRAF = 0; const p = pick(lastEv.clientX, lastEv.clientY); onHover?.(p ? provinceAt(p.lon, p.lat) : null, lastEv.clientX, lastEv.clientY); });
  });
  canvas.addEventListener('pointerleave', () => onHover?.(null));

  /* ---- labels ---- */
  let labelText = () => null;
  const LBL = FEAT.map(f => { const el = document.createElement('span'); el.className = 'l3'; el.style.display = 'none'; labelsEl.append(el); return { f, el, txt: '', w: 0, h: 0 }; });
  function placeLabels(dist) {
    const rect = box.getBoundingClientRect(), placed = [];
    const order = LBL.slice().sort((a, b) => (b.f.name === sel) - (a.f.name === sel) || b.f.area - a.f.area);
    for (const l of order) {
      const txt = labelText(l.f.name, dist);
      if (!txt) { if (l.el.style.display !== 'none') l.el.style.display = 'none'; continue; }
      if (txt !== l.txt) { l.el.textContent = txt; l.txt = txt; l.w = 0; l.el.classList.toggle('sel', l.f.name === sel); }
      vt.set(X(l.f.lon), hAt(l.f.lon, l.f.lat) * relief, Z(l.f.lat)).project(camera);
      if (vt.z > 1 || Math.abs(vt.x) > 1.02 || Math.abs(vt.y) > 1.02) { l.el.style.display = 'none'; continue; }
      const x = (vt.x + 1) / 2 * rect.width, y = (1 - vt.y) / 2 * rect.height;
      if (l.el.style.display === 'none') l.el.style.display = '';
      if (!l.w) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
      const bx = [x - l.w / 2 - 3, y - l.h - 6, x + l.w / 2 + 3, y];
      if (l.f.name !== sel && placed.some(p => bx[0] < p[2] && bx[2] > p[0] && bx[1] < p[3] && bx[3] > p[1])) { l.el.style.display = 'none'; continue; }
      placed.push(bx);
      l.el.classList.toggle('sel', l.f.name === sel);
      l.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
    }
  }

  /* ---- frame loop ---- */
  const FRAME = TEST ? 250 : MOBILE ? 1000 / 30 : 1000 / 40;
  let lastWx = 0, lastDist = -1, labelsDirty = true, drawn = false, onDrawn = [];
  const lastM = new Float64Array(16);
  function frame(now) {
    if (destroyed) return;
    requestAnimationFrame(frame);
    if (!visible || !inView || document.hidden) return;
    if (tween) {
      const k = Math.min(1, (now - tween.s) / tween.ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e);
      if (k >= 1) tween = null; dirty = true;
    }
    controls.update();
    const animWx = wxMoving && !REDUCED.matches && wxGroup.visible && now - lastWx >= FRAME;
    if (!dirty && !animWx) return;
    dirty = false;
    const dist = camera.position.distanceTo(controls.target);
    if (Math.abs(dist - lastDist) > dist * 0.01) {
      lastDist = dist;
      const s = clamp(1.4 + dist / 150, 1.6, 18); // more relief from far away, so mountains read at country scale
      if (Math.abs(s - relief) > relief * 0.015) { relief = s; world.scale.y = s; mats.forEach(m => { m.uniforms.uRelief.value = s; }); }
      camera.near = clamp(dist * 0.004, 0.5, 20); camera.far = Math.max(6000, dist * 6); camera.updateProjectionMatrix();
      const grow = clamp(dist / 520, 1, 4); // weather stays readable from far away
      [cloudMat, mistMat, sunMat].forEach(m => { m.uniforms.uGrow.value = grow; });
      rainMat.uniforms.uSize.value = 2.4 * Math.sqrt(grow);
    }
    // weather time, storm flashes
    const s = now / 1000;
    if (wxObjs.length) {
      lastWx = now;
      const t = REDUCED.matches ? 0 : s;
      [cloudMat, mistMat, sunMat, rainMat].forEach(m => { m.uniforms.uTime.value = t; });
      rainMat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
      if (!REDUCED.matches && storms.length) {
        if (!flash && now > nextFlash) flash = { g: storms[Math.floor(Math.random() * storms.length)], t0: now };
        if (flash) {
          const e = (now - flash.t0) / 1000, k = e < 0.07 ? 1 : e < 0.14 ? 0.2 : e < 0.22 ? 0.85 : Math.max(0, 1 - (e - 0.22) / 0.22);
          cloudMat.uniforms.uFlashG.value = flash.g; cloudMat.uniforms.uFlash.value = k;
          if (e > 0.5) { cloudMat.uniforms.uFlash.value = 0; flash = null; nextFlash = now + 1800 + Math.random() * 4200; }
        }
      }
    }
    renderer.render(scene, camera);
    if (!drawn) { drawn = true; onDrawn.forEach(f => f()); onDrawn = []; }
    const e = camera.matrixWorld.elements; let moved = labelsDirty;
    for (let i = 0; i < 16; i++) if (e[i] !== lastM[i]) { moved = true; lastM[i] = e[i]; }
    if (moved) { labelsDirty = false; placeLabels(dist); }
  }
  requestAnimationFrame(frame);
  try { new IntersectionObserver(es => { inView = es.some(e => e.isIntersecting); dirty = true; }).observe(box); } catch { /* always on */ }
  document.addEventListener('visibilitychange', () => { dirty = true; });
  const retheme = () => { theme(); mats.forEach(m => { m.uniforms.uSea.value.set(P.sea); m.uniforms.uForeign.value.set(P.foreign); }); fireMat.uniforms.uColor.value.set(P.fire); fireMat.uniforms.uRing.value.set(P.ring); repaint(); buildWeather(); };
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme); } catch { /* old browsers */ }

  const v = homeView(); camera.position.copy(v.pos); controls.target.copy(v.tgt); controls.update();
  repaint();
  onStatus?.('');

  return {
    canvas,
    whenDrawn() { return drawn ? Promise.resolve() : new Promise(r => onDrawn.push(r)); },
    // fills: province name -> CSS colour (or null for plain land); sel: the chosen province
    paint(f, s) { fills = f || {}; sel = s || null; repaint(); labelsDirty = true; },
    select(name) {
      sel = name || null; repaint();
      if (name && byName[name]) { userMoved = true; tweenTo(frameBox(padBox(byName[name].bb), 0.85, 0)); loadDetail(name); }
      else { userMoved = false; dropDetail(); tweenTo(homeView()); buildFires(); buildWeather(); }
    },
    home() { this.select(null); },
    setFires(rows, on) { fireRows = rows; firesOn = on !== false; if (fires) { fires.visible = firesOn; dirty = true; } if (rows && !fires) buildFires(); },
    showFires(on) { firesOn = on; if (fires) fires.visible = on; dirty = true; },
    // byName: province -> { k: sky kind, i: intensity, chance: 0..1, day: 0/1, hot }; null hides the weather
    setWeather(byName) { wxData = byName; wxGroup.visible = !!byName; buildWeather(); },
    setLabels(fn) { labelText = fn || (() => null); LBL.forEach(l => { l.txt = null; }); labelsDirty = true; dirty = true; },
    show(on) { visible = on; canvas.hidden = !on; labelsEl.hidden = !on; if (on) { resize(); dirty = true; labelsDirty = true; } },
    redraw() { dirty = true; },
    info() { return { relief, dist: camera.position.distanceTo(controls.target), detail: detail?.name || null, clouds: wxObjs.length, rain: hasRain, fires: fires ? fires.geometry.getAttribute('position').count : 0 }; },
    pickAt(x, y) { return pick(x, y); },
    project(lon, lat) { // screen point of a place, for tests
      vt.set(X(lon), hAt(lon, lat) * relief, Z(lat)).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (vt.x + 1) / 2 * r.width, y: r.top + (1 - vt.y) / 2 * r.height };
    },
    destroy() { destroyed = true; ro.disconnect(); renderer.dispose(); canvas.remove(); labelsEl.remove(); },
  };
}
