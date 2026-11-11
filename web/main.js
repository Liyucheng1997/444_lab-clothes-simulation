// 实时布料模拟：薄丝袜（XPBD 弹性薄膜 + 距离场碰撞 + 摩擦锚定）与百褶裙（XPBD 布料 + 风）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const meta = await (await fetch('data/meta.json')).json();
const bin = async (n) => (await fetch('data/' + n)).arrayBuffer();
const [bodyPos, bodyNrm, bodyIdx, stPos, stIdx, sdfRaw] = await Promise.all([
  bin('body_pos.bin'), bin('body_nrm.bin'), bin('body_idx.bin'),
  bin('stocking_pos.bin'), bin('stocking_idx.bin'), bin('sdf.bin')]);

// ------------------------------------------------------------------ 距离场
const SD = meta.sdf, [NX, NY, NZ] = SD.dims, [OX, OY, OZ] = SD.origin, CELL = SD.cell;
const sdfData = new Float32Array(NX * NY * NZ);
{ const s = new Int16Array(sdfRaw), k = SD.range / 32767; for (let i = 0; i < s.length; i++) sdfData[i] = s[i] * k; }
function sdf(x, y, z) {
  let fx = (x - OX) / CELL, fy = (y - OY) / CELL, fz = (z - OZ) / CELL;
  fx = fx < 0 ? 0 : fx > NX - 1.001 ? NX - 1.001 : fx;
  fy = fy < 0 ? 0 : fy > NY - 1.001 ? NY - 1.001 : fy;
  fz = fz < 0 ? 0 : fz > NZ - 1.001 ? NZ - 1.001 : fz;
  const ix = fx | 0, iy = fy | 0, iz = fz | 0, tx = fx - ix, ty = fy - iy, tz = fz - iz;
  const i0 = ix + NX * (iy + NY * iz), i1 = i0 + NX * NY, d = sdfData;
  const a = d[i0] + (d[i0 + 1] - d[i0]) * tx, b = d[i0 + NX] + (d[i0 + NX + 1] - d[i0 + NX]) * tx;
  const c = d[i1] + (d[i1 + 1] - d[i1]) * tx, e = d[i1 + NX] + (d[i1 + NX + 1] - d[i1 + NX]) * tx;
  const ab = a + (b - a) * ty, ce = c + (e - c) * ty;
  return ab + (ce - ab) * tz;
}
const G = [0, 0, 0];
function sdfGrad(x, y, z) {
  const e = CELL * 0.5;
  let gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1; G[0] = gx / l; G[1] = gy / l; G[2] = gz / l;
}

// ------------------------------------------------------------------ 场景
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 3.2, 6.5);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 30);
camera.position.set(0.15, 0.68, 1.75);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.56, 0); controls.enableDamping = true; controls.minDistance = 0.35; controls.maxDistance = 4;
controls.maxPolarAngle = Math.PI * 0.52; controls.update();

scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x1a1512, 0.45));
const key = new THREE.DirectionalLight(0xfff4ea, 2.6); key.position.set(0.7, 2.0, 2.2);
key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.004;
Object.assign(key.shadow.camera, { left: -0.9, right: 0.9, top: 1.3, bottom: -0.3, near: 0.5, far: 6 });
scene.add(key);
for (const sx of [-1, 1]) { const l = new THREE.DirectionalLight(0xdde8ff, 1.5); l.position.set(sx * 1.6, 1.1, -1.6); scene.add(l); }
const fill = new THREE.DirectionalLight(0xe8eeff, 0.5); fill.position.set(-1.5, 0.6, 1.5); scene.add(fill);

const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardMaterial({ color: 0x4a4a4d, roughness: 0.92 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; floor.receiveShadow = true; scene.add(floor);

const bodyGroup = new THREE.Group(); scene.add(bodyGroup);
{
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bodyPos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bodyNrm), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(bodyIdx), 1));
  const m = new THREE.MeshPhysicalMaterial({ color: 0xf2c3b2, roughness: 0.52, sheen: 0.35, sheenColor: 0xff9d8a, sheenRoughness: 0.6 });
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = mesh.receiveShadow = true; bodyGroup.add(mesh);
}

