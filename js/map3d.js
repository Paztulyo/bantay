// FireTrace-style 3D map of Benguet on measured data.
// Terrain: AWS Terrain Tiles (Terrarium, z11) resampled onto a 1/1500° grid (~72 m).
// Ground: ESA WorldCover 2021 classes on the same grid. Trees are placed only where
// WorldCover maps tree cover, pines in the highland pine belt, broadleaf below and above it.
// Vector layers (roads, rivers, places) come from OpenStreetMap; boundaries from PSA PSGC.
import { esc, css, clamp, showTip, hideTip, TEST } from './util.js';
import { damIcon } from './icons.js';

export const AREA = [120.38, 16.08, 121.0, 16.99]; // W S E N (matches api/landcover.js)
const PPD = 1500;
export const GW = Math.round((AREA[2] - AREA[0]) * PPD);
export const GH = Math.round((AREA[3] - AREA[1]) * PPD);
const LONC = (AREA[0] + AREA[2]) / 2, LATC = (AREA[1] + AREA[3]) / 2;
const KX = 111.32 * Math.cos(LATC * Math.PI / 180), KZ = 110.574;
const CXK = KX / PPD, CZK = KZ / PPD;
const lonOfC = c => AREA[0] + (c + 0.5) / PPD;
const latOfR = r => AREA[3] - (r + 0.5) / PPD;
const cOfLon = lon => (lon - AREA[0]) * PPD - 0.5;
const rOfLat = lat => (AREA[3] - lat) * PPD - 0.5;
const xOfC = c => (lonOfC(c) - LONC) * KX;
const zOfR = r => (LATC - latOfR(r)) * KZ;
const cOfX = x => (x / KX + LONC - AREA[0]) * PPD - 0.5;
const rOfZ = z => (z / KZ - LATC + AREA[3]) * PPD - 0.5;
const MOBILE = matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad/.test(navigator.userAgent);
const TILE_URL = TEST ? (z, x, y) => `/test-tiles/${z}/${x}/${y}.png` : (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
export const COVER_NAMES = { 10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland', 40: 'Cropland', 50: 'Built-up', 60: 'Bare or sparse', 80: 'Water', 90: 'Wetland', 95: 'Mangroves', 100: 'Moss and lichen' };

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
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
function boxBlur(src, w, h, rad) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * rad + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let x = -rad; x <= rad; x++) acc += src[o + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) { tmp[o + x] = acc / k; acc += src[o + Math.min(w - 1, x + rad + 1)] - src[o + Math.max(0, x - rad)]; }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -rad; y <= rad; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / k; acc += tmp[Math.min(h - 1, y + rad + 1) * w + x] - tmp[Math.max(0, y - rad) * w + x]; }
  }
  return out;
}

async function loadTerrain(progress) {
  const Z = 11, n = 2 ** Z;
  const tx = lon => (lon + 180) / 360 * n;
  const ty = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; };
  const x0 = Math.floor(tx(AREA[0])), x1 = Math.floor(tx(AREA[2])), y0 = Math.floor(ty(AREA[3])), y1 = Math.floor(ty(AREA[1]));
  const NX = x1 - x0 + 1, NY = y1 - y0 + 1, MW = NX * 256, MH = NY * 256;
  const mos = new Float32Array(MW * MH);
  const list = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) list.push([x, y]);
  let done = 0;
  await Promise.all(list.map(async ([x, y]) => {
    let px, err;
    for (let attempt = 0; attempt < 3 && !px; attempt++) { try { px = pixels(await fetchBitmap(TILE_URL(Z, x, y))); } catch (e) { err = e; } }
    if (!px) throw err;
    const ox = (x - x0) * 256, oy = (y - y0) * 256;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const k = (j * 256 + i) * 4;
      mos[(oy + j) * MW + ox + i] = px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768;
    }
    progress(++done, list.length);
  }));
  const H = new Float32Array(GW * GH);
  const colX = new Float32Array(GW);
  for (let c = 0; c < GW; c++) colX[c] = (tx(lonOfC(c)) - x0) * 256 - 0.5;
  for (let r = 0; r < GH; r++) {
    const fy = (ty(latOfR(r)) - y0) * 256 - 0.5;
    const j0 = clamp(Math.floor(fy), 0, MH - 2), wy = clamp(fy - j0, 0, 1);
    for (let c = 0; c < GW; c++) {
      const fx = colX[c], i0 = clamp(Math.floor(fx), 0, MW - 2), wx = clamp(fx - i0, 0, 1);
      const a = mos[j0 * MW + i0], b = mos[j0 * MW + i0 + 1], d = mos[(j0 + 1) * MW + i0], e = mos[(j0 + 1) * MW + i0 + 1];
      const h = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
      H[r * GW + c] = h < -100 ? 0 : h;
    }
  }
  return H;
}

async function loadCover() {
  const bmp = await fetchBitmap('/api/landcover');
  const px = pixels(bmp), bw = bmp.width, bh = bmp.height;
  const cls = new Uint8Array(GW * GH);
  for (let r = 0; r < GH; r++) {
    const rr = Math.min(bh - 1, Math.floor(r * bh / GH));
    for (let c = 0; c < GW; c++) cls[r * GW + c] = px[(rr * bw + Math.min(bw - 1, Math.floor(c * bw / GW))) * 4];
  }
  return cls;
}

function rasterRing(ring, out, val) {
  const pts = ring.map(([lon, lat]) => [cOfLon(lon), rOfLat(lat)]);
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  for (let r = Math.max(0, Math.ceil(y0)); r <= Math.min(GH - 1, Math.floor(y1)); r++) {
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > r) !== (yj > r)) xs.push(xi + (r - yi) * (xj - xi) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2)
      for (let c = Math.max(0, Math.ceil(xs[q])); c <= Math.min(GW - 1, Math.floor(xs[q + 1])); c++) out[r * GW + c] = val;
  }
}
const decodeLine = arr => { const out = []; let x = 0, y = 0; for (let i = 0; i + 1 < arr.length; i += 2) { x += arr[i]; y += arr[i + 1]; out.push([120 + x / 1e5, 16 + y / 1e5]); } return out; };
const inArea = ([lon, lat], m = 0) => lon >= AREA[0] - m && lon <= AREA[2] + m && lat >= AREA[1] - m && lat <= AREA[3] + m;

