/* RSR缶バッジ検索 スマホ版 */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  // PC版（F:\ReSeaRch の run.bat で起動したローカルサーバ）から開いているときは、
  // 詳細画面で元の高解像度画像（/badge-images/）を使う
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ 正規化（textnorm.pyと同じ）
  const SYM = /[.。#%「」\[\]{}()~～・･^/／=\-―－‐+×÷*@_!?'"\s]/g;
  function norm(s) {
    s = (s || '').normalize('NFKC');
    let o = '';
    for (const ch of s) { const c = ch.codePointAt(0); o += (c >= 0x3041 && c <= 0x3096) ? String.fromCodePoint(c + 0x60) : ch; }
    return o.replace(SYM, '').replace(/＄/g, '$').toLowerCase();
  }

  // ------------------------------------------------------------------ データ
  let D = null;                 // data.json
  const artistById = new Map(); // id -> {id, name, aliases, norms, badges:[], lineups:[]}
  const years = [];
  let refFeat = null;           // 画像検索用（遅延で展開）

  async function loadData() {
    const res = await fetch('data/data.json');
    if (!res.ok) throw new Error('data.json を読み込めませんでした');
    D = await res.json();
    for (const [id, name, aliases] of D.artists) {
      artistById.set(id, { id, name, aliases, norms: [norm(name), ...aliases.map(norm)], badges: [], lineups: [] });
    }
    D.badges.forEach((b, i) => {
      b.i = i; b.nn = norm(b.n);
      for (const a of b.a) artistById.get(a)?.badges.push(b);
    });
    D.lineups.forEach((l) => { for (const a of l[4]) artistById.get(a)?.lineups.push(l); });
    const ys = new Set([...D.badges.map((b) => b.y), ...D.lineups.map((l) => l[0])]);
    years.push(...[...ys].sort((a, b) => a - b));
    $('#stat').textContent = `${D.badges.length.toLocaleString()}件\n${years[0]}–${years[years.length - 1]}`;
  }

  // ------------------------------------------------------------------ サムネイル（年ごとのファイルを必要な時だけ読む）
  const imgBundles = new Map(); // year -> Promise<obj>
  function bundle(year) {
    if (!imgBundles.has(year)) {
      imgBundles.set(year, fetch(`data/img-${year}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
    }
    return imgBundles.get(year);
  }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); fillThumb(e.target); }
  }, { rootMargin: '300px' }) : null;
  async function fillThumb(img) {
    const b = D.badges[+img.dataset.b];
    if (!b.f) return;
    const bun = await bundle(b.y);
    if (bun[b.f]) img.src = 'data:image/jpeg;base64,' + bun[b.f];
  }
  function thumbHTML(b, cls = 'thumb') {
    if (!b.f) return `<div class="${cls} noimg">画像なし</div>`;
    return `<img class="${cls}" data-b="${b.i}" alt="${esc(b.n)}">`;
  }
  function hydrate(root) {
    root.querySelectorAll('img[data-b]').forEach((img) => (io ? io.observe(img) : fillThumb(img)));
  }

  function cardHTML(b, pct) {
    return `<div class="card" data-open="${b.i}">
      ${pct != null ? `<span class="pct">${pct}%</span>` : ''}
      ${b.u ? '<span class="tag" title="DB未登録の画像">未登録</span>' : ''}
      ${thumbHTML(b)}
      <div class="nm">${esc(b.n)}</div><div class="yr">${b.y}</div>
    </div>`;
  }
  function lineupHTML(l, hideId) {
    const [y, stage, day, note, ids, dn] = l;
    // タイムテーブル上の表記があればそれを出す（バンドメンバー個人名は並べない）
    const who = dn ? [dn] : ids.filter((i) => i !== hideId).map((i) => artistById.get(i)?.name).filter(Boolean);
    // アーティスト名を主に、日付・ステージ・備考はその下に小さく
    return `<div class="li"><span class="y">${y}</span><div>
      ${who.length ? `<div class="who">${esc(who.join(', '))}</div>` : ''}
      <div class="meta">${esc(day)} ${esc(stage)}${note ? `<span class="note">${esc(note)}</span>` : ''}</div>
    </div></div>`;
  }

  // ------------------------------------------------------------------ タブ
  function show(view) {
    document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'v-' + view));
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    try { if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view); } catch (e) { /* noop */ }
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

  // ------------------------------------------------------------------ アーティスト検索
  let sugTimer = 0;
  $('#q').addEventListener('input', () => { clearTimeout(sugTimer); sugTimer = setTimeout(suggest, 120); });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = $('#suggest .sug'); if (first) first.click(); }
  });

  function searchArtists(q) {
    const n = norm(q);
    if (!n) return [];
    const out = [];
    for (const a of artistById.values()) {
      let rank = -1;
      for (const s of a.norms) {
        if (s === n) { rank = 0; break; }
        if (s.startsWith(n)) rank = rank === -1 ? 1 : Math.min(rank, 1);
        else if (s.includes(n) && rank === -1) rank = 2;
      }
      if (rank >= 0 && (a.badges.length || a.lineups.length)) out.push([rank, a]);
    }
    out.sort((x, y) => x[0] - y[0] || y[1].badges.length - x[1].badges.length || y[1].lineups.length - x[1].lineups.length);
    return out.map((x) => x[1]);
  }

  function suggest() {
    const q = $('#q').value.trim();
    const box = $('#suggest');
    $('#artist-result').innerHTML = '';
    if (!q) { box.innerHTML = homeHTML(); hydrate(box); return; }
    const arts = searchArtists(q).slice(0, 30);
    const n = norm(q);
    const loose = D.badges.filter((b) => !b.a.length && b.nn.includes(n)).slice(0, 30);
    if (!arts.length && !loose.length) { box.innerHTML = '<div class="empty">見つかりませんでした</div>'; return; }
    box.innerHTML = arts.map((a) => {
      const al = a.aliases.find((x) => norm(x).includes(n) && !norm(a.name).includes(n));
      return `<button class="sug" data-artist="${a.id}">
        <span>${esc(a.name)}${al ? `<br><span class="alias">${esc(al)}</span>` : ''}</span>
        <span class="cnt">バッジ${a.badges.length} / 出演${a.lineups.length}</span></button>`;
    }).join('') + (loose.length ? `<h3>アーティスト未登録の缶バッジ</h3><div class="grid">${loose.map((b) => cardHTML(b)).join('')}</div>` : '');
    hydrate(box);
  }

  function homeHTML() {
    const ly = Math.max(...D.badges.filter((b) => b.f).map((b) => b.y));
    const recent = D.badges.filter((b) => b.f && b.y === ly).slice(0, 12);
    return `<p class="sub" style="margin-top:6px">アーティスト名で検索すると、歴代の缶バッジと出演歴を表示します。</p>
      <h3>${ly}年の缶バッジ</h3><div class="grid">${recent.map((b) => cardHTML(b)).join('')}</div>`;
  }

  function openArtist(id) {
    const a = artistById.get(id);
    if (!a) return;
    show('artist');
    $('#suggest').innerHTML = '';
    const bs = [...a.badges].sort((x, y) => x.y - y.y);
    const ls = [...a.lineups].sort((x, y) => x[0] - y[0]);
    const el = $('#artist-result');
    el.innerHTML = `<h2>${esc(a.name)}</h2>
      ${a.aliases.length ? `<p class="sub">${esc(a.aliases.slice(0, 6).join(' / '))}</p>` : ''}
      <h3>缶バッジ（${bs.length}）</h3>
      ${bs.length ? `<div class="grid">${bs.map((b) => cardHTML(b)).join('')}</div>` : '<div class="empty">缶バッジの登録はありません</div>'}
      <h3>出演歴（${ls.length}）</h3>
      ${ls.length ? `<div class="lineup">${ls.map((l) => lineupHTML(l, id)).join('')}</div>` : '<div class="empty">出演歴の登録はありません</div>'}`;
    hydrate(el);
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ 年で見る
  let curYear = null;
  function renderYears() {
    const withBadge = new Set(D.badges.map((b) => b.y));
    $('#years').innerHTML = years.map((y) => `<button class="chip${y === curYear ? ' on' : ''}${withBadge.has(y) ? '' : ' dim'}" data-year="${y}">${y}</button>`).join('');
  }
  function openYear(y) {
    curYear = y; renderYears();
    const bs = D.badges.filter((b) => b.y === y);
    const ls = D.lineups.filter((l) => l[0] === y);
    const el = $('#year-result');
    el.innerHTML = `<h2>${y}年</h2>
      <h3>缶バッジ（${bs.length}）</h3>
      ${bs.length ? `<div class="grid">${bs.map((b) => cardHTML(b)).join('')}</div>` : '<div class="empty">この年の缶バッジはありません</div>'}
      ${ls.length ? `<details><summary>出演アーティスト（${ls.length}）</summary><div class="lineup">${ls.map((l) => lineupHTML(l)).join('')}</div></details>` : ''}`;
    hydrate(el);
  }

  // ------------------------------------------------------------------ 詳細モーダル
  function openBadge(i) {
    const b = D.badges[i];
    const arts = (b.p || b.a).map((id) => artistById.get(id)).filter(Boolean);
    $('#modal-body').innerHTML = `${thumbHTML(b, 'big-thumb')}
      <h2 style="text-align:center;margin-top:0">${esc(b.n)}</h2>
      <dl class="kv">
        <dt>年</dt><dd><button class="link" data-year-go="${b.y}">${b.y}年</button></dd>
        ${arts.length ? `<dt>アーティスト</dt><dd>${arts.map((a) => `<button class="link" data-artist="${a.id}">${esc(a.name)}</button>`).join('、')}</dd>` : ''}
        ${b.no ? `<dt>メモ</dt><dd>${esc(b.no)}</dd>` : ''}
        ${b.f ? `<dt>ファイル</dt><dd class="small">${esc(b.f)}</dd>` : ''}
        ${b.u ? '<dt>備考</dt><dd class="small">DBに未登録の画像です（ファイル名から推定）</dd>' : ''}
      </dl>`;
    $('#modal').hidden = false;
    $('#modal-body').querySelectorAll('img[data-b]').forEach(fillThumb);
    if (LOCAL && b.f) {
      const big = $('#modal-body .big-thumb');
      const full = new Image();
      full.onload = () => { if (big && big.isConnected) big.src = full.src; };
      full.src = '/badge-images/' + encodeURIComponent(b.f);
    }
  }
  function closeModal() { $('#modal').hidden = true; }
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  // 委譲クリック
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open],[data-artist],[data-year],[data-year-go]');
    if (!t) return;
    if (t.dataset.open != null) openBadge(+t.dataset.open);
    else if (t.dataset.artist != null) { closeModal(); $('#q').value = artistById.get(+t.dataset.artist)?.name || ''; openArtist(+t.dataset.artist); }
    else if (t.dataset.year != null) openYear(+t.dataset.year);
    else if (t.dataset.yearGo != null) { closeModal(); show('year'); openYear(+t.dataset.yearGo); }
  });

  // ------------------------------------------------------------------ 撮って探す
  const BF = window.BadgeFeat;
  const ANGLES = Array.from({ length: 24 }, (_, k) => k * 15);
  let photo = null;   // 最大768pxに縮小したcanvas
  let circle = null;  // {cx, cy, r}（photo座標）
  let view = { s: 1, ox: 0, oy: 0, size: 0 };

  function toast(msg, ms = 2500) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }

  async function loadPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = url; });
      const s = Math.min(1, 768 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c;
    } finally { URL.revokeObjectURL(url); }
  }

  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) await usePhoto(f);
  }
  async function usePhoto(f) {
    loadPolar();
    if (!f || !/^image\//.test(f.type || 'image/')) { toast('画像ファイルを選んでください'); return; }
    try {
      photo = await loadPhoto(f);
    } catch (err) { toast('画像を読み込めませんでした'); return; }
    circle = BF.detectCircle(photo);
    $('#cam-start').hidden = true; $('#cam-adjust').hidden = false; $('#cam-result').innerHTML = '';
    layoutStage();
  }
  $('#file-cam').addEventListener('change', onFile);
  $('#file-pick').addEventListener('change', onFile);
  // PC向け: 画像のドラッグ＆ドロップ・貼り付け（Ctrl+V）でも探せる
  const camView = $('#v-camera');
  ['dragenter', 'dragover'].forEach((t) => camView.addEventListener(t, (e) => { e.preventDefault(); camView.classList.add('drop'); }));
  ['dragleave', 'drop'].forEach((t) => camView.addEventListener(t, () => camView.classList.remove('drop')));
  camView.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) usePhoto(f);
  });
  document.addEventListener('paste', (e) => {
    if (camView.hidden) return;
    const item = [...((e.clipboardData && e.clipboardData.items) || [])].find((it) => it.type.startsWith('image/'));
    if (item) { e.preventDefault(); usePhoto(item.getAsFile()); }
  });
  $('#cam-retry').addEventListener('click', () => {
    $('#cam-adjust').hidden = true; $('#cam-start').hidden = false; $('#cam-result').innerHTML = '';
  });

  function layoutStage() {
    const st = $('#stage'), cv = $('#stage-canvas');
    const size = st.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    const s = size / Math.max(photo.width, photo.height);
    view = { s, size, ox: (size - photo.width * s) / 2, oy: (size - photo.height * s) / 2 };
    cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr);
    cv.style.width = size + 'px'; cv.style.height = size + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(photo, view.ox, view.oy, photo.width * s, photo.height * s);
    const maxR = Math.max(photo.width, photo.height) * 0.6;
    const rs = $('#ring-size'); rs.max = String(Math.round(maxR)); rs.min = String(Math.round(maxR * 0.08)); rs.value = String(circle.r);
    drawRing();
  }
  function drawRing() {
    const ring = $('#ring');
    const r = circle.r * view.s;
    ring.style.width = ring.style.height = 2 * r + 'px';
    ring.style.left = view.ox + circle.cx * view.s - r + 'px';
    ring.style.top = view.oy + circle.cy * view.s - r + 'px';
  }
  window.addEventListener('resize', () => { if (photo && !$('#cam-adjust').hidden) layoutStage(); });
  $('#ring-size').addEventListener('input', (e) => { circle.r = +e.target.value; drawRing(); });

  // ドラッグ・ピンチ
  // マウス/ペン: ステージ上どこでもドラッグで円を移動。
  // タッチ: 1本指は「赤い円の内側（付近）」に触れたときだけ円を動かし、円の外側ならページをスクロールする。
  //         2本指はどこでもピンチで拡大縮小。
  const ptrs = new Map();
  let gesture = null;
  const stage = $('#stage');
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture([...ptrs.values()]);
  });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moveGesture([...ptrs.values()]);
  });
  const endPtr = (e) => { if (e.pointerType === 'touch') return; ptrs.delete(e.pointerId); beginGesture([...ptrs.values()]); };
  stage.addEventListener('pointerup', endPtr);
  stage.addEventListener('pointercancel', endPtr);

  const touchPts = (e) => [...e.touches].map((t) => ({ x: t.clientX, y: t.clientY }));
  function insideRing(pt) {
    const rect = stage.getBoundingClientRect();
    const rx = rect.left + view.ox + circle.cx * view.s, ry = rect.top + view.oy + circle.cy * view.s;
    return Math.hypot(pt.x - rx, pt.y - ry) <= circle.r * view.s * 1.08 + 20;
  }
  let touchMode = null; // null: スクロールに任せる / 'move': 円を動かす
  stage.addEventListener('touchstart', (e) => {
    const p = touchPts(e);
    if (p.length >= 2 || (p.length === 1 && insideRing(p[0]))) {
      e.preventDefault();
      touchMode = 'move';
      beginGesture(p);
    } else {
      touchMode = null;
      gesture = null;
    }
  }, { passive: false });
  stage.addEventListener('touchmove', (e) => {
    if (touchMode !== 'move') return;
    e.preventDefault();
    moveGesture(touchPts(e));
  }, { passive: false });
  const endTouch = (e) => {
    const p = touchPts(e);
    if (!p.length) { touchMode = null; gesture = null; return; }
    if (touchMode === 'move') beginGesture(p);
  };
  stage.addEventListener('touchend', endTouch);
  stage.addEventListener('touchcancel', endTouch);

  function beginGesture(p) {
    if (!p.length) { gesture = null; return; }
    gesture = { n: p.length, p: p.map((x) => ({ ...x })), cx: circle.cx, cy: circle.cy, r: circle.r };
    if (p.length >= 2) {
      gesture.d = Math.max(10, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y));
      gesture.mx = (p[0].x + p[1].x) / 2; gesture.my = (p[0].y + p[1].y) / 2;
    }
  }
  function moveGesture(p) {
    if (!gesture) return;
    if (p.length === 1 && gesture.n === 1) {
      circle.cx = gesture.cx + (p[0].x - gesture.p[0].x) / view.s;
      circle.cy = gesture.cy + (p[0].y - gesture.p[0].y) / view.s;
    } else if (p.length >= 2 && gesture.n >= 2) {
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
      circle.r = Math.max(5, gesture.r * d / gesture.d);
      circle.cx = gesture.cx + (mx - gesture.mx) / view.s;
      circle.cy = gesture.cy + (my - gesture.my) / view.s;
      $('#ring-size').value = String(circle.r);
    }
    drawRing();
  }

  // 再ランキング用の極座標テンプレート（base64テキストで約4MB）。撮って探すを使うときだけ読み込む
  let polarBuf = null;
  function loadPolar() {
    if (!polarBuf) {
      polarBuf = fetch('data/polar.txt').then((r) => (r.ok ? r.text() : null)).then((t) => {
        if (!t) return null;
        const bin = atob(t.trim()), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new Int8Array(u8.buffer);
      }).catch(() => null);
    }
    return polarBuf;
  }

  $('#cam-search').addEventListener('click', async () => {
    const btn = $('#cam-search');
    btn.disabled = true;
    $('#cam-result').innerHTML = '<div class="spinner"></div>';
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (!refFeat) refFeat = D.badges.map((b) => (b.ft ? BF.unpack(b.ft) : null));
      const qs = BF.queryFeatures(photo, circle, ANGLES);
      const yf = $('#img-year').value ? +$('#img-year').value : null;
      const scored = [];
      D.badges.forEach((b, i) => {
        const r = refFeat[i];
        if (!r || (yf && b.y !== yf)) return;
        scored.push([BF.scoreRot(qs, r), b]);
      });
      scored.sort((a, b) => b[0] - a[0]);
      // 上位を極座標テンプレート（5°刻みの全回転で形・文字を細かく比較）で並べ直す
      let ranked = scored.map(([s, b]) => [s, b]);
      let scale = 1;
      const pol = await loadPolar();
      if (pol && D.polar_rec === BF.P_REC && pol.length >= D.badges.length * BF.P_REC) {
        const qp = BF.queryPolars(photo, circle);
        ranked = scored.slice(0, BF.P_TOPK).map(([s, b]) => [s + BF.P_BETA * BF.polarScore(qp, BF.prepPolar(pol, b.i * BF.P_REC)), b]);
        ranked.sort((a, b) => b[0] - a[0]);
        scale = 1 + BF.P_BETA;
      }
      const top = ranked.slice(0, 24);
      const el = $('#cam-result');
      el.innerHTML = `<h3>似ている缶バッジ</h3>
        <div class="grid">${top.map(([s, b]) => cardHTML(b, Math.max(0, Math.min(100, Math.round(s / scale * 100))))).join('')}</div>
        <p class="hint">見つからないときは、円をバッジの縁にぴったり合わせ直すか、年で絞り込んでみてください。</p>`;
      hydrate(el);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      $('#cam-result').innerHTML = '<div class="empty">検索中にエラーが発生しました</div>';
    } finally { btn.disabled = false; }
  });

  // ------------------------------------------------------------------ 起動
  (async function init() {
    try {
      await loadData();
    } catch (err) {
      $('#stat').textContent = '読み込みエラー';
      $('#artist-result').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      return;
    }
    $('#img-year').innerHTML += [...new Set(D.badges.filter((b) => b.ft).map((b) => b.y))].sort((a, b) => b - a)
      .map((y) => `<option value="${y}">${y}年</option>`).join('');
    renderYears();
    openYear(years[years.length - 1]);
    suggest();
    const h = (location.hash || '').slice(1);
    show(['artist', 'year', 'camera'].includes(h) ? h : 'artist');
  })();
})();