// ------------------------------------------------------------------ 通用：法线与拉伸
function computeNormals(idx, x, nrm, restArea, stretch, cnt) {
  nrm.fill(0); if (stretch) stretch.fill(0);
  for (let t = 0, f = 0; t < idx.length; t += 3, f++) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2];
    const vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz; nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz; nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    if (stretch) { const s = Math.hypot(nx, ny, nz) * 0.5 / restArea[f]; stretch[idx[t]] += s; stretch[idx[t + 1]] += s; stretch[idx[t + 2]] += s; }
  }
  for (let i = 0, n = nrm.length / 3; i < n; i++) {
    const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l;
    if (stretch) stretch[i] /= cnt[i];
  }
}
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ 丝袜（在人体局部坐标系中解算）
const ST = (() => {
  const rest = new Float32Array(stPos), idx = new Uint32Array(stIdx), n = rest.length / 3;
  const x = rest.slice(), p = rest.slice(), v = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const w = new Float32Array(n).fill(1), fixed = new Uint8Array(n), grabbed = new Uint8Array(n);
  const stretch = new Float32Array(n).fill(1), cnt = new Float32Array(n), restArea = new Float32Array(idx.length / 3);
  for (let i = 0; i < n; i++) if (rest[i * 3 + 1] > 0.888 || rest[i * 3 + 1] < 0.004) fixed[i] = 1;
  const seen = new Set(), ea = [], eb = [];
  for (let t = 0, f = 0; t < idx.length; t += 3, f++) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3], key2 = a < b ? a * n + b : b * n + a;
      if (!seen.has(key2)) { seen.add(key2); ea.push(a); eb.push(b); }
      cnt[a]++;
    }
  }
  const E = ea.length, e0 = new Uint32Array(ea), e1 = new Uint32Array(eb), eL = new Float32Array(E);
  for (let e = 0; e < E; e++) eL[e] = 0.97 * Math.hypot(rest[e0[e] * 3] - rest[e1[e] * 3], rest[e0[e] * 3 + 1] - rest[e1[e] * 3 + 1], rest[e0[e] * 3 + 2] - rest[e1[e] * 3 + 2]);
  computeNormals(idx, rest, nrm, null, null, null);
  for (let t = 0, f = 0; t < idx.length; t += 3, f++) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = rest[b] - rest[a], uy = rest[b + 1] - rest[a + 1], uz = rest[b + 2] - rest[a + 2];
    const vx = rest[c] - rest[a], vy = rest[c + 1] - rest[a + 1], vz = rest[c + 2] - rest[a + 2];
    restArea[f] = Math.max(0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx), 1e-9);
  }
  return { rest, idx, n, x, p, v, nrm, w, fixed, grabbed, stretch, cnt, restArea, E, e0, e1, eL, edgeSoft: 1.0 };
})();

