/* Callback v3 — feat-vault (owned per docs/BUILD.md)
 * Data Vault (competitors.md rec 11a + 11c): "never crash, never lose".
 * - Automatic snapshots of {jobs, resume, settings} in IndexedDB (db 'callback', store 'snapshots'): one a day
 *   (newest 7 days kept) plus one before every destructive store call (newest 5 kept). CB.Store.clearSamples,
 *   clearAll, restoreBackup, importJobs and removeMany are wrapped: the state is captured synchronously first, the
 *   original call always runs, and a failing snapshot can never break it.
 * - Settings card "Data Vault": snapshot list with Restore (confirm + diff summary) and Download, persistent-storage
 *   status (navigator.storage.persist / estimate) and a one-tap JSON backup.
 * - Action Center "Back up your data" when no JSON export or snapshot download happened in 7 days (localStorage).
 * Public: CB.Vault {snapshot(reason), list(), restore(id), download(id), backupNow(), lastBackup(), storage()}.
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  if (typeof document === 'undefined' || !CB.Store || typeof CB.registerSettings !== 'function') return;

  const E = (s) => CB.esc(s);
  const S = () => CB.Store;
  const UI = () => CB.UI || {};
  const icon = (n) => (UI().icon ? UI().icon(n) : '');
  const toast = (t, o) => { if (UI().toast) UI().toast(t, o); };
  const LS_LAST = 'callback.vault.lastBackupAt', LS_SINCE = 'callback.vault.since', LS_ASKED = 'callback.vault.persistAsked';
  const KEEP_DAILY = 7, KEEP_PRE = 5;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  if (!lsGet(LS_SINCE)) lsSet(LS_SINCE, CB.nowISO());
  let warned = false;
  const warnOnce = (e) => { if (!warned) { warned = true; console.warn('[Callback] Data Vault snapshots are unavailable here:', (e && e.message) || e); } };

  // ───────────────────────── IndexedDB ─────────────────────────
  const DB_NAME = 'callback', STORES = ['snapshots', 'blobs', 'resumes'];
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      let f = null;
      try { f = window.indexedDB || null; } catch (e) { f = null; }
      if (!f) { reject(new Error('IndexedDB is not available in this browser mode.')); return; }
      const ensure = (db) => STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
      const wire = (db) => { db.onversionchange = () => { try { db.close(); } catch (e) { /* noop */ } dbp = null; }; return db; };
      const openV = (v, onOk) => {
        let r;
        try { r = v ? f.open(DB_NAME, v) : f.open(DB_NAME); } catch (e) { reject(e); return; }
        r.onupgradeneeded = () => ensure(r.result);
        r.onerror = () => reject(r.error || new Error('IndexedDB could not open.'));
        r.onblocked = () => reject(new Error('IndexedDB is busy in another tab.'));
        r.onsuccess = () => onOk(r.result);
      };
      // Open at whatever version exists; add our stores with a version bump only if another module made the db first.
      openV(0, (db) => {
        if (STORES.every((s) => db.objectStoreNames.contains(s))) { resolve(wire(db)); return; }
        const v = db.version + 1;
        db.close();
        openV(v, (db2) => resolve(wire(db2)));
      });
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  const tx = (mode, fn) => idb().then((db) => new Promise((res, rej) => {
    let t, out;
    try { t = db.transaction('snapshots', mode); out = fn(t.objectStore('snapshots')); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(out && typeof out === 'object' && 'readyState' in out ? out.result : out);
    t.onerror = () => rej(t.error || new Error('IndexedDB error'));
    t.onabort = () => rej(t.error || new Error('IndexedDB write was aborted (storage full?)'));
  }));
  const list = () => tx('readonly', (os) => os.getAll()).then((rows) => (rows || []).sort((a, b) => String(b.at).localeCompare(String(a.at))));
  const getOne = (id) => tx('readonly', (os) => os.get(id));

  // ───────────────────────── snapshots ─────────────────────────
  const REASON = {
    daily: 'Daily snapshot', manual: 'Saved by you', clearSamples: 'Before clearing examples', clearAll: 'Before deleting everything',
    restoreBackup: 'Before a restore', importJobs: 'Before an import', removeMany: 'Before a bulk delete',
  };
  function capture() {
    const s = S();
    const jobs = s.list();
    const json = JSON.stringify({ app: 'callback', version: 1, exportedAt: CB.nowISO(), jobs, resume: s.resume || null, settings: s.settings || {} });
    let bytes = json.length;
    try { bytes = new Blob([json]).size; } catch (e) { /* estimate */ }
    return { json, bytes, jobs: jobs.length, samples: jobs.filter((j) => j.sample).length, resume: !!(s.resume && s.resume.text) };
  }
  function prune() {
    return list().then((rows) => {
      const days = new Set(), keep = new Set();
      rows.filter((r) => r.kind === 'daily').forEach((r) => { if (!days.has(r.day) && days.size < KEEP_DAILY) { days.add(r.day); keep.add(r.id); } });
      rows.filter((r) => r.kind !== 'daily').slice(0, KEEP_PRE).forEach((r) => keep.add(r.id));
      const drop = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
      return drop.length ? tx('readwrite', (os) => { drop.forEach((id) => os.delete(id)); return drop.length; }) : 0;
    });
  }
  let chain = Promise.resolve();
  /** Capture now (synchronously), store in the background. Resolves the record or null. */
  function snapshot(reason, note) {
    let cap;
    try { cap = capture(); } catch (e) { return Promise.resolve(null); }
    const now = new Date();
    const rec = {
      id: 'snap_' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6), at: now.toISOString(), day: CB.toISODate(now),
      kind: reason === 'daily' ? 'daily' : reason === 'manual' ? 'manual' : 'pre', reason: REASON[reason] ? reason : 'manual', note: String(note || ''),
      jobs: cap.jobs, samples: cap.samples, resume: cap.resume, bytes: cap.bytes, payload: cap.json,
    };
    const p = chain.then(() => tx('readwrite', (os) => os.put(rec))).then(prune).then(() => { CB.emit('vault', { snapshot: rec.id }); return rec; });
    chain = p.catch((e) => { warnOnce(e); return null; });
    return chain;
  }
  // One daily restore point (the state as the day starts), taken shortly after data loads or changes.
  let dailyDay = '';
  function ensureDaily() {
    if (!S().ready || !S().list().length) return;
    const day = CB.todayISO();
    if (dailyDay === day) return;
    dailyDay = day;
    list().then((rows) => (rows.some((r) => r.kind === 'daily' && r.day === day) ? null : snapshot('daily')))
      .catch((e) => { warnOnce(e); dailyDay = ''; });
  }
  CB.on('data', CB.debounce(ensureDaily, 2500));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(ensureDaily, 1500); });
  if (S().ready) setTimeout(ensureDaily, 2500);

  // Snapshot before every destructive store call. Guards decide when there is something worth saving.
  const hasData = () => S().list().length > 0 || !!(S().resume && S().resume.text);
  const GUARD = {
    clearSamples: () => S().list().some((j) => j.sample) || !!(S().resume && S().resume.sample),
    clearAll: hasData,
    restoreBackup: hasData,
    importJobs: (jobs) => Array.isArray(jobs) && jobs.length > 0 && S().list().length > 0,
    removeMany: (ids) => Array.isArray(ids) && ids.some((id) => S().get(id)),
  };
  const NOTE = {
    importJobs: (jobs) => `${jobs.length} incoming`,
    removeMany: (ids) => `${ids.length} selected`,
    restoreBackup: (d) => (d && Array.isArray(d.jobs) ? `${d.jobs.length} in the backup` : ''),
  };
  Object.keys(GUARD).forEach((name) => {
    const s = S();
    const orig = s[name];
    if (typeof orig !== 'function' || orig.__vault) return;
    const wrapped = function () {
      try { if (GUARD[name].apply(null, arguments)) snapshot(name, NOTE[name] ? NOTE[name].apply(null, arguments) : ''); }
      catch (e) { /* a snapshot must never block the real call */ }
      return orig.apply(this, arguments);
    };
    wrapped.__vault = true;
    wrapped.__orig = orig;
    s[name] = wrapped;
  });

  // ───────────────────────── backups (JSON export or snapshot download) ─────────────────────────
  const lastBackup = () => lsGet(LS_LAST);
  function markBackup() {
    lsSet(LS_LAST, CB.nowISO());
    CB.emit('vault', { backup: true });
    try { if (CB.App && CB.App.rerender) CB.App.rerender(); } catch (e) { /* noop */ }
  }
  if (CB.IO && typeof CB.IO.exportJSON === 'function' && !CB.IO.exportJSON.__vault) {
    const orig = CB.IO.exportJSON;
    const wrapped = function () {
      const p = orig.apply(this, arguments);
      Promise.resolve(p).then((r) => { if (!r || r.ok !== false) markBackup(); }, () => { /* the caller reports it */ });
      return p;
    };
    wrapped.__vault = true;
    CB.IO.exportJSON = wrapped;
  }
  function backupNow() {
    const s = S();
    const state = { jobs: s.list(), resume: s.resume || null, settings: s.settings || {} };
    if (CB.IO && typeof CB.IO.exportJSON === 'function') {
      const p = CB.IO.exportJSON(state);
      if (UI().save) UI().save(p, 'Backup ready · keep it somewhere other than this device');
      return p;
    }
    return CB.saveFile(`callback-backup-${CB.todayISO()}.json`, JSON.stringify(Object.assign({ app: 'callback', version: 1, exportedAt: CB.nowISO() }, state), null, 2), 'application/json')
      .then((r) => { if (!r || r.ok !== false) { markBackup(); toast('Backup ready'); } else if (r.code !== 'declined') toast(r.message || 'The backup could not be saved.', { tone: 'bad' }); return r; });
  }
  const daysSince = (iso) => { const t = Date.parse(iso || ''); return isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null; };
  CB.registerAction((jobs) => {
    const real = (jobs || []).filter((j) => !j.sample).length;
    if (!real) return [];
    const last = lastBackup();
    const d = daysSince(last || lsGet(LS_SINCE));
    if (d == null || d < 7) return [];
    const where = S().mode === 'cloud' ? 'a copy you control protects against mistakes' : `${real} application${real === 1 ? '' : 's'} live only on this device`;
    return [{
      id: 'vault-backup', kind: 'backup', sev: d >= 14 ? 2 : 3, title: 'Back up your data',
      detail: (last ? `Last backup ${d} days ago` : 'No backup yet') + ' · ' + where,
      action: { label: 'Back up', run: () => backupNow() },
    }];
  });

  // ───────────────────────── storage persistence ─────────────────────────
  async function storage() {
    const out = { supported: false, persisted: null, usage: null, quota: null };
    try {
      const sm = navigator.storage;
      if (sm && typeof sm.persisted === 'function') { out.supported = true; out.persisted = await sm.persisted(); }
      if (sm && typeof sm.estimate === 'function') { const e = await sm.estimate(); out.usage = e.usage; out.quota = e.quota; }
    } catch (e) { /* sandboxed */ }
    return out;
  }
  async function requestPersist() {
    try { if (navigator.storage && typeof navigator.storage.persist === 'function') return !!(await navigator.storage.persist()); } catch (e) { /* noop */ }
    return false;
  }
  // Ask once per device, after data exists. Safari and Chrome decide quietly (no prompt).
  CB.on('data', CB.debounce(() => {
    if (lsGet(LS_ASKED) || !S().ready || !S().list().length) return;
    lsSet(LS_ASKED, CB.nowISO());
    requestPersist();
  }, 4000));

  // ───────────────────────── restore / download ─────────────────────────
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hm = (d) => { let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`; };
  const when = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const n = CB.daysBetween(CB.toISODate(d), CB.todayISO());
    return `${n === 0 ? 'Today' : n === 1 ? 'Yesterday' : `${WD[d.getDay()]}, ${CB.MONTHS[d.getMonth()]} ${d.getDate()}`} · ${hm(d)}`;
  };
  const size = (b) => (b == null ? '—' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(1) + ' GB');
  function diff(data) {
    const cur = new Map(S().list().map((j) => [j.id, j]));
    const snap = (Array.isArray(data.jobs) ? data.jobs : []).filter((j) => j && j.id);
    const ids = new Set(snap.map((j) => j.id));
    let back = 0, revert = 0, same = 0;
    snap.forEach((j) => { const c = cur.get(j.id); if (!c) back++; else if (JSON.stringify(c) === JSON.stringify(j)) same++; else revert++; });
    const gone = [...cur.keys()].filter((id) => !ids.has(id)).length;
    const r = S().resume;
    const resume = !data.resume ? 'keep' : r && r.text === data.resume.text ? 'same' : 'change';
    const settings = !data.settings ? 'keep' : JSON.stringify(Object.assign({}, S().settings, data.settings)) === JSON.stringify(S().settings) ? 'same' : 'change';
    return { total: snap.length, back, revert, same, gone, resume, settings };
  }
  async function restore(id) {
    let rec, data;
    try { rec = await getOne(id); data = rec && JSON.parse(rec.payload); } catch (e) { data = null; }
    if (!rec || !data || typeof data !== 'object') { toast('This snapshot could not be read, so nothing was changed.', { tone: 'bad' }); return false; }
    const d = diff(data);
    const row = (n, l, tone) => `<div class="vt-d-r${n ? '' : ' is-zero'}"><b class="mono ${tone || ''}">${n}</b><span>${l}</span></div>`;
    const changes = d.back + d.revert + d.gone + (d.resume === 'change' ? 1 : 0) + (d.settings === 'change' ? 1 : 0);
    return new Promise((res) => {
      let ok = false;
      UI().modal({
        title: 'Restore this snapshot?',
        body: `<div class="vt-diff">
          <p class="vt-d-when"><b>${E(when(rec.at))}</b> · ${E(REASON[rec.reason] || 'Snapshot')} · ${rec.jobs} application${rec.jobs === 1 ? '' : 's'}</p>
          <div class="vt-d-g">
            ${row(d.back, `come back${d.back ? ' (deleted since)' : ''}`, 'up')}
            ${row(d.revert, 'return to their earlier version', 'warn')}
            ${row(d.gone, 'added since will be removed', 'down')}
            ${row(d.same, 'unchanged')}
          </div>
          <p class="vt-d-x"><span>Resume</span><b>${d.resume === 'change' ? 'Replaced with the snapshot\'s' : d.resume === 'same' ? 'Unchanged' : 'Kept as is'}</b></p>
          <p class="vt-d-x"><span>Settings</span><b>${d.settings === 'change' ? 'Restored' : 'Unchanged'}</b></p>
          <p class="vt-d-n">${changes ? 'Callback saves a snapshot of what you have now first, so you can switch back from this list.' : 'This snapshot matches what you have now. Restoring changes nothing.'}</p>
        </div>`,
        foot: '<button class="btn" data-c>Cancel</button><button class="btn btn-primary" data-ok>Restore snapshot</button>',
        onMount: (m, api) => {
          m.querySelector('[data-c]').onclick = () => api.close();
          m.querySelector('[data-ok]').onclick = () => { ok = true; api.close(); };
        },
        onClose: () => {
          if (!ok) { res(false); return; }
          try {
            const n = S().restoreBackup(data);
            toast(`Restored ${n} application${n === 1 ? '' : 's'} from ${when(rec.at)}. What you had before was saved as a snapshot.`, { ms: 7000 });
            res(true);
          } catch (e) { CB.reportError(e, { where: 'vault:restore' }); res(false); }
        },
      });
    });
  }
  async function download(id) {
    let rec;
    try { rec = await getOne(id); } catch (e) { rec = null; }
    if (!rec) { toast('This snapshot is no longer available.', { tone: 'bad' }); return { ok: false }; }
    const d = new Date(rec.at);
    const name = `callback-snapshot-${rec.day}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.json`;
    const r = await CB.saveFile(name, rec.payload, 'application/json');
    if (r && r.ok === false) { if (r.code !== 'declined') toast(r.message || 'The snapshot could not be saved.', { tone: 'bad' }); return r; }
    markBackup();
    toast('Snapshot saved. Restore it any time from Reports & Export.');
    return { ok: true };
  }

  // ───────────────────────── Settings card ─────────────────────────
  let card = null; // the mounted card (one listener for the whole module)
  CB.on('vault', () => { if (card) card.draw(); });
  CB.registerSettings({
    key: 'vault', title: 'Data Vault', order: 70,
    render(el) {
      let alive = true;
      const draw = async () => {
        let rows = null, err = null;
        try { rows = await list(); } catch (e) { err = e; }
        const sto = await storage();
        if (!alive || !el.isConnected) return;
        const last = lastBackup(), ld = daysSince(last);
        const pctUsed = sto.usage != null && sto.quota ? Math.max(0.5, Math.min(100, (sto.usage / sto.quota) * 100)) : 0;
        el.innerHTML = `<div class="vt">
          <p class="vt-lead">Restore points kept on this device: one a day (last ${KEEP_DAILY}) and one before anything that removes data (last ${KEEP_PRE}).</p>
          <div class="vt-health">
            <div class="vt-h"><span class="lbl">Storage</span>${sto.persisted ? '<b class="vt-ok">Protected</b><span>The browser won\'t clear it to save space.</span>' : sto.supported ? '<b>Best effort</b><span>The browser may clear it when space runs low.</span><button class="btn btn-sm" data-persist>Protect my data</button>' : '<b>Unknown</b><span>This browser doesn\'t report it.</span>'}</div>
            <div class="vt-h"><span class="lbl">Used on this device</span><b class="mono">${size(sto.usage)}</b><span>${sto.quota ? 'of ' + size(sto.quota) + ' available' : 'Quota not reported'}</span></div>
            ${sto.quota ? `<div class="vt-meter" title="${pctUsed.toFixed(2)}% used"><i style="width:${pctUsed}%"></i></div>` : ''}
          </div>
          <div class="vt-list-h"><span class="eyebrow">Snapshots${rows ? ' · ' + rows.length : ''}</span>${rows ? `<button class="btn btn-sm" data-snap>${icon('plus')}Snapshot now</button>` : ''}</div>
          ${err ? `<p class="vt-empty">Snapshots aren't available in this browser mode (${E(err.message || 'IndexedDB blocked')}). Use Back up now to keep a copy.</p>`
            : rows.length ? `<div class="vt-list">${rows.map((r) => `<div class="vt-row">
                <i class="vt-dot ${E(r.kind)}" aria-hidden="true"></i>
                <div class="vt-i"><b>${E(when(r.at))}</b><span>${E(REASON[r.reason] || 'Snapshot')}${r.note ? ' · ' + E(r.note) : ''} · ${r.jobs} job${r.jobs === 1 ? '' : 's'} · ${size(r.bytes)}</span></div>
                <div class="vt-a"><button class="btn btn-sm" data-restore="${E(r.id)}">Restore</button><button class="btn btn-ghost btn-icon btn-sm" data-dl="${E(r.id)}" title="Download as .json" aria-label="Download snapshot">${icon('download')}</button></div>
              </div>`).join('')}</div>`
            : '<p class="vt-empty">The first snapshot is taken automatically a few seconds after your data loads.</p>'}
          <div class="vt-backup">
            <div><b>Off-device backup</b><span>${last ? `Last backup ${ld === 0 ? 'today' : ld === 1 ? 'yesterday' : ld + ' days ago'}` : 'No backup yet'}. Save it to Files or iCloud Drive.</span></div>
            <button class="btn btn-accent btn-sm" data-backup>${icon('download')}Back up now</button>
          </div>
        </div>`;
        const on = (sel, fn) => el.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
        on('[data-restore]', (b) => restore(b.dataset.restore));
        on('[data-dl]', (b) => download(b.dataset.dl));
        on('[data-backup]', () => backupNow());
        on('[data-snap]', async (b) => { b.disabled = true; const r = await snapshot('manual'); toast(r ? 'Snapshot saved on this device' : 'The snapshot could not be saved.', r ? {} : { tone: 'bad' }); });
        on('[data-persist]', async () => { const ok = await requestPersist(); toast(ok ? 'Storage is now protected on this device.' : 'The browser declined for now. Installing Callback to the Home Screen usually allows it.', ok ? {} : { tone: 'warn' }); draw(); });
      };
      card = { el, draw: () => { if (el.isConnected) draw(); else alive = false; } };
      el.innerHTML = '<p class="vt-empty">Opening the vault…</p>';
      draw();
    },
  });
  if (typeof CB.registerCommand === 'function') {
    CB.registerCommand({ key: 'vault-backup', label: 'Back up all data now (.json)', run: () => backupNow() });
    CB.registerCommand({ key: 'vault-snap', label: 'Save a restore point (Data Vault)', run: () => snapshot('manual').then((r) => toast(r ? 'Restore point saved. See Settings → Data Vault.' : 'The snapshot could not be saved.')) });
  }

  CB.css('feat-vault', `
.vt{display:grid;gap:16px}
.vt-lead{margin:0;font-size:13px;line-height:1.55;color:var(--ink-2)}
.vt-health{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-radius:var(--r-md);background:var(--surface-2);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--line-1);overflow:hidden}
.vt-h{display:grid;gap:5px;align-content:start;justify-items:start;padding:14px 16px}
.vt-h+.vt-h{border-left:1px solid var(--line-1)}
.vt-h b{font:500 15px/1.25 var(--f-ui);letter-spacing:-.01em;color:var(--ink-1)}
.vt-h b.mono{font:400 22px/1.1 var(--f-mono);letter-spacing:-.02em}
.vt-h>span:not(.lbl){font-size:12px;line-height:1.45;color:var(--ink-3)}
.vt-h .btn{margin-top:6px}
.vt-ok{color:var(--success)!important}
.vt-meter{grid-column:1/-1;height:3px;background:var(--track)}
.vt-meter i{display:block;height:100%;background:var(--metal-cta)}
.vt-list-h{display:flex;align-items:center;justify-content:space-between;gap:10px}
.vt-list{display:grid;margin-top:-8px}
.vt-row{display:grid;grid-template-columns:8px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line-1)}
.vt-row:first-child{border-top:0}
.vt-dot{width:7px;height:7px;border-radius:50%;background:var(--gold-300);box-shadow:0 0 0 3px var(--gold-soft)}
.vt-dot.pre{background:var(--info);box-shadow:0 0 0 3px color-mix(in srgb,var(--info) 14%,transparent)}
.vt-dot.manual{background:var(--ink-3);box-shadow:0 0 0 3px var(--line-1)}
.vt-i{min-width:0}
.vt-i b{display:block;font-weight:540;font-size:13px;color:var(--ink-1)}
.vt-i span{display:block;margin-top:3px;font:450 11px/1.4 var(--f-mono);color:var(--ink-3);overflow-wrap:anywhere}
.vt-a{display:flex;gap:4px;align-items:center}
.vt-empty{margin:0;font-size:12.5px;line-height:1.55;color:var(--ink-3)}
.vt-backup{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:13px 14px 13px 16px;border-radius:var(--r-md);background:var(--surface-1);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--line-2),inset 2px 0 0 var(--gold-line)}
.vt-backup b{display:block;font-weight:560;font-size:13px;color:var(--ink-1)}
.vt-backup span{display:block;margin-top:2px;font-size:12px;color:var(--ink-3)}
.vt-diff{display:grid;gap:14px}
.vt-d-when{margin:0;font-size:13px;color:var(--ink-2)}
.vt-d-when b{color:var(--ink-1);font-weight:560}
.vt-d-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-radius:var(--r-md);background:var(--surface-2);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--line-1);overflow:hidden}
.vt-d-r{display:grid;gap:4px;padding:12px 14px;border-top:1px solid var(--line-1)}
.vt-d-r:nth-child(-n+2){border-top:0}
.vt-d-r:nth-child(2n){border-left:1px solid var(--line-1)}
.vt-d-r b{font-size:22px;font-weight:400;letter-spacing:-.02em;color:var(--ink-1)}
.vt-d-r b.up{color:var(--success)} .vt-d-r b.warn{color:var(--warning)} .vt-d-r b.down{color:var(--danger)}
.vt-d-r.is-zero b{color:var(--ink-4)}
.vt-d-r span{font-size:12px;color:var(--ink-3)}
.vt-d-x{display:flex;justify-content:space-between;gap:12px;margin:0;padding:0 2px;font-size:13px;color:var(--ink-3)}
.vt-d-x b{font-weight:540;color:var(--ink-1)}
.vt-d-n{margin:0;font-size:12px;line-height:1.5;color:var(--ink-3)}
@media (max-width:560px){
  .vt-health{grid-template-columns:minmax(0,1fr)}
  .vt-h+.vt-h{border-left:0;border-top:1px solid var(--line-1)}
  .vt-backup .btn{width:100%;justify-content:center}
}
`);

  CB.Vault = { snapshot, list, restore, download, backupNow, lastBackup, storage, prune, diff, _idb: idb };
})();
