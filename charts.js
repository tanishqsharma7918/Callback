/* Callback — SVG/HTML charts. Colors come from CSS tokens so both themes work (index.html, "charts" section).
 * v3 data-viz spec (luxury-ui.md §8): horizontal hairline gridlines only, Geist Mono 10.5px tabular ticks,
 * bars ≤ 20px with 2px rounded tops, highlight series (this week / goal / you) in champagne, everything else in
 * jewel inks or ink-3, direct labels, ▲/▼ glyphs with colour for deltas, glass tooltips, metal score rings. */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => CB.esc(s);

  // ───────── shared tooltip ─────────
  let tipEl = null;
  const tip = {
    show(html, x, y) {
      if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'cb-tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
      tipEl.innerHTML = html;
      tipEl.hidden = false;
      const r = tipEl.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      let left = x + 14, top = y - r.height - 10;
      if (left + r.width > vw - 8) left = x - r.width - 14;
      if (left < 8) left = 8;
      if (top < 8) top = y + 18;
      tipEl.style.left = left + 'px';
      tipEl.style.top = top + 'px';
    },
    hide() { if (tipEl) tipEl.hidden = true; },
  };
  function bindTip(node, htmlFn) {
    const move = (e) => tip.show(htmlFn(), e.clientX, e.clientY);
    node.addEventListener('pointerenter', move);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', tip.hide);
    node.addEventListener('focus', () => { const r = node.getBoundingClientRect(); tip.show(htmlFn(), r.left + r.width / 2, r.top); });
    node.addEventListener('blur', tip.hide);
  }
  window.addEventListener('scroll', () => tip.hide(), { passive: true });

  function svg(w, h, cls) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    s.setAttribute('width', w);
    s.setAttribute('height', h);
    if (cls) s.setAttribute('class', cls);
    return s;
  }
  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  /** Bar path with 4px rounded data-end (top), square at baseline. */
  function colPath(x, y, w, h, r = 2) {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function niceMax(v) {
    if (v <= 0) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  const width = (host) => Math.max(240, Math.floor(host.clientWidth || host.getBoundingClientRect().width || 320));

  // ───────── vertical columns (weekly applications vs goal) ─────────
  function columns(host, data, opts = {}) {
    host.innerHTML = '';
    const W = width(host), H = opts.height || 190;
    const m = { t: 20, r: 8, b: 26, l: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const maxV = niceMax(Math.max(opts.goal || 0, ...data.map((d) => d.value), 1));
    const s = svg(W, H, 'chart');
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxV / ticks) * i, y = m.t + ih - (v / maxV) * ih;
      el('line', { x1: m.l, x2: W - m.r, y1: Math.round(y) + 0.5, y2: Math.round(y) + 0.5, class: i === 0 ? 'c-base' : 'c-grid' }, s);
      el('text', { x: m.l - 8, y: y + 3.5, class: 'c-tick', 'text-anchor': 'end' }, s).textContent = Math.round(v);
    }
    const band = iw / data.length;
    const bw = Math.min(20, band * 0.72);
    data.forEach((d, i) => {
      const x = m.l + i * band + (band - bw) / 2;
      const h = (d.value / maxV) * ih;
      const last = i === data.length - 1;
      const p = el('path', { d: colPath(x, m.t + ih - h, bw, h), class: 'c-bar' + (last && opts.highlightLast ? ' c-bar-accent' : ''), tabindex: 0 }, s);
      if (!h) el('rect', { x, y: m.t + ih - 1.5, width: bw, height: 1.5, class: 'c-bar-zero' }, s);
      const hit = el('rect', { x: m.l + i * band, y: m.t, width: band, height: ih, class: 'c-hit' }, s);
      const html = () => `<b>${esc(d.label)}</b><br>${d.value} ${esc(opts.unit || '')}${opts.goal ? ` · goal ${opts.goal}` : ''}`;
      bindTip(hit, html); bindTip(p, html);
      if (i % Math.ceil(data.length / (W < 420 ? 4 : 6)) === 0 || last) el('text', { x: x + bw / 2, y: H - 8, class: 'c-tick', 'text-anchor': 'middle' }, s).textContent = d.label;
      if (last && d.value) el('text', { x: x + bw / 2, y: m.t + ih - h - 6, class: 'c-val', 'text-anchor': 'middle' }, s).textContent = d.value;
    });
    if (opts.goal) {
      const y = m.t + ih - (opts.goal / maxV) * ih;
      el('line', { x1: m.l, x2: W - m.r, y1: Math.round(y) + 0.5, y2: Math.round(y) + 0.5, class: 'c-goal' }, s);
      el('text', { x: W - m.r, y: y - 6, class: 'c-tick c-goal-t', 'text-anchor': 'end' }, s).textContent = `Goal ${opts.goal} / wk`;
    }
    host.appendChild(s);
  }

  // ───────── horizontal rate bars (HTML) ─────────
  function rateBars(host, rows, opts = {}) {
    const max = opts.max || Math.max(...rows.map((r) => r.value || 0), 0.0001);
    host.innerHTML = `<div class="rb">${rows.map((r, i) => `
      <div class="rb-row" tabindex="0" data-i="${i}">
        <div class="rb-label"><span>${esc(r.label)}</span><span class="rb-n">${esc(r.sub || '')}</span></div>
        <div class="rb-track"><div class="rb-fill" style="width:${Math.max(r.value ? 2 : 0, (r.value / max) * 100)}%;${r.color ? 'background:' + r.color : ''}"></div></div>
        <div class="rb-val">${esc(r.text != null ? r.text : CB.pct(r.value))}</div>
      </div>`).join('')}</div>`;
    host.querySelectorAll('.rb-row').forEach((n) => { const r = rows[+n.dataset.i]; if (r.tip) bindTip(n, () => r.tip); });
  }

  // ───────── calendar heatmap (applications per day) ─────────
  function heatmap(host, daily, opts = {}) {
    host.innerHTML = '';
    const weeks = opts.weeks || 26;
    const W = width(host);
    const labelW = 22;
    const gap = 2;
    const cell = Math.max(7, Math.min(15, Math.floor((W - labelW - gap * weeks) / weeks)));
    const H = 7 * (cell + gap) + 20;
    const realW = labelW + weeks * (cell + gap);
    const s = svg(realW, H, 'chart heat');
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end); start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7);
    const max = Math.max(1, ...Object.values(daily));
    let lastMonth = -1;
    ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach((d, i) => { if (d) el('text', { x: 0, y: 16 + i * (cell + gap) + cell - 2, class: 'c-tick' }, s).textContent = d; });
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d);
        if (dt > end) continue;
        const iso = CB.toISODate(dt);
        const v = daily[iso] || 0;
        const lvl = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
        const r = el('rect', { x: labelW + w * (cell + gap), y: 16 + d * (cell + gap), width: cell, height: cell, rx: Math.min(3, cell / 4), class: 'hm hm-' + lvl, tabindex: -1 }, s);
        if (+dt === +end) el('rect', { x: labelW + w * (cell + gap) - 1, y: 16 + d * (cell + gap) - 1, width: cell + 2, height: cell + 2, rx: Math.min(3.5, cell / 4 + 1), class: 'hm-today' }, s);
        bindTip(r, () => `<b>${v} application${v === 1 ? '' : 's'}</b><br>${CB.fmtDate(iso, true)}`);
        if (d === 0 && dt.getMonth() !== lastMonth && dt.getDate() <= 7) {
          lastMonth = dt.getMonth();
          el('text', { x: labelW + w * (cell + gap), y: 10, class: 'c-tick' }, s).textContent = CB.MONTHS[dt.getMonth()];
        }
      }
    }
    const wrap = document.createElement('div');
    wrap.className = 'hm-wrap';
    wrap.appendChild(s);
    host.appendChild(wrap);
    const lg = document.createElement('div');
    lg.className = 'hm-legend';
    lg.innerHTML = `<span>Less</span>${[0, 1, 2, 3, 4].map((i) => `<i class="hm-sw hm-${i}"></i>`).join('')}<span>More</span>`;
    host.appendChild(lg);
  }

  // ───────── ring gauge ─────────
  let ringSeq = 0;
  function ring(host, value, opts = {}) {
    const size = opts.size || 120, stroke = Math.max(4, Math.round((opts.stroke || 10) * 0.62));
    const r = (size - stroke) / 2 - 3, c = 2 * Math.PI * r, h = size / 2;
    const v = CB.clamp(value || 0, 0, 1);
    const gid = 'cb-ring-m' + ++ringSeq;
    const ticks = Array.from({ length: 60 }, (_, i) => {
      const a = (i / 60) * Math.PI * 2, major = i % 5 === 0, r1 = h - 0.5, r0 = r1 - (major ? 3.5 : 2);
      return `<line x1="${(h + Math.sin(a) * r0).toFixed(2)}" y1="${(h - Math.cos(a) * r0).toFixed(2)}" x2="${(h + Math.sin(a) * r1).toFixed(2)}" y2="${(h - Math.cos(a) * r1).toFixed(2)}" class="ring-tick" stroke-width="${major ? 1 : 0.6}"${major ? '' : ' opacity=".55"'}/>`;
    }).join('');
    host.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring" role="img" aria-label="${esc(opts.aria || '')}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--gold-100)"/><stop offset=".3" style="stop-color:var(--gold-300)"/><stop offset=".52" style="stop-color:var(--gold-500)"/><stop offset=".72" style="stop-color:var(--gold-200)"/><stop offset="1" style="stop-color:var(--gold-400)"/></linearGradient></defs>
      ${ticks}
      <circle cx="${h}" cy="${h}" r="${r}" class="ring-track" stroke-width="${stroke}" fill="none"></circle>
      <circle cx="${h}" cy="${h}" r="${r}" class="ring-fill" stroke-width="${stroke}" fill="none" stroke-linecap="round"
        style="stroke:url(#${gid});stroke-dasharray:${c};stroke-dashoffset:${c}" transform="rotate(-90 ${h} ${h})"></circle>
      ${opts.color && v > 0 ? `<g class="ring-end" style="transform-origin:${h}px ${h}px;transform:rotate(0deg)"><circle cx="${h}" cy="${h - r}" r="${Math.max(2.5, stroke / 2 - 0.5)}" style="fill:${opts.color}" stroke="var(--surface-1)" stroke-width="1.5"></circle></g>` : ''}
    </svg><div class="ring-center"><div class="ring-v">${esc(opts.label != null ? opts.label : Math.round(v * 100) + '%')}</div><div class="ring-s">${esc(opts.sub || '')}</div></div>`;
    const f = host.querySelector('.ring-fill');
    const endDot = host.querySelector('.ring-end');
    const reduce = CB.FX && CB.FX.reduced && CB.FX.reduced();
    const go = () => {
      f.style.transition = reduce ? 'none' : 'stroke-dashoffset 1100ms cubic-bezier(.22,1,.36,1)';
      f.style.strokeDashoffset = c * (1 - v);
      if (endDot) { endDot.style.transition = reduce ? 'none' : 'transform 1100ms cubic-bezier(.22,1,.36,1)'; endDot.style.transform = `rotate(${(v * 360).toFixed(1)}deg)`; }
    };
    if (reduce) go(); else requestAnimationFrame(() => requestAnimationFrame(go));
  }

  // ───────── ATS histogram with response calibration ─────────
  function atsHistogram(host, buckets, opts = {}) {
    host.innerHTML = '';
    const W = width(host), H = opts.height || 200;
    const m = { t: 16, r: 10, b: 30, l: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const maxV = niceMax(Math.max(1, ...buckets.map((b) => b.count)));
    const s = svg(W, H, 'chart');
    for (let i = 0; i <= 4; i++) {
      const v = (maxV / 4) * i, y = m.t + ih - (v / maxV) * ih;
      el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: i === 0 ? 'c-base' : 'c-grid' }, s);
      el('text', { x: m.l - 6, y: y + 3.5, class: 'c-tick', 'text-anchor': 'end' }, s).textContent = Math.round(v);
    }
    const band = iw / buckets.length, bw = Math.min(20, band * 0.7);
    const zone = (b) => (b.from + 5 < (opts.floor || 60) ? 'bad' : b.from + 5 < (opts.competitive || 75) ? 'warn' : 'good');
    buckets.forEach((b, i) => {
      const x = m.l + i * band + (band - bw) / 2;
      const h = (b.count / maxV) * ih;
      const hr = (b.interviewed / maxV) * ih;
      el('path', { d: colPath(x, m.t + ih - h, bw, h), class: 'c-hist c-hist-' + zone(b) }, s);
      if (hr > 0) el('path', { d: colPath(x, m.t + ih - hr, bw, hr, hr >= h - 1 ? 2 : 0), class: 'c-hist-in' }, s);
      const hit = el('rect', { x: m.l + i * band, y: m.t, width: band, height: ih, class: 'c-hit', tabindex: 0 }, s);
      bindTip(hit, () => `<b>ATS ${b.from}–${b.to - 1}</b><br>${b.count} applied · ${b.interviewed} got a screen${b.count ? ` (${Math.round((b.interviewed / b.count) * 100)}%)` : ''}`);
      if (i % 2 === 0) el('text', { x: m.l + i * band, y: H - 12, class: 'c-tick', 'text-anchor': 'middle' }, s).textContent = b.from;
    });
    el('text', { x: W - m.r, y: H - 12, class: 'c-tick', 'text-anchor': 'end' }, s).textContent = '100';
    [['floor', opts.floor], ['competitive', opts.competitive]].forEach(([k, v]) => {
      if (!v) return;
      const x = m.l + (v / 100) * iw;
      el('line', { x1: x, x2: x, y1: m.t - 4, y2: m.t + ih, class: 'c-thresh' }, s);
      el('text', { x: x + 4, y: m.t + 6, class: 'c-tick' }, s).textContent = k === 'floor' ? `Cutoff ${v}` : `Review ${v}`;
    });
    host.appendChild(s);
  }

  // ───────── pipeline flow (drop-off sankey) ─────────
  function flow(host, jobs) {
    host.innerHTML = '';
    const cols = [
      { key: 'applied', label: 'Applied', min: 1 },
      { key: 'screen', label: 'Screen', min: 2 },
      { key: 'interview', label: 'Interview', min: 4 },
      { key: 'final', label: 'Final', min: 5 },
      { key: 'offer', label: 'Offer', min: 6 },
    ];
    const applied = jobs.filter((j) => (j.maxStage || 0) >= 1 || j.appliedDate);
    if (!applied.length) { host.innerHTML = '<p class="empty-note">Flow appears once you move an application past Saved.</p>'; return; }
    const reached = cols.map((c) => applied.filter((j) => Math.max(j.maxStage || 0, 1) >= c.min).length);
    const colOf = (j) => { const m = Math.max(j.maxStage || 0, 1); for (let i = cols.length - 1; i >= 0; i--) if (m >= cols[i].min) return i; return 0; };
    const EXIT = [['rejected', 'Rejected', 'var(--st-rejected)'], ['ghosted', 'Ghosted', 'var(--st-ghosted)'], ['withdrawn', 'Withdrawn', 'var(--st-withdrawn)'], ['active', 'In progress', 'var(--flow-active)']];
    const exits = cols.map(() => ({ rejected: 0, ghosted: 0, withdrawn: 0, active: 0 }));
    applied.forEach((j) => {
      const i = colOf(j);
      const k = ['rejected', 'ghosted', 'withdrawn'].includes(j.status) ? j.status : 'active';
      exits[i][k]++;
    });
    const W = width(host);
    const narrow = W < 520;
    const H = narrow ? 228 : 246;
    const m = { t: 26, l: 8, r: narrow ? 8 : 16 };
    const nodeW = 8;
    const colGap = (W - m.l - m.r - nodeW) / (cols.length - 1);
    const mainH = H * 0.46;
    const k = mainH / Math.max(1, reached[0]);
    const exitY = m.t + mainH + 46;
    const s = svg(W, H, 'chart flow');
    const defs = el('defs', {}, s);
    const xs = cols.map((_, i) => m.l + i * colGap);
    // advance bands
    for (let i = 0; i < cols.length - 1; i++) {
      const h = reached[i + 1] * k;
      if (h <= 0) continue;
      const x0 = xs[i] + nodeW, x1 = xs[i + 1], y = m.t;
      const gid = 'fg' + i + Math.random().toString(36).slice(2, 6);
      const g = el('linearGradient', { id: gid, x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
      el('stop', { offset: '0%', style: `stop-color:var(--st-${cols[i].key})` }, g);
      el('stop', { offset: '100%', style: `stop-color:var(--st-${cols[i + 1].key})` }, g);
      const mx = (x0 + x1) / 2;
      const p = el('path', { d: `M${x0},${y}C${mx},${y} ${mx},${y} ${x1},${y}V${y + h}C${mx},${y + h} ${mx},${y + h} ${x0},${y + h}Z`, class: 'flow-band', fill: `url(#${gid})`, tabindex: 0 }, s);
      bindTip(p, () => `<b>${cols[i].label} → ${cols[i + 1].label}</b><br>${reached[i + 1]} of ${reached[i]} advanced (${Math.round((reached[i + 1] / reached[i]) * 100)}%)`);
    }
    // exit bands
    for (let i = 0; i < cols.length; i++) {
      let y = m.t + reached[i + 1 < cols.length ? i + 1 : cols.length] * k;
      if (i === cols.length - 1) y = m.t;
      let ex = xs[i] + nodeW + 6;
      const tot = EXIT.reduce((a, [kk]) => a + exits[i][kk], 0);
      if (!tot) continue;
      let ox = 0;
      EXIT.forEach(([kk, label, color]) => {
        const n = exits[i][kk];
        if (!n) return;
        const h = n * k;
        const x0 = xs[i] + nodeW, tx = ex + ox, ty = exitY;
        const wEnd = Math.max(3, h * 0.55);
        const p = el('path', {
          d: `M${x0},${y}C${x0 + 30},${y} ${tx},${y + 10} ${tx},${ty}H${tx + wEnd}C${tx + wEnd},${y + h + 10} ${x0 + 30},${y + h} ${x0},${y + h}Z`,
          class: 'flow-exit', style: `fill:${color}`, tabindex: 0,
        }, s);
        bindTip(p, () => `<b>${n} ${label.toLowerCase()}</b> at ${cols[i].label}`);
        el('rect', { x: tx, y: ty, width: wEnd, height: 4, rx: 2, style: `fill:${color}` }, s);
        ox += wEnd + 3;
        y += h;
      });
    }
    // nodes + labels
    cols.forEach((c, i) => {
      const h = Math.max(2, reached[i] * k);
      el('rect', { x: xs[i], y: m.t, width: nodeW, height: h, rx: 2, class: 'flow-node', style: `fill:var(--st-${c.key})` }, s);
      const anchor = i === cols.length - 1 ? 'end' : i === 0 ? 'start' : 'middle';
      const lx = i === cols.length - 1 ? xs[i] + nodeW : i === 0 ? xs[i] : xs[i] + nodeW / 2;
      el('text', { x: lx, y: m.t - 10, class: 'flow-label', 'text-anchor': anchor }, s).textContent = c.label;
      const t = el('text', { x: lx, y: m.t - 10 + 0, class: 'flow-count', 'text-anchor': anchor, dy: 0 }, s);
      t.textContent = '';
      const cnt = el('text', { x: i === cols.length - 1 ? xs[i] - 4 : xs[i] + nodeW + 4, y: m.t + Math.min(h, 40) / 2 + 4, class: 'flow-num', 'text-anchor': i === cols.length - 1 ? 'end' : 'start' }, s);
      cnt.textContent = reached[i] + (i ? `  ${Math.round((reached[i] / reached[0]) * 100)}%` : '');
    });
    host.appendChild(s);
    const lg = document.createElement('div');
    lg.className = 'flow-legend';
    lg.innerHTML = EXIT.map(([kk, label, color]) => { const n = exits.reduce((a, e) => a + e[kk], 0); return n ? `<span><i style="background:${color}"></i>${esc(label)} ${n}</span>` : ''; }).join('');
    host.appendChild(lg);
  }

  // ───────── tall segmented bar (status mix) ─────────
  function segBar(host, parts) {
    const total = parts.reduce((a, p) => a + p.value, 0) || 1;
    host.innerHTML = `<div class="seg" role="img" aria-label="${esc(parts.map((p) => `${p.label} ${p.value}`).join(', '))}">${parts.filter((p) => p.value).map((p, i) => {
      const pct = (p.value / total) * 100;
      return `<div class="seg-part" tabindex="0" data-i="${i}" style="flex:${p.value} 1 0;background:${p.color}">${pct >= 9 ? `<span>${p.value}</span>` : ''}</div>`;
    }).join('')}</div><div class="seg-legend">${parts.filter((p) => p.value).map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)}<b>${p.value}</b></span>`).join('')}</div>`;
    const live = parts.filter((p) => p.value);
    host.querySelectorAll('.seg-part').forEach((n, i) => bindTip(n, () => `<b>${esc(live[i].label)}</b><br>${live[i].value} · ${Math.round((live[i].value / total) * 100)}%`));
  }

  // ───────── sparkline ─────────
  function spark(host, values, opts = {}) {
    const W = opts.width || 96, H = opts.height || 28;
    const max = Math.max(...values, 1), min = 0;
    const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * (W - 8) + 4, H - 4 - ((v - min) / (max - min || 1)) * (H - 8)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
    const last = pts[pts.length - 1];
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="spark" aria-hidden="true"><path d="${d}V${H}H3Z" class="spark-area"/><path d="${d}" class="spark-line"/><circle cx="${last[0]}" cy="${last[1]}" r="2.75" class="spark-dot"/></svg>`;
  }

  // ───────── 2D fallback for the 3D tower ─────────
  function funnel2d(host, stages) {
    const max = Math.max(1, ...stages.map((s) => s.count));
    host.innerHTML = `<div class="f2d">${stages.map((s, i) => `<div class="f2d-row"><div class="f2d-bar" style="width:${Math.max(6, (s.count / max) * 100)}%;background:${s.color}"></div><div class="f2d-l">${esc(s.label)} <b>${s.count}</b>${i ? ` <span>${stages[i - 1].count ? Math.round((s.count / stages[i - 1].count) * 100) : 0}%</span>` : ''}</div></div>`).join('')}</div>`;
  }

  CB.Charts = { tip, bindTip, columns, rateBars, heatmap, ring, atsHistogram, flow, segBar, spark, funnel2d };
})();