const MARGIN = 0.0016, STRAIN_LIMIT = 1.55;
function stepStocking(dt, grab) {
  const { rest, n, x, p, v, w, fixed, grabbed, E, e0, e1, eL } = ST;
  // 锚定权重：抓取点周围自由，越远越被“摩擦”固定在腿上；拉得越远，被带起的范围越大
  if (grab) {
    const gc = grab.centre, pull = Math.hypot(grab.target.x - gc[0], grab.target.y - gc[1], grab.target.z - gc[2]);
    const r0 = Math.min(0.05 + 0.6 * pull, 0.17), r1 = r0 + 0.08;
    for (let i = 0; i < n; i++) {
      const dx = rest[i * 3] - gc[0], dy = (rest[i * 3 + 1] - gc[1]) * 0.75, dz = rest[i * 3 + 2] - gc[2];
      const t = smooth(r0, r1, Math.sqrt(dx * dx + dy * dy + dz * dz));
      w[i] += (t - w[i]) * 0.35;
    }
  } else for (let i = 0; i < n; i++) w[i] += (1 - w[i]) * Math.min(1, dt * 5);

  const SUB = 8, h = dt / SUB, soft = ST.edgeSoft, damp = Math.pow(0.02, h);       // 速度阻尼
  for (let s = 0; s < SUB; s++) {
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (fixed[i]) { x[j] = p[j] = rest[j]; x[j + 1] = p[j + 1] = rest[j + 1]; x[j + 2] = p[j + 2] = rest[j + 2]; continue; }
      p[j] = x[j]; p[j + 1] = x[j + 1]; p[j + 2] = x[j + 2];
      x[j] += v[j] * h; x[j + 1] += v[j + 1] * h; x[j + 2] += v[j + 2] * h;
    }
    if (grab) for (let k = 0; k < grab.ids.length; k++) {
      const j = grab.ids[k] * 3;
      x[j] = grab.target.x + grab.off[k * 3]; x[j + 1] = grab.target.y + grab.off[k * 3 + 1]; x[j + 2] = grab.target.z + grab.off[k * 3 + 2];
    }
    for (let e = 0; e < E; e++) {                                               // 弹性边
      const a = e0[e], b = e1[e], ja = a * 3, jb = b * 3;
      const wa = (fixed[a] || grabbed[a]) ? 0 : 1, wb = (fixed[b] || grabbed[b]) ? 0 : 1;
      if (wa + wb === 0) continue;
      const dx = x[jb] - x[ja], dy = x[jb + 1] - x[ja + 1], dz = x[jb + 2] - x[ja + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      // 尼龙的应变硬化：小变形时很软，拉到极限长度后变硬，拉伸因此向四周扩散而不是集中在指尖
      const lim = eL[e] * STRAIN_LIMIT, c = l > lim ? (l - lim) / (l * (wa + wb)) + (lim - eL[e]) / (l * (wa + wb + soft)) : (l - eL[e]) / (l * (wa + wb + soft));
      x[ja] += dx * c * wa; x[ja + 1] += dy * c * wa; x[ja + 2] += dz * c * wa;
      x[jb] -= dx * c * wb; x[jb + 1] -= dy * c * wb; x[jb + 2] -= dz * c * wb;
    }
    for (let i = 0; i < n; i++) {
      if (fixed[i] || grabbed[i]) continue;
      const j = i * 3, wi = w[i];
      if (wi > 0.01) {                                                           // 锚定弹簧
        const k = wi / (wi + 6.0);
        x[j] += (rest[j] - x[j]) * k; x[j + 1] += (rest[j + 1] - x[j + 1]) * k; x[j + 2] += (rest[j + 2] - x[j + 2]) * k;
      }
      const d = sdf(x[j], x[j + 1], x[j + 2]);                                    // 与腿碰撞
      if (d < MARGIN) {
        sdfGrad(x[j], x[j + 1], x[j + 2]);
        const push = MARGIN - d; x[j] += G[0] * push; x[j + 1] += G[1] * push; x[j + 2] += G[2] * push;
        const mx = x[j] - p[j], my = x[j + 1] - p[j + 1], mz = x[j + 2] - p[j + 2], mn = mx * G[0] + my * G[1] + mz * G[2];
        const fr = 0.25;                                                          // 切向摩擦
        x[j] -= (mx - G[0] * mn) * fr; x[j + 1] -= (my - G[1] * mn) * fr; x[j + 2] -= (mz - G[2] * mn) * fr;
      }
      if (x[j + 1] < 0.001) x[j + 1] = 0.001;
      v[j] = (x[j] - p[j]) / h * damp; v[j + 1] = (x[j + 1] - p[j + 1]) / h * damp; v[j + 2] = (x[j + 2] - p[j + 2]) / h * damp;
    }
  }
}