/* ------------------------------------------------------------------------------------------ */
export function createMap({ canvas, vp, labelsEl, msgEl, state, onSelect, hoverExtra, onReady }) {
  if (!window.THREE || !THREE.OrbitControls || !THREE.LineSegments2) throw new Error('three.js did not load');
  const G = { ok: false, ready: false, dirty: true };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(MOBILE ? 1.75 : 2, devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 2000);
  const controls = new THREE.OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.09, maxPolarAngle: Math.PI * 0.47, minDistance: 2.2, maxDistance: 240, screenSpacePanning: false, rotateSpeed: 0.6, zoomSpeed: 1.0 });
  const world = new THREE.Group(); scene.add(world); world.scale.y = state.layers.relief;
  const LIGHT = new THREE.Vector3(-0.55, 0.66, -0.52).normalize();
  let lastDist = 0;
  const msg = html => { if (!msgEl) return; msgEl.hidden = !html; msgEl.innerHTML = html ? `<div class="loading">${html}</div>` : ''; };

  // camera presets (km; x east, z south)
  const PRESET = {
    d3: { pos: new THREE.Vector3(-34, 58, 88), tgt: new THREE.Vector3(2, 0.6, 6) },
    top: { pos: new THREE.Vector3(0, 172, 0.01), tgt: new THREE.Vector3(0, 0, 0) },
    water: { pos: new THREE.Vector3(-22, 26, 50), tgt: new THREE.Vector3(10, 0.6, 8) },
  };
  const fit = v => { const f = Math.max(1, 1.55 / Math.max(0.3, camera.aspect)); return { pos: v.tgt.clone().add(v.pos.clone().sub(v.tgt).multiplyScalar(f)), tgt: v.tgt.clone() }; };
  let tween = null, userMoved = false, curPreset = 'd3';
  const tweenTo = (pos, tgt, ms) => { tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: tgt.clone(), s: performance.now(), ms: ms || 800 }; G.dirty = true; };
  const flyTo = (pos, tgt, ms) => { userMoved = true; tweenTo(pos, tgt, ms); };
  const flyPreset = (name, ms) => { curPreset = name; userMoved = false; const p = fit(PRESET[name]); tweenTo(p.pos, p.tgt, ms); };
  // dragging or zooming takes over from any camera flight, and stops the view re-framing on resize
  controls.addEventListener('start', () => { userMoved = true; tween = null; });

  const lineMats = [];
  function resize() {
    const r = vp.getBoundingClientRect(); const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    lineMats.forEach(m => m.resolution.set(w, h)); G.dirty = true;
    // until the user moves the camera, keep the current preset framed for the new shape
    if (!userMoved && !tween) { const p = fit(PRESET[curPreset]); camera.position.copy(p.pos); controls.target.copy(p.tgt); controls.update(); }
  }
  new ResizeObserver(resize).observe(vp); resize();

  // ---------- shared uniforms ----------
  const U = {
    uRelief: { value: state.layers.relief }, uLight: { value: LIGHT }, uBg: { value: new THREE.Color(0xe9efe7) },
    uDry: { value: 0.15 }, uStage: { value: new THREE.Color(0.9, 0.8, 0.5) }, uStageAmt: { value: 0 }, uOutlook: { value: 0 },
    uHover: { value: -1 }, uSel: { value: -1 }, uFade: { value: 0.55 }, uFog: { value: new THREE.Vector2(140, 420) },
    uContours: { value: 1 }, uTintAmt: { value: 0 }, uDark: { value: 0 }, uCover: { value: 1 },
  };

  let H = null, MWv = 0, MHv = 0, S = MOBILE ? 3 : 2, HV = null, treeFrac = null, cls = null, inside = null, muniId = null;
  let MUNI = [], muniTint = null, terrain = null;
  const meshH = (c, r) => { // height (m) on the rendered mesh surface, triangle-exact
    if (!HV) return 0;
    const i = clamp(c / S, 0, MWv - 1.0001), j = clamp(r / S, 0, MHv - 1.0001);
    const i0 = Math.floor(i), j0 = Math.floor(j), fx = i - i0, fy = j - j0;
    const a = HV[j0 * MWv + i0], b = HV[j0 * MWv + i0 + 1], d = HV[(j0 + 1) * MWv + i0], e = HV[(j0 + 1) * MWv + i0 + 1];
    return fx + fy <= 1 ? a + (b - a) * fx + (d - a) * fy : e + (d - e) * (1 - fx) + (b - e) * (1 - fy);
  };
  const gridAt = (arr, c, r) => arr[clamp(Math.round(r), 0, GH - 1) * GW + clamp(Math.round(c), 0, GW - 1)];
  G.meshH = meshH;

  /* ================= terrain ================= */
  function buildTerrain(boundaries) {
    const N = GW * GH;
    // land cover fractions (soft edges): tree, grass/shrub, crop, built; water separately
    const fT = new Float32Array(N), fG = new Float32Array(N), fC = new Float32Array(N), fB = new Float32Array(N), fW = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const v = cls ? cls[i] : 0;
      if (v === 10 || v === 95) fT[i] = 1; else if (v === 20 || v === 30 || v === 90 || v === 100) fG[i] = 1;
      else if (v === 40) fC[i] = 1; else if (v === 50) fB[i] = 1; else if (v === 80) fW[i] = 1;
      else if (!cls) { const h = H[i]; fT[i] = h > 500 && h < 2500 ? 1 : 0; fG[i] = 1 - fT[i]; }
    }
    const bT = boxBlur(fT, GW, GH, 1), bG = boxBlur(fG, GW, GH, 1), bC = boxBlur(fC, GW, GH, 1), bB = boxBlur(fB, GW, GH, 1), bW = boxBlur(fW, GW, GH, 1);
    treeFrac = bT;
    const hb = boxBlur(H, GW, GH, 5);
    const nd = new Uint8Array(N * 4), cd = new Uint8Array(N * 4);
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
      const i = r * GW + c;
      const dx = (H[r * GW + Math.min(GW - 1, c + 1)] - H[r * GW + Math.max(0, c - 1)]) / 1000 / (2 * CXK);
      const dz = (H[Math.min(GH - 1, r + 1) * GW + c] - H[Math.max(0, r - 1) * GW + c]) / 1000 / (2 * CZK);
      const L = Math.hypot(dx, 1, dz);
      nd[i * 4] = Math.round((-dx / L * 0.5 + 0.5) * 255);
      nd[i * 4 + 1] = Math.round((-dz / L * 0.5 + 0.5) * 255);
      nd[i * 4 + 2] = Math.round(clamp((hb[i] - H[i]) / 110 * 0.5 + 0.5, 0, 1) * 255);
      nd[i * 4 + 3] = Math.round(bW[i] * 255);
      cd[i * 4] = Math.round(bT[i] * 255); cd[i * 4 + 1] = Math.round(bG[i] * 255); cd[i * 4 + 2] = Math.round(bC[i] * 255); cd[i * 4 + 3] = Math.round(bB[i] * 255);
    }
    // municipality ids and province mask
    muniId = new Uint8Array(N); inside = new Uint8Array(N);
    MUNI = Object.entries(boundaries.munis).map(([n, m]) => ({ n, ...m }));
    MUNI.forEach((m, k) => rasterRing(m.ring, muniId, k + 1));
    rasterRing(boundaries.prov, inside, 1);
    const md = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) { md[i * 4] = muniId[i]; md[i * 4 + 1] = inside[i] ? 255 : 0; md[i * 4 + 3] = 255; }

    const tex = (data, filter, mip) => {
      const t = new THREE.DataTexture(data, GW, GH, THREE.RGBAFormat);
      t.magFilter = filter; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : filter; t.generateMipmaps = !!mip;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = mip ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
      t.needsUpdate = true; return t;
    };
    const tNorm = tex(nd, THREE.LinearFilter, true), tCover = tex(cd, THREE.LinearFilter, true), tMuni = tex(md, THREE.NearestFilter, false);
    muniTint = new THREE.DataTexture(new Uint8Array(16 * 4), 16, 1, THREE.RGBAFormat); muniTint.magFilter = muniTint.minFilter = THREE.NearestFilter; muniTint.needsUpdate = true;

    // decimated mesh
    MWv = Math.floor((GW - 1) / S) + 1; MHv = Math.floor((GH - 1) / S) + 1;
    const nv = MWv * MHv, pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    HV = new Float32Array(nv);
    for (let j = 0; j < MHv; j++) for (let i = 0; i < MWv; i++) {
      const c = i * S, r = j * S, v = j * MWv + i, h = H[r * GW + c];
      HV[v] = h; pos[v * 3] = xOfC(c); pos[v * 3 + 1] = h / 1000; pos[v * 3 + 2] = zOfR(r);
      uv[v * 2] = (c + 0.5) / GW; uv[v * 2 + 1] = (r + 0.5) / GH;
    }
    const idx = new Uint32Array((MWv - 1) * (MHv - 1) * 6); let q = 0;
    for (let j = 0; j < MHv - 1; j++) for (let i = 0; i < MWv - 1; i++) { const a = j * MWv + i, b = a + 1, d = a + MWv, e = d + 1; idx[q++] = a; idx[q++] = d; idx[q++] = b; idx[q++] = b; idx[q++] = d; idx[q++] = e; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
    Object.assign(U, { tNorm: { value: tNorm }, tCover: { value: tCover }, tMuni: { value: tMuni }, tTint: { value: muniTint } });
    const mat = new THREE.ShaderMaterial({
      uniforms: U, extensions: { derivatives: true }, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      vertexShader: `
        varying vec2 vUv; varying vec3 vW; varying float vH;
        void main(){ vUv=uv; vH=position.y*1000.0; vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `
        uniform sampler2D tNorm, tCover, tMuni, tTint;
        uniform vec3 uLight, uBg, uStage; uniform float uRelief, uDry, uStageAmt, uOutlook, uHover, uSel, uFade, uContours, uTintAmt, uDark, uCover; uniform vec2 uFog;
        varying vec2 vUv; varying vec3 vW; varying float vH;
        float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
        float dots(vec2 p, float density, float rmin, float rmax, out float fw){
          vec2 ip=floor(p), fp=fract(p); fw=fwidth(p.x);
          float on=step(hash(ip),density); vec2 o=vec2(hash(ip+1.7),hash(ip+3.1))*0.56+0.22;
          float rr=mix(rmin,rmax,hash(ip+5.3)); float d=length((fp-o)*vec2(1.0,1.25));
          return on*(1.0-smoothstep(rr-fw,rr+fw,d));
        }
        void main(){
          vec4 tn=texture2D(tNorm,vUv); vec4 cv=texture2D(tCover,vUv); vec4 mu=texture2D(tMuni,vUv);
          vec2 nxz=tn.rg*2.0-1.0; float ny=sqrt(max(0.0,1.0-dot(nxz,nxz)));
          vec3 n=normalize(vec3(nxz.x*uRelief,ny,nxz.y*uRelief));
          float water=tn.a; float cav=(tn.b-0.5)*2.0;
          float dry=uDry;
          vec3 cTree=mix(vec3(0.43,0.53,0.32),vec3(0.60,0.57,0.37),dry);
          vec3 cGrass=mix(vec3(0.63,0.69,0.43),vec3(0.86,0.76,0.55),dry);
          vec3 cCrop=mix(vec3(0.56,0.67,0.39),vec3(0.80,0.73,0.50),dry);
          vec3 cBuilt=vec3(0.80,0.77,0.72), cBare=vec3(0.85,0.79,0.65);
          float other=max(0.0,1.0-cv.r-cv.g-cv.b-cv.a-water);
          vec3 base=(cTree*cv.r+cGrass*cv.g+cCrop*cv.b+cBuilt*cv.a+cBare*other)/max(0.001,cv.r+cv.g+cv.b+cv.a+other);
          base=mix(vec3(0.74,0.74,0.69),base,uCover);
          // FireTrace-style scatter: shrub dots on open ground, canopy dots in forest, terrace lines on crops
          float fw; float sd=dots(vW.xz/0.055,mix(0.42,0.26,dry),0.10,0.20,fw);
          base=mix(base,mix(vec3(0.40,0.48,0.27),vec3(0.50,0.47,0.30),dry),sd*cv.g*0.75*(1.0-smoothstep(0.10,0.32,fw))*uCover);
          float cd=dots(vW.xz/0.04,0.62,0.18,0.30,fw);
          base=mix(base,vec3(0.22,0.33,0.20),cd*cv.r*0.55*(1.0-smoothstep(0.12,0.4,fw))*uCover);
          float tl=vH/5.0; float tfw=fwidth(tl); float tline=1.0-smoothstep(0.0,0.9,abs(fract(tl)-0.5)/max(tfw,1e-4)*0.5);
          base=mix(base,base*0.86,tline*cv.b*(1.0-smoothstep(0.15,0.45,tfw))*uCover);
          vec3 cWater=mix(vec3(0.47,0.69,0.80),vec3(0.26,0.47,0.58),uDark);
          base=mix(base,cWater,smoothstep(0.35,0.65,water));
          // light: warm key from the north-west, cool fill
          float diff=dot(n,uLight); float wrap=clamp((diff+0.30)/1.30,0.0,1.0);
          vec3 lit=mix(vec3(0.50,0.56,0.68),vec3(1.12,1.06,0.96),wrap);
          vec3 c=base*lit*(1.0-cav*0.20)*(0.94+0.08*n.y);
          // contours, 100 m (500 m stronger)
          float cl=vH/100.0; float cfw=fwidth(cl); float cdist=abs(fract(cl+0.5)-0.5)/max(cfw,1e-4);
          float line=1.0-smoothstep(0.4,1.4,cdist); float major=1.0-step(0.5,abs(mod(floor(cl+0.5),5.0)));
          float id=floor(mu.r*255.0+0.5); float ins=step(0.5,mu.g);
          c=mix(c,vec3(1.0),line*(1.0-smoothstep(0.12,0.40,cfw))*mix(0.13,0.30,major)*uContours*(1.0-water)*mix(0.35,1.0,ins));
          // municipality tint, dry stage, outlook stripes, hover/selection
          vec4 tint=texture2D(tTint,vec2((id+0.5)/16.0,0.5));
          c=mix(c,tint.rgb*(0.55+0.5*wrap),tint.a*uTintAmt*step(0.5,id));
          float st=uStageAmt*ins;
          c=mix(c,uStage*(0.6+0.45*wrap),st*0.32);
          float stripe=step(0.5,fract((vW.x+vW.z)*0.42));
          c=mix(c,c*0.84,stripe*uOutlook*st);
          float hv=1.0-step(0.5,abs(id-uHover)); float sl=1.0-step(0.5,abs(id-uSel));
          c=mix(c,c*1.14+vec3(0.03),hv*0.55*step(0.5,id));
          c=mix(c,c*1.08+vec3(0.07,0.06,0.0),sl*0.75*step(0.5,id));
          c*=mix(1.0,0.82,uDark);
          vec3 faded=mix(uBg,c*vec3(0.97,1.0,0.97),0.45);
          c=mix(c,faded,(1.0-ins)*uFade);
          float d=length(vW-cameraPosition);
          c=mix(c,uBg,smoothstep(uFog.x,uFog.y,d)*0.8);
          gl_FragColor=vec4(c,1.0);
        }`,
    });
    terrain = new THREE.Mesh(geo, mat); world.add(terrain);
  }

  /* ================= trees ================= */
  const TREE = { far: null, near: null, center: null, radius: 0 };
  function mergeParts(parts) { // [[geometry, part]] -> flat-shaded non-indexed geometry with 'part'
    const P = [], Nn = [], Pt = [];
    for (const [g0, part] of parts) {
      const g = g0.index ? g0.toNonIndexed() : g0; g.computeVertexNormals();
      P.push(...g.attributes.position.array); Nn.push(...g.attributes.normal.array);
      for (let i = 0; i < g.attributes.position.count; i++) Pt.push(part);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute('part', new THREE.Float32BufferAttribute(Pt, 1));
    return g;
  }
  const flat = g => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; };
  function pineGeo() {
    const t = new THREE.CylinderGeometry(0.03, 0.045, 0.22, 5, 1, true); t.translate(0, 0.11, 0);
    const a = new THREE.ConeGeometry(0.30, 0.60, 6, 1, true); a.translate(0, 0.46, 0);
    const b = new THREE.ConeGeometry(0.21, 0.46, 6, 1, true); b.translate(0, 0.77, 0); b.rotateY(0.5);
    return mergeParts([[flat(t), 0], [flat(a), 1], [flat(b), 1]]);
  }
  function leafGeo() {
    const t = new THREE.CylinderGeometry(0.03, 0.045, 0.3, 5, 1, true); t.translate(0, 0.15, 0);
    const a = new THREE.IcosahedronGeometry(0.33, 0); a.scale(1, 0.85, 1); a.translate(0, 0.58, 0);
    return mergeParts([[flat(t), 0], [flat(a), 1]]);
  }
  const treeVS = `
    attribute vec3 iPos; attribute vec4 iMisc; attribute float part;
    uniform float uRelief, uSize; uniform vec2 uTreeFade;
    varying vec3 vN; varying float vPart, vVar, vIn, vD;
    void main(){
      vec3 base=vec3(iPos.x,iPos.y*uRelief,iPos.z);
      float d=distance(base,cameraPosition);
      float s=uSize*iMisc.x*(1.0-smoothstep(uTreeFade.x,uTreeFade.y,d));
      vN=normal; vPart=part; vVar=iMisc.y; vIn=iMisc.z; vD=d;
      gl_Position=projectionMatrix*viewMatrix*vec4(base+position*s,1.0);
    }`;
  const treeFS = `
    uniform vec3 uLight, uColA, uColB, uBg; uniform vec2 uFog; uniform float uFade, uDry, uDark, uDryShift;
    varying vec3 vN; varying float vPart, vVar, vIn, vD;
    void main(){
      vec3 n=normalize(vN); float diff=max(dot(n,uLight),0.0);
      vec3 c=mix(uColA,uColB,vVar); c=mix(c,vec3(0.55,0.52,0.30),uDry*uDryShift);
      c=mix(vec3(0.36,0.27,0.19),c,step(0.5,vPart));
      c*=(0.52+0.62*diff+0.12*n.y);
      c*=mix(1.0,0.85,uDark);
      c=mix(c,mix(uBg,c,0.5),(1.0-vIn)*uFade);
      c=mix(c,uBg,smoothstep(uFog.x,uFog.y,vD)*0.8);
      gl_FragColor=vec4(c,1.0);
    }`;
  const shadowVS = `
    attribute vec3 iPos; attribute vec4 iMisc; attribute vec2 iNrm;
    uniform float uRelief, uSize; uniform vec2 uTreeFade, uShadowDir;
    varying float vR, vA;
    void main(){
      vec3 base=vec3(iPos.x,iPos.y*uRelief,iPos.z);
      float d=distance(base,cameraPosition);
      float s=uSize*iMisc.x*(1.0-smoothstep(uTreeFade.x,uTreeFade.y,d));
      vec3 n=normalize(vec3(iNrm.x*uRelief,sqrt(max(0.0,1.0-dot(iNrm,iNrm))),iNrm.y*uRelief));
      vec3 tx=normalize(vec3(1.0,0.0,0.0)-n*n.x), tz=normalize(vec3(0.0,0.0,1.0)-n*n.z);
      vec2 q=position.xy*vec2(0.36,0.27)*s+uShadowDir*s*0.30;
      vR=length(position.xy); vA=1.0-smoothstep(uTreeFade.x*0.6,uTreeFade.y*0.7,d);
      gl_Position=projectionMatrix*viewMatrix*vec4(base+tx*q.x+tz*q.y+n*(0.004*s/0.06),1.0);
    }`;
  const shadowFS = `uniform float uShadowA; varying float vR, vA; void main(){ gl_FragColor=vec4(0.10,0.12,0.06,uShadowA*vA*(1.0-smoothstep(0.55,1.0,vR))); }`;
  const TU = {
    uSize: { value: 0.09 }, uTreeFade: { value: new THREE.Vector2(90, 160) },
    uShadowDir: { value: new THREE.Vector2(-LIGHT.x, -LIGHT.z).normalize() }, uShadowA: { value: 0.30 },
  };
  function treeMaterial(colA, colB, dryShift) {
    return new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, TU, { uColA: { value: new THREE.Color(...colA) }, uColB: { value: new THREE.Color(...colB) }, uDryShift: { value: dryShift } }),
      vertexShader: treeVS, fragmentShader: treeFS,
    });
  }
  const shadowMat = () => new THREE.ShaderMaterial({ uniforms: Object.assign({}, U, TU), vertexShader: shadowVS, fragmentShader: shadowFS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const PINE = pineGeo(), LEAF = leafGeo(), DISC = (() => { const c = new THREE.CircleGeometry(1, 9); const g = new THREE.InstancedBufferGeometry(); g.index = c.index; g.setAttribute('position', c.attributes.position); return g; })();
  const MAT = { pine: treeMaterial([0.19, 0.35, 0.20], [0.30, 0.47, 0.25], 0.15), leaf: treeMaterial([0.36, 0.51, 0.25], [0.50, 0.62, 0.31], 0.45), shadow: shadowMat() };

  function makeSet(items) { // items: [x, hkm, z, scale, var, inside, nx, nz, isPine]
    const grp = new THREE.Group();
    for (const kind of ['pine', 'leaf']) {
      const L = items.filter(t => (t[8] === 1) === (kind === 'pine'));
      if (!L.length) continue;
      const iPos = new Float32Array(L.length * 3), iMisc = new Float32Array(L.length * 4), iNrm = new Float32Array(L.length * 2);
      L.forEach((t, k) => { iPos.set([t[0], t[1], t[2]], k * 3); iMisc.set([t[3], t[4], t[5], 0], k * 4); iNrm.set([t[6], t[7]], k * 2); });
      const add = (base, mat) => {
        const g = new THREE.InstancedBufferGeometry(); g.index = base.index;
        for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
        g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3)); g.setAttribute('iMisc', new THREE.InstancedBufferAttribute(iMisc, 4)); g.setAttribute('iNrm', new THREE.InstancedBufferAttribute(iNrm, 2));
        g.instanceCount = L.length;
        const m = new THREE.Mesh(g, mat); m.frustumCulled = false; grp.add(m); return m;
      };
      add(DISC, MAT.shadow).renderOrder = 1;
      add(kind === 'pine' ? PINE : LEAF, MAT[kind]).renderOrder = 2;
    }
    scene.add(grp);
    return grp;
  }
  function treeItem(c, r, s) {
    const h = meshH(c, r);
    const i = clamp(Math.round(r), 0, GH - 1) * GW + clamp(Math.round(c), 0, GW - 1);
    // pine belt ~950-2450 m with soft edges; broadleaf below, mossy broadleaf above
    const pp = clamp((h - 850) / 250, 0, 1) * (1 - clamp((h - 2350) / 200, 0, 1));
    const isPine = hash2(c * 7, r * 7, s + 9) < pp ? 1 : 0;
    // terrain normal at the tree from the mesh, for the ground shadow
    const e = 1.5, dx = (meshH(c + e, r) - meshH(c - e, r)) / 1000 / (2 * e * CXK), dz = (meshH(c, r + e) - meshH(c, r - e)) / 1000 / (2 * e * CZK);
    const L = Math.hypot(dx, 1, dz);
    return [xOfC(c), h / 1000, zOfR(r), 0.7 + 0.65 * hash2(c, r, s + 3), hash2(c, r, s + 5), inside[i] ? 1 : 0, -dx / L, -dz / L, isPine];
  }
  function clump(c, r) { // low-frequency value noise in [0,1], ~1.5 km features
    const s = 20, x = c / s, y = r / s, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash2(i, j, 77), b = hash2(i + 1, j, 77), d = hash2(i, j + 1, 77), e = hash2(i + 1, j + 1, 77);
    return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
  }
  function genTrees(c0, r0, c1, r1, step, budget, seed, density, outside) {
    const cand = [];
    let expect = 0;
    for (let r = Math.max(0, r0); r < Math.min(GH, r1); r += step) for (let c = Math.max(0, c0); c < Math.min(GW, c1); c += step) {
      const jc = c + (hash2(c, r, seed) - 0.5) * step * 0.9, jr = r + (hash2(c, r, seed + 1) - 0.5) * step * 0.9;
      const i = clamp(Math.round(jr), 0, GH - 1) * GW + clamp(Math.round(jc), 0, GW - 1);
      const p = treeFrac[i] * density * (inside[i] ? 1 : outside) * (0.3 + 1.1 * clump(jc, jr));
      if (p < 0.05) continue;
      expect += p; cand.push([jc, jr, p, hash2(c, r, seed + 2)]);
    }
    const k = Math.min(1, budget / Math.max(1, expect));
    const out = [];
    for (const t of cand) if (t[3] < t[2] * k) out.push(treeItem(t[0], t[1], seed));
    return out;
  }
  function disposeSet(grp) { if (!grp) return; scene.remove(grp); grp.children.forEach(m => m.geometry.dispose()); }
  function buildFarTrees() {
    TREE.far = makeSet(genTrees(0, 0, GW, GH, 3, MOBILE ? 12000 : 30000, 11, 0.9, 0.3));
  }
  function updateNearTrees(dist) {
    if (!treeFrac) return;
    const want = dist < 24 && state.layers.trees;
    if (!want) { if (TREE.near) { disposeSet(TREE.near); TREE.near = null; TREE.center = null; G.dirty = true; } return; }
    const t = controls.target, R = clamp(dist * 0.5, 2.0, 7.0);
    if (TREE.center && TREE.center.distanceTo(t) < R * 0.3 && Math.abs(TREE.radius - R) / R < 0.35) return;
    const c = cOfX(t.x), r = rOfZ(t.z), rc = R / CXK, rr = R / CZK;
    disposeSet(TREE.near);
    TREE.near = makeSet(genTrees(Math.floor(c - rc), Math.floor(r - rr), Math.ceil(c + rc), Math.ceil(r + rr), 1, MOBILE ? 7000 : 20000, 23, 0.5, 0.35)
      .filter(it => Math.hypot(it[0] - t.x, it[2] - t.z) < R));
    TREE.near.visible = state.layers.trees;
    TREE.center = t.clone(); TREE.radius = R; G.dirty = true;
  }

  /* ================= vector layers ================= */
  function mkMat(color, width, opacity, dashed) {
    const m = new THREE.LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, dashed: !!dashed, dashSize: 0.5, gapSize: 0.38, depthTest: true });
    m.userData.base = width; const r = vp.getBoundingClientRect(); m.resolution.set(r.width, r.height); lineMats.push(m); return m;
  }
  function drape(lines, lift, step = 1.1) { // lines of [lon,lat] -> segment positions on the mesh
    const out = [];
    for (const ln of lines) {
      let prev = null;
      for (const p of ln) {
        const c = cOfLon(p[0]), r = rOfLat(p[1]);
        if (prev && (inArea(p) || inArea(prev.ll))) {
          const n = Math.max(1, Math.ceil(Math.hypot(c - prev.c, r - prev.r) / step));
          let ac = prev.c, ar = prev.r;
          for (let s = 1; s <= n; s++) {
            const bc = prev.c + (c - prev.c) * s / n, br = prev.r + (r - prev.r) * s / n;
            out.push(xOfC(ac), meshH(ac, ar) / 1000 + lift, zOfR(ar), xOfC(bc), meshH(bc, br) / 1000 + lift, zOfR(br));
            ac = bc; ar = br;
          }
        }
        prev = { c, r, ll: p };
      }
    }
    return new Float32Array(out);
  }
  function mkLines(lines, mat, lift, step, fadeOut) {
    const P = drape(lines, lift, step);
    if (!P.length) return null;
    const g = new THREE.LineSegmentsGeometry(); g.setPositions(P);
    const l = new THREE.LineSegments2(g, mat); l.computeLineDistances(); world.add(l);
    if (fadeOut) {
      const nv = P.length / 3, ins = new Uint8Array(nv);
      for (let v = 0; v < nv; v++) ins[v] = gridAt(inside, cOfX(P[v * 3]), rOfZ(P[v * 3 + 2]));
      l.userData.inside = ins; l.userData.base = new THREE.Color(mat.color); mat.vertexColors = true;
    }
    return l;
  }
  function colourLines(l, base, k) { // inside: base colour; outside: blended toward the background
    const ins = l?.userData.inside; if (!ins) return;
    const a = new Float32Array(ins.length * 3), out = base.clone().lerp(U.uBg.value, k);
    for (let v = 0; v < ins.length; v++) { const c = ins[v] ? base : out; a[v * 3] = c.r; a[v * 3 + 1] = c.g; a[v * 3 + 2] = c.b; }
    l.geometry.setColors(a); l.material.color.set(0xffffff); l.material.needsUpdate = true;
  }
  const L = {};
  function buildBoundaries(b) {
    L.mun = mkLines(MUNI.map(m => m.ring.concat([m.ring[0]])), mkMat(0x233f37, 1.0, 0.5, true), 0.03, 1.0);
    L.prov = mkLines([b.prov.concat([b.prov[0]])], mkMat(0x153f36, 2.4, 1), 0.035, 1.0);
  }
  let OSM = null;
  function buildOSM(osm) {
    OSM = osm;
    const rd = osm.roads || {};
    const W = { trunk: [2.4, 0xf7f1e6, 1], primary: [1.9, 0xf7f1e6, 1], secondary: [1.4, 0xf4ede0, 1], tertiary: [1.0, 0xeee6d8, 1] };
    L.roads = Object.entries(W).map(([k, [w, col, op]]) => mkLines((rd[k] || []).map(decodeLine), mkMat(col, w, op), 0.012 + w * 0.002, 1.0, true)).filter(Boolean);
    const rivers = (osm.rivers || []).map(r => ({ n: r.n, ll: decodeLine(r.c) }));
    const named = rivers.filter(r => r.n), unnamed = rivers.filter(r => !r.n);
    L.rivers = [mkLines(unnamed.map(r => r.ll), mkMat(0x5d9cc0, 1.0, 1), 0.010, 1.0, true), mkLines(named.filter(r => r.n !== 'Agno River').map(r => r.ll), mkMat(0x3f8db5, 1.5, 1), 0.012, 1.0, true)].filter(Boolean);
    const agno = named.filter(r => r.n === 'Agno River').map(r => r.ll);
    if (agno.length) { if (L.agno) world.remove(L.agno); L.agno = mkLines(agno, mkMat(0x2b7a96, 2.6, 1), 0.016, 0.8); }
    L.streams = mkLines((osm.streams || []).map(s => decodeLine(s.c)), mkMat(0x5a9fc4, 0.8, 0.6), 0.009, 1.2);
    buildOsmLabels(rivers);
    applyTheme(); sync();
  }

  /* ================= labels and markers ================= */
  const labels = [];
  const vtmp = new THREE.Vector3();
  function addLabel(html, lon, lat, cls, opt = {}) {
    const el = document.createElement('div'); el.className = 'lbl ' + (cls || ''); el.innerHTML = html; el.style.display = 'none'; labelsEl.appendChild(el);
    const o = { el, c: cOfLon(lon), r: rOfLat(lat), lon, lat, cls: cls || '', lift: opt.lift ?? 0.08, pri: opt.pri ?? 4, maxD: opt.maxD ?? 1e9, extra: opt.extra || {}, w: 0, h: 0, always: !!opt.always };
    labels.push(o); return o;
  }
  const damLabels = [];
  // what each dam is for, so a dam on the map isn't taken for the towns' tap water (Wikipedia: Ambuklao, Binga, San Roque)
  const DAM_USE = { Ambuklao: 'Hydropower. It doesn’t supply tap water.', Binga: 'Hydropower. It doesn’t supply tap water.', 'San Roque': 'Power, irrigation and flood control downstream. It doesn’t supply tap water.' };
  function buildBaseLabels(b, agno) {
    MUNI.forEach((m, k) => addLabel(esc(m.n), m.label[0], m.label[1], m.n === 'Baguio City' ? 'city muni' : 'muni', { pri: m.n === 'Baguio City' ? 9 : 6, lift: 0.1, extra: { k } }));
    for (const [id, d] of Object.entries(agno.dams)) {
      const o = addLabel(damIcon() + esc(id) + '<span class="lv"></span>', d.lon, d.lat, 'dam', { pri: 5, lift: 0.06, extra: { dam: id } });
      if (DAM_USE[id]) {
        o.el.addEventListener('pointerenter', ev => showTip(`<b>${esc(id)}</b><br>${esc(DAM_USE[id])}`, ev.clientX, ev.clientY));
        o.el.addEventListener('pointerleave', hideTip);
      }
      damLabels.push(o);
    }
  }
  function buildOsmLabels(rivers) {
    const munis = new Set(MUNI.map(m => m.n.replace(' City', '')));
    for (const p of OSM.places || []) {
      const [name, type, x, y] = p; const lon = 120 + x / 1e5, lat = 16 + y / 1e5;
      if (!inArea([lon, lat], -0.01) || munis.has(name) || name === 'Baguio') continue;
      const ins = gridAt(inside, cOfLon(lon), rOfLat(lat));
      if (type === 'town' || type === 'city') addLabel(esc(name), lon, lat, 'town', { pri: ins ? 4 : 2, maxD: ins ? 90 : 55, lift: 0.06 });
      else if (ins) addLabel(esc(name), lon, lat, 'brgy', { pri: 1, maxD: 16, lift: 0.04 });
    }
    const peaks = (OSM.peaks || []).map(([n, e, x, y]) => ({ n, e, lon: 120 + x / 1e5, lat: 16 + y / 1e5 })).filter(p => inArea([p.lon, p.lat], -0.005) && gridAt(inside, cOfLon(p.lon), rOfLat(p.lat)))
      .sort((a, b) => (b.e || 0) - (a.e || 0));
    peaks.forEach((p, k) => addLabel(`▲ ${esc(p.n.replace(/^Mount /, 'Mt '))}${p.e ? ` <span class="mono">${p.e.toLocaleString()}</span>` : ''}`, p.lon, p.lat, 'peak', { pri: k < 3 ? 7 : 3, maxD: k < 3 ? 1e9 : k < 12 ? 45 : 20, lift: 0.04 }));
    const byName = {};
    rivers.filter(r => r.n).forEach(r => { const len = r.ll.length; if (!byName[r.n] || len > byName[r.n].ll.length) byName[r.n] = r; });
    Object.values(byName).forEach(r => {
      const inPts = r.ll.filter(p => inArea(p, -0.01) && gridAt(inside, cOfLon(p[0]), rOfLat(p[1])));
      if (inPts.length < 4) return;
      const p = inPts[Math.floor(inPts.length * 0.45)];
      addLabel(esc(r.n), p[0], p[1], 'river', { pri: r.n === 'Agno River' ? 6 : 3, maxD: r.n === 'Agno River' ? 1e9 : 45, lift: 0.03 });
    });
    G.dirty = true;
  }
  const fireMarks = [];
  function setFires(fires) {
    fireMarks.splice(0).forEach(f => f.el.remove());
    for (let i = labels.length - 1; i >= 0; i--) if (labels[i].cls.includes('fire')) labels.splice(i, 1);
    for (const f of fires || []) {
      if (!inArea([f.lon, f.lat])) continue;
      const o = addLabel('', f.lon, f.lat, 'fire', { always: true, lift: 0.02, extra: { f } });
      o.el.title = ''; fireMarks.push(o);
      o.el.addEventListener('pointerenter', ev => showTip(`<b>Active fire detection</b><br>${esc(f.date)} ${esc(f.time)} UTC · ${esc(f.src.replace(/_/g, ' '))}<br>Confidence <span class="mono">${esc(f.conf)}</span>${f.frp ? ` · FRP <span class="mono">${f.frp.toFixed(1)} MW</span>` : ''}`, ev.clientX, ev.clientY));
      o.el.addEventListener('pointerleave', hideTip);
    }
    G.dirty = true;
  }

  /* ================= theme and state sync ================= */
  function applyTheme() {
    const bg = new THREE.Color(css('--vp')); scene.background = bg; U.uBg.value.copy(bg);
    const dark = bg.r + bg.g + bg.b < 1.0; U.uDark.value = dark ? 1 : 0;
    if (L.prov) L.prov.material.color.set(dark ? 0xe9f2ec : 0x153f36);
    if (L.mun) { L.mun.material.color.set(dark ? 0xbcd0c6 : 0x233f37); L.mun.material.opacity = dark ? 0.45 : 0.5; }
    if (L.agno) L.agno.material.color.set(css('--water'));
    (L.roads || []).forEach(l => colourLines(l, new THREE.Color(dark ? 0xd9d2c4 : 0xf7f1e6), 0.72));
    (L.rivers || []).forEach(l => colourLines(l, l.userData.base, 0.6));
    G.dirty = true;
  }
  function sync() {
    const Ly = state.layers, m = state.mode;
    if (terrain) { U.uCover.value = Ly.terrain ? 1 : 0; U.uContours.value = Ly.contours ? 1 : 0; }
    if (TREE.far) TREE.far.visible = Ly.trees;
    if (TREE.near) TREE.near.visible = Ly.trees;
    (L.roads || []).forEach(l => l.visible = Ly.roads);
    (L.rivers || []).forEach(l => { l.visible = Ly.rivers; });
    if (L.streams) L.streams.visible = Ly.rivers && (m === 'water');
    if (L.agno) { L.agno.visible = Ly.rivers || m === 'water'; L.agno.material.linewidth = L.agno.material.userData.base * (m === 'water' ? 1.5 : 1); }
    if (L.mun) L.mun.visible = Ly.munis;
    U.uSel.value = state.sel ? MUNI.findIndex(x => x.n === state.sel) + 1 : -1;
    labels.forEach(l => { if (l.extra.k !== undefined) l.el.classList.toggle('sel', MUNI[l.extra.k].n === state.sel); l.w = 0; });
    fireMarks.forEach(f => f.el.classList.toggle('off', !Ly.fires));
    lastDist = -1; G.dirty = true;
  }

  /* ================= picking ================= */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(ev) {
    if (!HV) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction, s = state.layers.relief;
    const dist = camera.position.distanceTo(controls.target);
    let t = 0, prev = null; const step = Math.max(0.03, dist * 0.004);
    while (t < 800) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, c = cOfX(x), rr = rOfZ(z);
      if (c >= 0 && c <= GW - 1 && rr >= 0 && rr <= GH - 1 && y <= meshH(c, rr) / 1000 * s) {
        let a = prev ?? t, b = t;
        for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (o.y + d.y * m <= meshH(cOfX(o.x + d.x * m), rOfZ(o.z + d.z * m)) / 1000 * s) b = m; else a = m; }
        return { c: cOfX(o.x + d.x * b), r: rOfZ(o.z + d.z * b) };
      }
      prev = t; t += step * (1 + t / (dist * 1.2));
    }
    return null;
  }
  const muniAt = (c, r) => (muniId ? gridAt(muniId, c, r) - 1 : -1);
  let hoverRAF = 0, lastEv = null, downAt = null;
  canvas.addEventListener('pointermove', ev => {
    lastEv = ev; if (hoverRAF) return;
    hoverRAF = requestAnimationFrame(() => {
      hoverRAF = 0; const p = pick(lastEv);
      if (!p) { U.uHover.value = -1; hideTip(); G.dirty = true; return; }
      const k = muniAt(p.c, p.r), h = Math.round(meshH(p.c, p.r)), lon = lonOfC(p.c), lat = latOfR(p.r);
      U.uHover.value = k >= 0 ? k + 1 : -1; G.dirty = true;
      const ins = gridAt(inside, p.c, p.r);
      const name = k >= 0 ? MUNI[k].n : ins ? 'Benguet' : 'Outside Benguet';
      const cv = cls ? COVER_NAMES[gridAt(cls, p.c, p.r)] : null;
      const extra = k >= 0 && hoverExtra ? hoverExtra(MUNI[k].n) : '';
      showTip(`<b>${esc(name)}</b> · <span class="mono">${h.toLocaleString()} m</span>${cv ? ' · ' + esc(cv) : ''}${extra ? '<br>' + extra : ''}<br><span class="mono">${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E</span>`, lastEv.clientX, lastEv.clientY);
    });
  });
  canvas.addEventListener('pointerleave', () => { U.uHover.value = -1; hideTip(); G.dirty = true; });
  canvas.addEventListener('pointerdown', ev => { downAt = [ev.clientX, ev.clientY]; });
  canvas.addEventListener('pointerup', ev => {
    if (!downAt) return; const moved = Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]); downAt = null; if (moved > 5) return;
    const p = pick(ev); const k = p ? muniAt(p.c, p.r) : -1; onSelect(k >= 0 ? MUNI[k].n : null);
  });
  controls.addEventListener('change', () => { G.dirty = true; });

  /* ================= frame loop ================= */
  const compassSvg = document.querySelector('#compass svg');
  let stageAnim = null;
  function frame(now) {
    requestAnimationFrame(frame);
    if (tween) {
      const k = Math.min(1, (now - tween.s) / tween.ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e); if (k >= 1) tween = null; G.dirty = true;
    }
    if (stageAnim) {
      const k = Math.min(1, (now - stageAnim.s) / 400);
      U.uStageAmt.value = stageAnim.a0 + (stageAnim.a1 - stageAnim.a0) * k; U.uDry.value = stageAnim.d0 + (stageAnim.d1 - stageAnim.d0) * k;
      U.uStage.value.copy(stageAnim.c0).lerp(stageAnim.c1, k); if (k >= 1) stageAnim = null; G.dirty = true;
    }
    controls.update();
    if (!G.dirty || canvas.hidden) return; G.dirty = false;
    const dist = camera.position.distanceTo(controls.target);
    if (Math.abs(dist - lastDist) > 1e-3) {
      lastDist = dist;
      camera.near = clamp(dist * 0.003, 0.01, 1.5); camera.far = Math.max(500, dist * 8); camera.updateProjectionMatrix();
      U.uFog.value.set(Math.max(45, dist * 1.7), Math.max(140, dist * 4.2));
      TU.uSize.value = clamp(0.058 * Math.pow(dist / 3, 0.22), 0.05, 0.16);
      const fn = Math.max(9, Math.min(dist * 2.2, 70)); TU.uTreeFade.value.set(fn, fn * 1.7);
      const zf = Math.pow(clamp(55 / dist, 1, 6), 0.55);
      lineMats.forEach(m => { m.linewidth = m.userData.base * zf * (m === L.agno?.material && state.mode === 'water' ? 1.5 : 1); });
    }
    updateNearTrees(dist);
    renderer.render(scene, camera);
    const az = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    if (compassSvg) compassSvg.style.transform = `rotate(${az * 180 / Math.PI}deg)`;
    // labels with priority + collision
    const rect = vp.getBoundingClientRect(), show = state.layers.labels, placed = [], s = state.layers.relief;
    const pri = l => (l.extra.k !== undefined && MUNI[l.extra.k].n === state.sel) ? 10 : l.cls.includes('dam') ? (state.mode === 'water' ? 8 : l.pri) : l.pri;
    const order = labels.slice().sort((a, b) => pri(b) - pri(a));
    for (const l of order) {
      const isFire = l.cls.includes('fire');
      const vis = isFire ? state.layers.fires : show && dist < l.maxD && (!l.cls.includes('dam') || state.mode === 'water' || state.layers.rivers) && (!l.cls.includes('river') || state.layers.rivers);
      if (!vis) { l.el.style.display = 'none'; continue; }
      vtmp.set(xOfC(l.c), (meshH(l.c, l.r) / 1000 + l.lift) * s, zOfR(l.r)).project(camera);
      if (vtmp.z > 1 || Math.abs(vtmp.x) > 1.05 || Math.abs(vtmp.y) > 1.05) { l.el.style.display = 'none'; continue; }
      const x = (vtmp.x + 1) / 2 * rect.width, y = (1 - vtmp.y) / 2 * rect.height;
      if (l.el.style.display === 'none') l.el.style.display = '';
      if (isFire) { l.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`; continue; }
      if (!l.w) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
      const bx = [x - l.w / 2 - 2, y - l.h * 1.15 - 2, x + l.w / 2 + 2, y - l.h * 0.15 + 2];
      if (placed.some(p => bx[0] < p[2] && bx[2] > p[0] && bx[1] < p[3] && bx[3] > p[1])) { l.el.style.display = 'none'; continue; }
      placed.push(bx); l.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-115%)`;
    }
  }
  requestAnimationFrame(frame);

  /* ================= load ================= */
  async function load(boundaries, agno) {
    msg('Loading terrain…');
    const coverP = loadCover().catch(e => { console.warn('land cover unavailable', e); return null; });
    try {
      H = await loadTerrain((d, n) => msg(`Loading terrain · ${d}/${n} tiles`));
    } catch (e) {
      msg(`<b>Terrain tiles didn’t load.</b><br><span>${esc(e.message || e)}. The rest of the page still works.</span>`);
      throw e;
    }
    msg('Reading land cover…');
    cls = await coverP;
    G.coverOk = !!cls;
    msg('Building the map…');
    await new Promise(r => setTimeout(r, 20));
    buildTerrain(boundaries);
    buildBoundaries(boundaries);
    if (!L.agno && agno.stem) L.agno = mkLines([agno.stem], mkMat(0x2b7a96, 2.6, 1), 0.016, 0.8);
    buildBaseLabels(boundaries, agno);
    buildFarTrees();
    applyTheme(); sync(); msg('');
    G.ready = true; G.dirty = true;
    if (G.pendingOSM) { buildOSM(G.pendingOSM); G.pendingOSM = null; }
    onReady && onReady();
  }

  Object.assign(G, {
    ok: true, renderer, scene, camera, controls, world, U, PRESET, flyTo, flyPreset, applyTheme, sync, load, setFires,
    setOSM(osm) { if (G.ready && osm && !OSM) buildOSM(osm); else G.pendingOSM = osm; },
    setStage(color, amt, outlook, dry) {
      const c1 = color ? new THREE.Color(color) : U.uStage.value.clone();
      stageAnim = { s: performance.now(), a0: U.uStageAmt.value, a1: amt, c0: U.uStage.value.clone(), c1, d0: U.uDry.value, d1: dry };
      U.uOutlook.value = outlook ? 1 : 0; G.dirty = true;
    },
    setRelief(v) { world.scale.y = v; U.uRelief.value = v; if (TREE.near) { TREE.center = null; } G.dirty = true; },
    setDamLevels(levels, show) { damLabels.forEach(l => { const v = levels[l.extra.dam]; l.el.querySelector('.lv').textContent = show && v != null ? v.toFixed(2) + ' m' : ''; l.w = 0; }); G.dirty = true; },
    setMuniTint(colors, amt) { // colors: {name: [r,g,b] 0-255}
      if (!muniTint) return; const d = muniTint.image.data; d.fill(0);
      MUNI.forEach((m, k) => { const c = colors[m.n]; if (c) d.set([c[0], c[1], c[2], 255], (k + 1) * 4); });
      muniTint.needsUpdate = true; U.uTintAmt.value = amt; G.dirty = true;
    },
    damPos(id, dist, agno) {
      const d = agno.dams[id]; const c = cOfLon(d.lon), r = rOfLat(d.lat), x = xOfC(c), z = zOfR(r), y = meshH(c, r) / 1000 * state.layers.relief;
      return { tgt: new THREE.Vector3(x, y, z), pos: new THREE.Vector3(x - dist * 0.45, y + dist * 0.62, z + dist * 0.64) };
    },
    focusMuni(name) {
      const m = MUNI.find(x => x.n === name); if (!m) return;
      const c = cOfLon(m.label[0]), r = rOfLat(m.label[1]), x = xOfC(c), z = zOfR(r), y = meshH(c, r) / 1000 * state.layers.relief;
      const dist = clamp(Math.sqrt(m.area) * 1.6, 9, 40), dir = camera.position.clone().sub(controls.target).normalize();
      const tgt = new THREE.Vector3(x, y, z); flyTo(tgt.clone().add(dir.multiplyScalar(dist)), tgt, 900);
    },
    muniNames: () => MUNI.map(m => m.n),
    lookAt(lon, lat, dist, tiltDeg = 50, azDeg = 200, ms = 0) { // azimuth: compass bearing the camera looks toward
      const c = cOfLon(lon), r = rOfLat(lat), y = meshH(c, r) / 1000 * state.layers.relief;
      const tgt = new THREE.Vector3(xOfC(c), y, zOfR(r)), t = tiltDeg * Math.PI / 180, a = azDeg * Math.PI / 180;
      const pos = tgt.clone().add(new THREE.Vector3(-Math.sin(a) * Math.sin(t), Math.cos(t), Math.cos(a) * Math.sin(t)).multiplyScalar(dist));
      if (ms) flyTo(pos, tgt, ms); else { userMoved = true; camera.position.copy(pos); controls.target.copy(tgt); controls.update(); G.dirty = true; }
    },
  });
  return G;
}
