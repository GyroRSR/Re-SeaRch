/*
 * 缶バッジ類似検索の特徴量（ブラウザ側）
 * mobile/tools/features.py と同じアルゴリズム。数値の計算部分は Node でも動く。
 */
(function (root) {
  'use strict';

  const DET = 128, FEAT = 64, INNER = 0.86, N_ANG = 72;
  const EDGE_D = 3.0, R_BONUS = 0.25, MIN_IN = 0.85, BG_T = 40.0;
  const W_SHAPE = 0.45, W_LAYOUT = 0.35, W_HIST = 0.20;

  // ------------------------------------------------------------ 円検出
  // rgb: Float64Array(dw*dh*3)。戻り値は検出画像の座標系 {cx, cy, r}
  // opts: { rmax, minIn, refine }。既定値は参照画像と同じ（tools/features.py の detect_on_rgb と同じ）。
  // 撮影写真には QUERY_DET（はみ出し気味の大きなバッジも探す＋0.5px刻みで微調整）を使う。
  const QUERY_DET = { rmax: 0.75, minIn: 0.65, refine: true };
  function detectOnRGB(rgb, dw, dh, opts) {
    const o = Object.assign({ rmax: 0.56, minIn: MIN_IN, refine: false }, opts || {});
    const m = Math.min(dw, dh);
    const at = (x, y, c) => rgb[(y * dw + x) * 3 + c];
    // 背景色 = 外周4pxの中央値
    const b = 4, fr = [[], [], []];
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      if (y < b || y >= dh - b || x < b || x >= dw - b) for (let c = 0; c < 3; c++) fr[c].push(at(x, y, c));
    }
    const bg = fr.map(median);

    const cxs = arange(dw / 2 - 0.18 * m, dw / 2 + 0.18 * m + 1e-9, 2);
    const cys = arange(dh / 2 - 0.18 * m, dh / 2 + 0.18 * m + 1e-9, 2);
    const rs = arange(pyRound(0.25 * m), pyRound(o.rmax * m) + 1, 1);
    const ca = new Float64Array(N_ANG), sa = new Float64Array(N_ANG);
    for (let k = 0; k < N_ANG; k++) { ca[k] = Math.cos(k * 2 * Math.PI / N_ANG); sa[k] = Math.sin(k * 2 * Math.PI / N_ANG); }

    let best = search(cxs, cys, rs, [-1, dw / 2, dh / 2, 0.45 * m]);
    if (o.refine) {
      const [, bx, by, br] = best;
      const lin = (a, n, st) => Array.from({ length: n }, (_, i) => a + st * i);
      best = search(lin(bx - 2.5, 11, 0.5), lin(by - 2.5, 11, 0.5), lin(br - 2, 9, 0.5), best);
    }
    return { cx: best[1], cy: best[2], r: best[3] };

    function search(cxs, cys, rs, best) {
    const bt2 = BG_T * BG_T;
    for (const cy of cys) for (const cx of cxs) for (const r of rs) {
      let sum = 0, nIn = 0, nfo = 0, nfi = 0;
      for (let k = 0; k < N_ANG; k++) {
        const x1 = Math.floor(cx + (r - EDGE_D) * ca[k] + 0.5), y1 = Math.floor(cy + (r - EDGE_D) * sa[k] + 0.5);
        const x2 = Math.floor(cx + (r + EDGE_D) * ca[k] + 0.5), y2 = Math.floor(cy + (r + EDGE_D) * sa[k] + 0.5);
        if (x1 < 0 || x1 >= dw || y1 < 0 || y1 >= dh || x2 < 0 || x2 >= dw || y2 < 0 || y2 >= dh) continue;
        const i1 = (y1 * dw + x1) * 3, i2 = (y2 * dw + x2) * 3;
        let d = 0, dout = 0, din = 0;
        for (let c = 0; c < 3; c++) {
          const a = rgb[i1 + c], o = rgb[i2 + c];
          d += (a - o) * (a - o); dout += (o - bg[c]) * (o - bg[c]); din += (a - bg[c]) * (a - bg[c]);
        }
        sum += Math.sqrt(Math.sqrt(d)); nIn++;
        if (dout < bt2) nfo++;
        if (din < bt2) nfi++;
      }
      if (nIn < o.minIn * N_ANG) continue;
      const fo = nfo / nIn, fi = nfi / nIn;
      const s = (sum / nIn) * Math.pow(r, R_BONUS) * (0.2 + fo) * (1.2 - fi);
      if (s > best[0]) best = [s, cx, cy, r];
    }
    return best;
    }
  }

  // ------------------------------------------------------------ 特徴量
  const MASK32 = circleMask(32), MASK8 = circleMask(8), MASK64 = circleMask(FEAT);
  const DCT8 = (() => { // 32点DCTの低周波8行ぶん
    const n = 32, mtx = new Float64Array(8 * n);
    for (let k = 0; k < 8; k++) {
      const a = k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
      for (let i = 0; i < n; i++) mtx[k * n + i] = a * Math.cos((2 * i + 1) * k * Math.PI / (2 * n));
    }
    return mtx;
  })();

  // rgb64: Float64Array(64*64*3)
  function features(rgb64) {
    const N = FEAT;
    // --- pHash
    const g32 = new Float64Array(32 * 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      let s = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const i = ((y * 2 + dy) * N + (x * 2 + dx)) * 3;
        s += rgb64[i] * 0.299 + rgb64[i + 1] * 0.587 + rgb64[i + 2] * 0.114;
      }
      g32[y * 32 + x] = s / 4;
    }
    let ms = 0, mn = 0;
    for (let i = 0; i < 1024; i++) if (MASK32[i]) { ms += g32[i]; mn++; }
    const mean = ms / mn;
    for (let i = 0; i < 1024; i++) if (!MASK32[i]) g32[i] = mean;
    const tmp = new Float64Array(8 * 32); // DCT8 @ G
    for (let k = 0; k < 8; k++) for (let x = 0; x < 32; x++) {
      let s = 0; for (let y = 0; y < 32; y++) s += DCT8[k * 32 + y] * g32[y * 32 + x];
      tmp[k * 32 + x] = s;
    }
    const low = new Float64Array(64); // (DCT8 @ G) @ DCT8^T
    for (let k = 0; k < 8; k++) for (let l = 0; l < 8; l++) {
      let s = 0; for (let x = 0; x < 32; x++) s += tmp[k * 32 + x] * DCT8[l * 32 + x];
      low[k * 8 + l] = s;
    }
    const med = median(Array.from(low.subarray(1)));
    const ph = new Uint8Array(64);
    for (let i = 0; i < 64; i++) ph[i] = low[i] > med ? 1 : 0;

    // --- カラーレイアウト 8x8
    const cl = new Float64Array(8 * 8 * 3);
    const ys = [];
    for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
        const i = ((by * 8 + dy) * N + (bx * 8 + dx)) * 3;
        r += rgb64[i]; g += rgb64[i + 1]; b += rgb64[i + 2];
      }
      r /= 64; g /= 64; b /= 64;
      const j = (by * 8 + bx) * 3;
      cl[j] = 0.299 * r + 0.587 * g + 0.114 * b;
      cl[j + 1] = -0.168736 * r - 0.331264 * g + 0.5 * b;
      cl[j + 2] = 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (MASK8[by * 8 + bx]) ys.push(cl[j]);
    }
    const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
    const ysd = Math.sqrt(ys.reduce((a, b) => a + (b - ym) * (b - ym), 0) / ys.length);
    for (let i = 0; i < 64; i++) {
      cl[i * 3] = clampRound((cl[i * 3] - ym) / (ysd + 8) * 40, -127, 127);
      cl[i * 3 + 1] = clampRound(cl[i * 3 + 1], -127, 127);
      cl[i * 3 + 2] = clampRound(cl[i * 3 + 2], -127, 127);
    }

    // --- 色ヒストグラム 40ビン
    const h = new Float64Array(40);
    let tot = 0;
    for (let p = 0; p < N * N; p++) {
      if (!MASK64[p]) continue;
      const r = rgb64[p * 3], g = rgb64[p * 3 + 1], b = rgb64[p * 3 + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
      const bi = clamp(Math.floor((cb + 128) / 256 * 6), 0, 5), ri = clamp(Math.floor((cr + 128) / 256 * 6), 0, 5);
      h[bi * 6 + ri] += 1; tot++;
      if (Math.sqrt(cb * cb + cr * cr) < 20) { h[36 + clamp(Math.floor(y / 64), 0, 3)] += 1; tot++; }
    }
    for (let i = 0; i < 40; i++) h[i] = clampRound(Math.sqrt(h[i] / tot) * 255, 0, 255);
    return prep({ ph, cl, hi: h });
  }

  // 比較を速くするための前処理（pHashを32bit x2に、ヒストグラムのノルムを事前計算）
  function prep(f) {
    let a = 0, b = 0;
    for (let i = 0; i < 32; i++) { a = (a << 1) | f.ph[i]; b = (b << 1) | f.ph[32 + i]; }
    let n = 0; for (let i = 0; i < 40; i++) n += f.hi[i] * f.hi[i];
    f.p0 = a >>> 0; f.p1 = b >>> 0; f.hn = Math.sqrt(n);
    return f;
  }

  function unpack(b64) {
    const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const by = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) by[i] = bin.charCodeAt(i);
    const ph = new Uint8Array(64);
    for (let i = 0; i < 64; i++) ph[i] = (by[i >> 3] >> (7 - (i & 7))) & 1;
    const cl = new Float64Array(192);
    for (let i = 0; i < 192; i++) { const v = by[8 + i]; cl[i] = v > 127 ? v - 256 : v; }
    const hi = new Float64Array(40);
    for (let i = 0; i < 40; i++) hi[i] = by[200 + i];
    return prep({ ph, cl, hi });
  }

  function popcnt(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }

  function simParts(q, r) {
    const shape = 1 - (popcnt(q.p0 ^ r.p0) + popcnt(q.p1 ^ r.p1)) / 64;
    let d = 0, n = 0;
    for (let i = 0; i < 64; i++) {
      if (!MASK8[i]) continue;
      const j = i * 3;
      d += Math.abs(q.cl[j] - r.cl[j]) + 1.5 * Math.abs(q.cl[j + 1] - r.cl[j + 1]) + 1.5 * Math.abs(q.cl[j + 2] - r.cl[j + 2]);
      n++;
    }
    const layout = Math.exp(-(d / n) / 30);
    let dot = 0; for (let i = 0; i < 40; i++) dot += q.hi[i] * r.hi[i];
    const hist = dot / (q.hn * r.hn + 1e-9);
    return [shape, layout, hist];
  }

  function score(q, r) {
    const [s, l, h] = simParts(q, r);
    return W_SHAPE * s + W_LAYOUT * l + W_HIST * h;
  }

  // 回転違いの複数のクエリ特徴量のうち一番近いものでスコアを出す
  function scoreRot(qs, r) {
    let best = 0;
    for (const q of qs) { const s = score(q, r); if (s > best) best = s; }
    return best;
  }

  // ------------------------------------------------------------ helpers
  function circleMask(n) {
    const m = new Uint8Array(n * n), c = (n - 1) / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) m[y * n + x] = ((x - c) ** 2 + (y - c) ** 2) <= (n / 2) ** 2 ? 1 : 0;
    return m;
  }
  function arange(a, b, s) { const o = []; for (let v = a; v < b; v += s) o.push(v); return o; }
  function median(arr) { const a = Array.from(arr).sort((x, y) => x - y); const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pyRound(v) { const f = Math.floor(v), d = v - f; if (d > 0.5) return f + 1; if (d < 0.5) return f; return f % 2 === 0 ? f : f + 1; }
  function clampRound(v, a, b) { return clamp(pyRound(v), a, b); }

  // ------------------------------------------------------------ ブラウザ用（canvas）
  function canvasRGB(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const out = new Float64Array(canvas.width * canvas.height * 3);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { out[j] = d[i]; out[j + 1] = d[i + 1]; out[j + 2] = d[i + 2]; }
    return out;
  }
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // 縮小を段階的に行って画質（≒面積平均）を保つ
  function stepDown(src, sx, sy, sw, sh, outW, outH, angleDeg, cx, cy) {
    let cur = src, cw = sw, ch = sh, x0 = sx, y0 = sy;
    if (angleDeg) {
      // 回転させた切り出し領域を、まず等倍に近い大きさで描く
      const size = Math.max(outW, Math.min(512, Math.round(sw)));
      const c = makeCanvas(size, size), ctx = c.getContext('2d');
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      const k = size / sw;
      ctx.translate(size / 2, size / 2); ctx.rotate(-angleDeg * Math.PI / 180); ctx.scale(k, k);
      ctx.drawImage(src, -cx, -cy);
      cur = c; cw = size; ch = size; x0 = 0; y0 = 0;
    }
    while (cw > outW * 2.2) {
      const nw = Math.max(outW, Math.round(cw / 2)), nh = Math.max(outH, Math.round(ch / 2));
      const c = makeCanvas(nw, nh), ctx = c.getContext('2d');
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, nw, nh);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cur, x0, y0, cw, ch, 0, 0, nw, nh);
      cur = c; cw = nw; ch = nh; x0 = 0; y0 = 0;
    }
    const c = makeCanvas(outW, outH), ctx = c.getContext('2d');
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, x0, y0, cw, ch, 0, 0, outW, outH);
    return c;
  }

  // img: 最大768pxに縮小済みのcanvas
  function detectCircle(img) {
    const w = img.width, h = img.height, s = DET / Math.max(w, h);
    const dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
    const c = stepDown(img, 0, 0, w, h, dw, dh);
    const r = detectOnRGB(canvasRGB(c), dw, dh, QUERY_DET);
    return { cx: (r.cx + 0.5) / s - 0.5, cy: (r.cy + 0.5) / s - 0.5, r: r.r / s };
  }

  // 円(cx,cy,r)の内側から、回転違いの特徴量を作る
  function queryFeatures(img, circle, angles) {
    const half = circle.r * INNER;
    return angles.map(a => {
      const c = a
        ? stepDown(img, circle.cx - half, circle.cy - half, 2 * half, 2 * half, FEAT, FEAT, a, circle.cx, circle.cy)
        : stepDown(img, circle.cx - half, circle.cy - half, 2 * half, 2 * half, FEAT, FEAT);
      return features(canvasRGB(c));
    });
  }

  // ------------------------------------------------------------ 極座標テンプレート（再ランキング用）
  // tools/features.py の polar()/polar_score() と同じ。円の内側を半径12段x角度72方向(5°刻み)で採取し、
  // 回転を角度方向のずらしとして全通り比べる。Y（明るさ）は全解像度、Cb/Crは半分(6x36)。
  const PR = 12, PA = 72, PH = 6, PAH = 36, P_ROUT = 28.0, P_C0 = 31.5, P_SCALE = 32;
  const P_VARIANTS = [[1, 0, 0], [0.94, 0, 0], [1.06, 0, 0], [1, 2, 0], [1, -2, 0], [1, 0, 2], [1, 0, -2]];
  const P_WY = 0.55, P_WC = 0.45, P_BETA = 0.5, P_TOPK = 200, P_REC = PR * PA + 2 * PH * PAH;
  const P_W = (() => {
    let s = 0; for (let i = 0; i < PR; i++) s += (i + 0.5) / PR;
    const w = new Float64Array(PR); for (let i = 0; i < PR; i++) w[i] = (i + 0.5) / PR / s / PA;
    return w;
  })();
  const P_WH = Float64Array.from({ length: PH }, (_, i) => P_W[2 * i] + P_W[2 * i + 1]);
  const P_COS = Float64Array.from({ length: PA }, (_, j) => Math.cos(j * 2 * Math.PI / PA));
  const P_SIN = Float64Array.from({ length: PA }, (_, j) => Math.sin(j * 2 * Math.PI / PA));

  // rgb64 -> 3x3平均したYCbCr（端は端の値で埋める）
  function smoothYCC(rgb64) {
    const N = FEAT, ycc = new Float64Array(N * N * 3), out = new Float64Array(N * N * 3);
    for (let p = 0; p < N * N; p++) {
      const r = rgb64[p * 3], g = rgb64[p * 3 + 1], b = rgb64[p * 3 + 2];
      ycc[p * 3] = 0.299 * r + 0.587 * g + 0.114 * b;
      ycc[p * 3 + 1] = -0.168736 * r - 0.331264 * g + 0.5 * b;
      ycc[p * 3 + 2] = 0.5 * r - 0.418688 * g - 0.081312 * b;
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = clamp(y + dy, 0, N - 1), xx = clamp(x + dx, 0, N - 1);
        s += ycc[(yy * N + xx) * 3 + c];
      }
      out[(y * N + x) * 3 + c] = s / 9;
    }
    return out;
  }

  function polarFromYCC(ycc, k, dx, dy) {
    const N = FEAT, lim = N - 1.001, raw = new Float64Array(PR * PA * 3);
    for (let i = 0; i < PR; i++) {
      const rr = (i + 0.5) / PR * P_ROUT * k;
      for (let j = 0; j < PA; j++) {
        const x = clamp(P_C0 + dx + rr * P_COS[j], 0, lim), y = clamp(P_C0 + dy + rr * P_SIN[j], 0, lim);
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        for (let c = 0; c < 3; c++) {
          const a = ycc[(y0 * N + x0) * 3 + c], b = ycc[(y0 * N + x0 + 1) * 3 + c];
          const d0 = ycc[((y0 + 1) * N + x0) * 3 + c], d1 = ycc[((y0 + 1) * N + x0 + 1) * 3 + c];
          raw[(i * PA + j) * 3 + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d0 * (1 - fx) + d1 * fx) * fy;
        }
      }
    }
    const mean = [0, 0, 0];
    for (let i = 0; i < PR; i++) for (let j = 0; j < PA; j++) for (let c = 0; c < 3; c++) mean[c] += raw[(i * PA + j) * 3 + c] * P_W[i];
    let vy = 0, vc = 0;
    for (let i = 0; i < PR; i++) for (let j = 0; j < PA; j++) {
      const q = (i * PA + j) * 3;
      const a = raw[q] - mean[0], b = raw[q + 1] - mean[1], c = raw[q + 2] - mean[2];
      vy += a * a * P_W[i]; vc += (b * b + c * c) * P_W[i];
    }
    const ny = Math.sqrt(vy + 1), nc = Math.sqrt(vc + 36);
    // Yは同じリングを2回並べた配列にしておく（回転ずらしで剰余を使わないため）
    const y2 = new Float64Array(PR * PA * 2), c2 = new Float64Array(2 * PH * PAH * 2);
    for (let i = 0; i < PR; i++) for (let j = 0; j < PA; j++) {
      const v = (raw[(i * PA + j) * 3] - mean[0]) / ny;
      y2[i * PA * 2 + j] = v; y2[i * PA * 2 + j + PA] = v;
    }
    for (let ch = 0; ch < 2; ch++) for (let ih = 0; ih < PH; ih++) for (let jh = 0; jh < PAH; jh++) {
      let s = 0;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) s += raw[((2 * ih + a) * PA + 2 * jh + b) * 3 + 1 + ch] - mean[1 + ch];
      const v = s / 4 / nc, base = (ch * PH + ih) * PAH * 2;
      c2[base + jh] = v; c2[base + jh + PAH] = v;
    }
    return { y2, c2 };
  }

  function queryPolarsFromRGB64(rgb64) {
    const ycc = smoothYCC(rgb64);
    return P_VARIANTS.map(([k, dx, dy]) => polarFromYCC(ycc, k, dx, dy));
  }
  function queryPolars(img, circle) {
    const half = circle.r * INNER;
    return queryPolarsFromRGB64(canvasRGB(stepDown(img, circle.cx - half, circle.cy - half, 2 * half, 2 * half, FEAT, FEAT)));
  }

  // polar.bin の1件（Int8Array, 1296byte）を重み付きの実数に
  function prepPolar(i8, off) {
    const y = new Float64Array(PR * PA), c = new Float64Array(2 * PH * PAH);
    for (let i = 0; i < PR; i++) for (let j = 0; j < PA; j++) y[i * PA + j] = i8[off + i * PA + j] / P_SCALE * P_W[i];
    const o2 = off + PR * PA;
    for (let ch = 0; ch < 2; ch++) for (let ih = 0; ih < PH; ih++) for (let jh = 0; jh < PAH; jh++) {
      const k = (ch * PH + ih) * PAH + jh;
      c[k] = i8[o2 + k] / P_SCALE * P_WH[ih];
    }
    return { y, c };
  }

  function polarScore(qs, ref) {
    let best = -9;
    const ch = new Float64Array(PAH);
    for (const q of qs) {
      for (let t = 0; t < PAH; t++) {
        let s = 0;
        for (let r = 0; r < 2 * PH; r++) {
          const qb = r * PAH * 2 + t, rb = r * PAH;
          for (let j = 0; j < PAH; j++) s += q.c2[qb + j] * ref.c[rb + j];
        }
        ch[t] = s;
      }
      for (let sft = 0; sft < PA; sft++) {
        let sy = 0;
        for (let i = 0; i < PR; i++) {
          const qb = i * PA * 2 + sft, rb = i * PA;
          for (let j = 0; j < PA; j++) sy += q.y2[qb + j] * ref.y[rb + j];
        }
        const t = sft >> 1;
        const cc = (sft & 1) ? ch[t] + ch[(t + 1) % PAH] : 2 * ch[t];
        const v = P_WY * sy + P_WC * cc;
        if (v > best) best = v;
      }
    }
    return best;
  }

  root.BadgeFeat = {
    detectOnRGB, features, unpack, score, scoreRot, simParts, detectCircle, queryFeatures, INNER, FEAT, DET, QUERY_DET,
    queryPolars, queryPolarsFromRGB64, prepPolar, polarScore, P_REC, P_BETA, P_TOPK,
  };
  if (typeof module !== 'undefined') module.exports = root.BadgeFeat;
})(typeof window !== 'undefined' ? window : globalThis);