// 丝袜材质：覆盖率模型  alpha = 1-(1-c)^(1/cosθ),  c = c0 / 拉伸
const stUniforms = { uCov: { value: 0.34 } };
const stGeo = new THREE.BufferGeometry();
stGeo.setAttribute('position', new THREE.BufferAttribute(ST.x, 3).setUsage(THREE.DynamicDrawUsage));
stGeo.setAttribute('normal', new THREE.BufferAttribute(ST.nrm, 3).setUsage(THREE.DynamicDrawUsage));
stGeo.setAttribute('stretch', new THREE.BufferAttribute(ST.stretch, 1).setUsage(THREE.DynamicDrawUsage));
stGeo.setAttribute('rest', new THREE.BufferAttribute(ST.rest, 3));
stGeo.setIndex(new THREE.BufferAttribute(ST.idx, 1));
stGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 3);
const stMat = new THREE.MeshPhysicalMaterial({
  color: 0xdedcde, roughness: 0.42, sheen: 1.0, sheenColor: 0xffffff, sheenRoughness: 0.35,
  transparent: true, side: THREE.DoubleSide, depthWrite: false });
stMat.onBeforeCompile = (sh) => {
  sh.uniforms.uCov = stUniforms.uCov;
  sh.vertexShader = 'attribute float stretch;\nattribute vec3 rest;\nvarying float vStretch;\nvarying vec3 vRest;\n' +
    sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvStretch = stretch; vRest = rest;');
  sh.fragmentShader = 'uniform float uCov;\nvarying float vStretch;\nvarying vec3 vRest;\n' +
    'float hash3(vec3 q){ q = fract(q * 0.3183099 + 0.1); q *= 17.0; return fract(q.x * q.y * q.z * (q.x + q.y + q.z)); }\n' +
    sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float cv = max(abs(dot(normalize(vViewPosition), normal)), 0.10);
      float ph = vRest.y * 5200.0;                                   // 针织横纹，随布料拉伸
      float fade = clamp(1.0 - fwidth(ph) / 2.5, 0.0, 1.0);
      float knit = 1.0 + 0.16 * sin(ph) * fade;
      vec3 cellp = vRest * 1400.0; float cfade = clamp(1.0 - fwidth(cellp.x + cellp.y + cellp.z) / 1.5, 0.0, 1.0);
      float grain = mix(1.0, 0.82 + 0.36 * hash3(floor(cellp)), cfade);
      float cov = clamp(uCov / pow(clamp(vStretch, 0.55, 3.0), 0.75) * knit * grain, 0.0, 0.97);
      diffuseColor.a = 1.0 - pow(1.0 - cov, 1.0 / cv);
      diffuseColor.rgb *= 0.92 + 0.16 * grain;`);
};
const stMesh = new THREE.Mesh(stGeo, stMat); stMesh.frustumCulled = false; stMesh.renderOrder = 2; bodyGroup.add(stMesh);
const wireIdx = new Uint32Array(ST.E * 2); for (let e = 0; e < ST.E; e++) { wireIdx[e * 2] = ST.e0[e]; wireIdx[e * 2 + 1] = ST.e1[e]; }
const wireGeo = new THREE.BufferGeometry(); wireGeo.setAttribute('position', stGeo.getAttribute('position')); wireGeo.setIndex(new THREE.BufferAttribute(wireIdx, 1));
const wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55 }));
wire.frustumCulled = false; wire.visible = false; wire.renderOrder = 3; bodyGroup.add(wire);

// ------------------------------------------------------------------ 百褶裙（世界坐标系中解算）
const SK = (() => {
  const NP = 30, SEG = 6, ROWS = 34, cols = NP * SEG, n = cols * (ROWS + 1), YTOP = 0.975, LEN = 0.285;
  const rest = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let r = 0; r <= ROWS; r++) {
    const vv = r / ROWS, flare = Math.pow(vv, 0.62);
    const rx = 0.152 + 0.11 * flare, ry = 0.106 + 0.119 * flare, depth = 0.0015 + 0.019 * Math.pow(vv, 0.8);
    for (let k = 0; k < cols; k++) {
      const th = 2 * Math.PI * k / cols, saw = (k % SEG) / (SEG - 1), c = Math.cos(th), s = Math.sin(th);
      let nx = c / rx, nz = -s / ry; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
      const i = r * cols + k, o = depth * (saw - 0.5);
      rest[i * 3] = rx * c + nx * o; rest[i * 3 + 1] = YTOP - LEN * vv; rest[i * 3 + 2] = -(ry * s + 0.004) + nz * o;
      uv[i * 2] = k / cols; uv[i * 2 + 1] = 1 - vv;
    }
  }
  const tris = [], cons = [];
  const dist = (a, b) => Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]);
  const add = (a, b, soft) => cons.push([a, b, dist(a, b), soft]);
  for (let r = 0; r <= ROWS; r++) for (let k = 0; k < cols; k++) {
    const i = r * cols + k, k1 = (k + 1) % cols, k2 = (k + 2) % cols;
    add(i, r * cols + k1, 0.0);                                       // 经纬
    if (r < ROWS) { add(i, i + cols, 0.0); add(i, (r + 1) * cols + k1, 0.3); add(r * cols + k1, i + cols, 0.3); }   // 斜向（抗剪）
    add(i, r * cols + k2, 0.6);                                       // 横向抗弯：保持褶子
    if (r < ROWS - 1) add(i, i + 2 * cols, 3.0);                       // 纵向抗弯
    if (r < ROWS) { const a = i, b = r * cols + k1, c = i + cols, d = (r + 1) * cols + k1; tris.push(a, c, b, b, c, d); }
  }
  const C = cons.length, c0 = new Uint32Array(C), c1 = new Uint32Array(C), cL = new Float32Array(C), cS = new Float32Array(C);
  cons.forEach((q, i) => { c0[i] = q[0]; c1[i] = q[1]; cL[i] = q[2]; cS[i] = q[3]; });
  const pinned = new Uint8Array(n); for (let i = 0; i < cols * 2; i++) pinned[i] = 1;
  return { n, cols, ROWS, rest, uv, idx: new Uint32Array(tris), x: rest.slice(), p: rest.slice(), v: new Float32Array(n * 3),
    nrm: new Float32Array(n * 3), pinned, grabbed: new Uint8Array(n), C, c0, c1, cL, cS };
})();

const wind = { strength: 0, t: 0 };
function stepSkirt(dt, grab, ang, cone) {
  const { n, x, p, v, nrm, rest, pinned, grabbed, C, c0, c1, cL, cS } = SK;
  const SUB = 10, h = dt / SUB, ca = Math.cos(ang), sa = Math.sin(ang), SM = 0.007;
  wind.t += dt;
  const gust = wind.strength * (0.65 + 0.35 * Math.sin(wind.t * 1.9) + 0.2 * Math.sin(wind.t * 5.3 + 1));
  const wx = gust * 0.95, wy = gust * 0.12, wz = -gust * 0.3;
  for (let s = 0; s < SUB; s++) {
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (pinned[i]) {                                                 // 腰部跟随身体转动
        p[j] = x[j]; p[j + 1] = x[j + 1]; p[j + 2] = x[j + 2];
        x[j] = rest[j] * ca + rest[j + 2] * sa; x[j + 1] = rest[j + 1]; x[j + 2] = -rest[j] * sa + rest[j + 2] * ca; continue;
      }
      // 空气：风与阻力只作用在法线方向（布面受力）
      const rvx = wx - v[j], rvy = wy - v[j + 1], rvz = wz - v[j + 2];
      const f = (rvx * nrm[j] + rvy * nrm[j + 1] + rvz * nrm[j + 2]) * 7.0 * h;
      v[j] += nrm[j] * f; v[j + 1] += nrm[j + 1] * f - 9.8 * h; v[j + 2] += nrm[j + 2] * f;
      p[j] = x[j]; p[j + 1] = x[j + 1]; p[j + 2] = x[j + 2];
      x[j] += v[j] * h; x[j + 1] += v[j + 1] * h; x[j + 2] += v[j + 2] * h;
    }
    if (grab) for (let k = 0; k < grab.ids.length; k++) {
      const j = grab.ids[k] * 3;
      x[j] = grab.target.x + grab.off[k * 3]; x[j + 1] = grab.target.y + grab.off[k * 3 + 1]; x[j + 2] = grab.target.z + grab.off[k * 3 + 2];
    }
    for (let e = 0; e < C; e++) {
      const a = c0[e], b = c1[e], ja = a * 3, jb = b * 3;
      const wa = (pinned[a] || grabbed[a]) ? 0 : 1, wb = (pinned[b] || grabbed[b]) ? 0 : 1;
      if (wa + wb === 0) continue;
      const dx = x[jb] - x[ja], dy = x[jb + 1] - x[ja + 1], dz = x[jb + 2] - x[ja + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      const c = (l - cL[e]) / (l * (wa + wb + cS[e]));
      x[ja] += dx * c * wa; x[ja + 1] += dy * c * wa; x[ja + 2] += dz * c * wa;
      x[jb] -= dx * c * wb; x[jb + 1] -= dy * c * wb; x[jb + 2] -= dz * c * wb;
    }
    for (let i = 0; i < n; i++) {
      if (pinned[i] || grabbed[i]) continue;
      const j = i * 3;
      const lx = x[j] * ca - x[j + 2] * sa, lz = x[j] * sa + x[j + 2] * ca;        // 转到人体局部坐标查距离场
      const d = sdf(lx, x[j + 1], lz);
      if (d < SM) {
        sdfGrad(lx, x[j + 1], lz);
        const gx = G[0] * ca + G[2] * sa, gz = -G[0] * sa + G[2] * ca, push = SM - d;
        x[j] += gx * push; x[j + 1] += G[1] * push; x[j + 2] += gz * push;
        const mx = x[j] - p[j], my = x[j + 1] - p[j + 1], mz = x[j + 2] - p[j + 2], mn = mx * gx + my * G[1] + mz * gz, fr = 0.12;
        x[j] -= (mx - gx * mn) * fr; x[j + 1] -= (my - G[1] * mn) * fr; x[j + 2] -= (mz - gz * mn) * fr;
      }
      if (cone) {                                                      // 被拉起的丝袜（近似为圆锥）把裙摆顶开
        const ax = cone.cx - cone.tx, ay = cone.cy - cone.ty, az = cone.cz - cone.tz, al = ax * ax + ay * ay + az * az;
        const qx = x[j] - cone.tx, qy = x[j + 1] - cone.ty, qz = x[j + 2] - cone.tz;
        const tt = (qx * ax + qy * ay + qz * az) / al;
        if (tt > 0 && tt < 1) {
          const rx = qx - ax * tt, ry = qy - ay * tt, rz = qz - az * tt, rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1e-6;
          const rad = 0.01 + cone.r * tt * 0.4;
          if (rl < rad) { const k = (rad - rl) / rl * 0.2; x[j] += rx * k; x[j + 1] += ry * k; x[j + 2] += rz * k; }
        }
      }
      if (x[j + 1] < 0.004) x[j + 1] = 0.004;
      v[j] = (x[j] - p[j]) / h * 0.9995; v[j + 1] = (x[j + 1] - p[j + 1]) / h * 0.9995; v[j + 2] = (x[j + 2] - p[j + 2]) / h * 0.9995;
    }
  }
}

function skirtTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#5b5e66'; g.fillRect(0, 0, c.width, c.height);
  const band = (v0, v1, col) => { g.fillStyle = col; g.fillRect(0, v0 * c.height, c.width, (v1 - v0) * c.height); };
  band(0.74, 0.79, '#e9e9ea'); band(0.83, 0.855, '#1d1e22'); band(0.89, 0.91, '#e9e9ea');
  g.fillStyle = 'rgba(235,235,238,.75)'; for (let k = 0; k < 30; k++) g.fillRect((k + 0.3) / 30 * c.width, 0, 5, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;               // 织物颗粒
  for (let i = 0; i < d.length; i += 4) { const nz = (Math.random() - 0.5) * 22; d[i] += nz; d[i + 1] += nz; d[i + 2] += nz; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
const skGeo = new THREE.BufferGeometry();
skGeo.setAttribute('position', new THREE.BufferAttribute(SK.x, 3).setUsage(THREE.DynamicDrawUsage));
skGeo.setAttribute('normal', new THREE.BufferAttribute(SK.nrm, 3).setUsage(THREE.DynamicDrawUsage));
skGeo.setAttribute('uv', new THREE.BufferAttribute(SK.uv, 2));
skGeo.setIndex(new THREE.BufferAttribute(SK.idx, 1));
skGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 3);
const skMesh = new THREE.Mesh(skGeo, new THREE.MeshStandardMaterial({ map: skirtTexture(), roughness: 0.85, side: THREE.DoubleSide }));
skMesh.frustumCulled = false; skMesh.castShadow = skMesh.receiveShadow = true; scene.add(skMesh);
computeNormals(SK.idx, SK.x, SK.nrm, null, null, null);
{ // 腰带
  const pts = []; for (let k = 0; k <= 96; k++) { const th = 2 * Math.PI * k / 96; pts.push(new THREE.Vector3(0.156 * Math.cos(th), 0, -(0.110 * Math.sin(th) + 0.004))); }
  const g = new THREE.BufferGeometry(), pos = [], ind = [];
  pts.forEach((q, k) => { pos.push(q.x, 0.988, q.z, q.x * 1.012, 0.952, q.z * 1.012); if (k < 96) ind.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 2, k * 2 + 1, k * 2 + 3); });
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ind); g.computeVertexNormals();
  bodyGroup.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4f5259, roughness: 0.85, side: THREE.DoubleSide })));
  // 上衣下摆：盖住腰部以上的截面
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.115, 64, 1, false), new THREE.MeshStandardMaterial({ color: 0xe9e6e1, roughness: 0.95 }));
  top.scale.set(0.150, 1, 0.105); top.position.set(0, 1.035, -0.004); top.castShadow = true; bodyGroup.add(top);
}

// ------------------------------------------------------------------ 交互：抓取
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), plane = new THREE.Plane(), tmp = new THREE.Vector3();
let grab = null;
function setRay(ev) { mouse.set(ev.clientX / innerWidth * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); }
renderer.domElement.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  setRay(ev);
  const hit = ray.intersectObjects([stMesh, skMesh], false)[0];
  if (!hit) return;
  const isSt = hit.object === stMesh, S = isSt ? ST : SK;
  const local = isSt ? bodyGroup.worldToLocal(hit.point.clone()) : hit.point.clone();
  let best = hit.face.a, bd = 1e9;
  for (const i of [hit.face.a, hit.face.b, hit.face.c]) { const d = Math.hypot(S.x[i * 3] - local.x, S.x[i * 3 + 1] - local.y, S.x[i * 3 + 2] - local.z); if (d < bd) { bd = d; best = i; } }
  if (S.pinned?.[best] || S.fixed?.[best]) return;
  const src = isSt ? ST.rest : SK.x, R = isSt ? 0.02 : 0.022, ids = [], off = [];
  const cx = src[best * 3], cy = src[best * 3 + 1], cz = src[best * 3 + 2];
  for (let i = 0; i < S.n; i++) {
    if (S.pinned?.[i] || S.fixed?.[i]) continue;
    const dx = src[i * 3] - cx, dy = src[i * 3 + 1] - cy, dz = src[i * 3 + 2] - cz;
    if (dx * dx + dy * dy + dz * dz < R * R) { ids.push(i); off.push(dx, dy, dz); S.grabbed[i] = 1; }
  }
  const start = new THREE.Vector3(S.x[best * 3], S.x[best * 3 + 1], S.x[best * 3 + 2]);
  grab = { isSt, ids, off, centre: [cx, cy, cz], start, target: start.clone() };
  plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(tmp).clone(), hit.point);
  controls.enabled = false; try { renderer.domElement.setPointerCapture(ev.pointerId); } catch (e) { /* 合成事件没有可捕获的指针 */ } renderer.domElement.style.cursor = 'grabbing';
}, true);
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (!grab) return;
  setRay(ev);
  if (!ray.ray.intersectPlane(plane, tmp)) return;
  if (grab.isSt) bodyGroup.worldToLocal(tmp);
  const d = tmp.clone().sub(grab.start), max = grab.isSt ? 0.28 : 0.5;
  if (d.length() > max) d.setLength(max);
  grab.target.copy(grab.start).add(d);
});
const release = () => {
  if (!grab) return;
  (grab.isSt ? ST : SK).grabbed.fill(0); grab = null; controls.enabled = true; renderer.domElement.style.cursor = '';
};
addEventListener('pointerup', release); addEventListener('pointercancel', release);

// ------------------------------------------------------------------ 面板
const COLORS = [['白', 0xdedcde, 0xffffff], ['黑', 0x141416, 0x6a6a72], ['肤', 0xc9a48c, 0xffe1cc], ['灰', 0x6f7078, 0xd0d0d8], ['酒红', 0x5a1420, 0xff9aa8]];
COLORS.forEach(([name, col, sheen], i) => {
  const d = document.createElement('div'); d.className = 'sw' + (i === 0 ? ' on' : ''); d.title = name; d.style.background = '#' + col.toString(16).padStart(6, '0');
  d.onclick = () => { stMat.color.setHex(col); stMat.sheenColor.setHex(sheen); document.querySelectorAll('.sw').forEach((q) => q.classList.remove('on')); d.classList.add('on'); };
  $('colors').appendChild(d);
});
$('denier').oninput = (e) => { stUniforms.uCov.value = +e.target.value; };
$('stiff').oninput = (e) => { ST.edgeSoft = 0.15 + (1 - e.target.value) * 4; };
$('stiff').oninput({ target: $('stiff') });
$('wind').oninput = (e) => { wind.strength = +e.target.value; };
$('wire').onchange = (e) => { wire.visible = e.target.checked; };
let twistT = -1;
$('twist').onclick = () => { twistT = 0; };
$('reset').onclick = () => {
  for (const S of [ST, SK]) { S.x.set(S.rest); S.p.set(S.rest); S.v.fill(0); S.grabbed.fill(0); }
  ST.w.fill(1); twistT = -1; bodyGroup.rotation.y = 0; grab = null; controls.enabled = true;
};
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ------------------------------------------------------------------ 主循环
$('loading').remove();
const clock = new THREE.Clock(); let acc = 0, frames = 0, fpsT = 0;
function frame() {
  const real = Math.min(clock.getDelta(), 0.05), dt = 1 / 60;
  acc = Math.min(acc + real, dt * 2);
  while (acc >= dt) {
    acc -= dt;
    if (twistT >= 0) { twistT += dt; bodyGroup.rotation.y = 0.8 * Math.sin(twistT * 4.6) * Math.exp(-twistT * 0.85); if (twistT > 5) { twistT = -1; bodyGroup.rotation.y = 0; } }
    stepStocking(dt, grab && grab.isSt ? grab : null);
    let cone = null;
    if (grab && grab.isSt) {
      const a = bodyGroup.rotation.y, ca = Math.cos(a), sa = Math.sin(a), g = grab.target, c = grab.centre;
      const pull = Math.hypot(g.x - c[0], g.y - c[1], g.z - c[2]);
      if (pull > 0.03) cone = { tx: g.x * ca + g.z * sa, ty: g.y, tz: -g.x * sa + g.z * ca, cx: c[0] * ca + c[2] * sa, cy: c[1], cz: -c[0] * sa + c[2] * ca, r: Math.min(0.05 + 0.6 * pull, 0.17) };
    }
    stepSkirt(dt, grab && !grab.isSt ? grab : null, bodyGroup.rotation.y, cone);
  }
  computeNormals(ST.idx, ST.x, ST.nrm, ST.restArea, ST.stretch, ST.cnt);
  computeNormals(SK.idx, SK.x, SK.nrm, null, null, null);
  for (const g of [stGeo, skGeo]) { g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; }
  stGeo.attributes.stretch.needsUpdate = true;
  controls.update(); renderer.render(scene, camera);
  frames++; fpsT += real; if (fpsT > 0.5) { $('fps').textContent = Math.round(frames / fpsT) + ' FPS · 丝袜 ' + ST.n + ' 顶点 · 裙子 ' + SK.n + ' 顶点'; frames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}
window.__sim = { ST, SK, grabState: () => grab, camera, controls, bodyGroup, stepStocking, stepSkirt };
frame();
