// folder-bar.js — shared "Merchant Folder" save/load bar for Rep Hub tools.
// Needs sb.js (SIsb) on the page. Each tool mounts it with its own get/apply hooks:
//
//   SIFolderBar.mount({
//     kind: 'email',                    // merchant_assets.kind
//     tool: 'Email Automation',
//     before: document.querySelector('.wrap'),   // the bar is inserted before this element
//     getData: () => ({...}),           // the tool's full state to save
//     applyData: data => {...},         // restore a saved state
//     defaultTitle: () => 'Email – Acme',
//     shortLink: id => url              // optional; default = this page + ?asset=id
//   });
//
// ?asset=<id> in the page URL loads that save on start (works signed out too).
(function () {
  'use strict';
  const CSS = `
  .sifb { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 14px; margin:0 auto; background:#fff; border-bottom:1px solid #e3e5f2; font:13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#1d2240; position:relative; z-index:40; }
  .sifb-m { display:flex; align-items:center; gap:8px; border:1px solid #d8dbe8; background:#f7f8fc; border-radius:9px; padding:4px 10px 4px 4px; cursor:pointer; font:inherit; color:inherit; max-width:280px; }
  .sifb-m:hover { border-color:#b9bff0; }
  .sifb-m.none { border-style:dashed; padding-left:10px; color:#6b7090; }
  .sifb-lg { width:26px; height:26px; border-radius:7px; background:#eef0ff; color:#4a5fc1; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:11px; overflow:hidden; flex:0 0 auto; }
  .sifb-lg img { width:100%; height:100%; object-fit:contain; background:#fff; }
  .sifb-mn { display:flex; flex-direction:column; min-width:0; }
  .sifb-mn small { font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#6b7090; }
  .sifb-mn b { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sifb-cur { flex:1; min-width:120px; color:#6b7090; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sifb-cur b { color:#1d2240; font-weight:600; }
  .sifb button.sifb-b { font:inherit; font-size:12.5px; font-weight:700; border:1px solid #d8dbe8; background:#fff; color:#1d2240; border-radius:8px; padding:6px 11px; cursor:pointer; white-space:nowrap; }
  .sifb button.sifb-b:hover:not(:disabled) { border-color:#b9bff0; }
  .sifb button.sifb-b.p { background:#4a5fc1; border-color:#4a5fc1; color:#fff; }
  .sifb button.sifb-b:disabled { opacity:.45; cursor:default; }
  .sifb-dd { position:absolute; top:calc(100% + 4px); right:14px; width:min(360px, calc(100vw - 28px)); max-height:340px; overflow:auto; background:#fff; border:1px solid #d8dbe8; border-radius:12px; box-shadow:0 14px 40px rgba(20,24,60,.18); padding:6px; z-index:60; }
  .sifb-dd .it { display:flex; flex-direction:column; gap:2px; padding:8px 10px; border-radius:8px; cursor:pointer; }
  .sifb-dd .it:hover { background:#f3f4fb; }
  .sifb-dd .it b { font-weight:600; }
  .sifb-dd .it span { font-size:11.5px; color:#6b7090; }
  .sifb-dd .it.cur { background:#eef0ff; }
  .sifb-dd .em { padding:12px; color:#6b7090; font-size:12.5px; }
  .sifb-toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%) translateY(90px); background:#222; color:#fff; font:600 13px -apple-system,sans-serif; padding:10px 16px; border-radius:8px; transition:transform .25s; z-index:300; }
  .sifb-toast.show { transform:translateX(-50%) translateY(0); }
  body.pm .sifb { background:#0d0d12; border-color:#26262f; color:#ece6d6; }
  body.pm .sifb-m { background:#15151c; border-color:#2e2b22; }
  body.pm .sifb button.sifb-b { background:#15151c; border-color:#2e2b22; color:#ece6d6; }
  body.pm .sifb button.sifb-b.p { background:linear-gradient(135deg,#b8902d,#e3c56a); color:#0a0a0a; border-color:transparent; }
  body.pm .sifb-cur b { color:#ece6d6; }
  body.pm .sifb-dd { background:#15151c; border-color:#2e2b22; }
  body.pm .sifb-dd .it:hover, body.pm .sifb-dd .it.cur { background:#1f1b10; }
  body.view .sifb { display:none; }`;

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  function ago(t) {
    const s = (Date.now() - Date.parse(t)) / 1000;
    if (!(s >= 0)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }
  let toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'sifb-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }
  const inHub = () => { try { return window.parent !== window; } catch (e) { return false; } };
  const goFolders = () => {
    if (inHub()) parent.postMessage({ siHub: 'folders', type: 'goto' }, '*');
    else window.open('https://drewshafe.github.io/si-rep-hub/#folders', '_blank', 'noopener');
  };

  function mount(o) {
    if (!window.SIsb) { console.warn('folder-bar: sb.js missing'); return null; }
    if (!document.getElementById('sifb-css')) { const st = document.createElement('style'); st.id = 'sifb-css'; st.textContent = CSS; document.head.appendChild(st); }
    const bar = document.createElement('div');
    bar.className = 'sifb';
    (o.before && o.before.parentNode ? o.before.parentNode : document.body).insertBefore(bar, o.before || document.body.firstChild);

    let user = null;
    let cur = null;   // the save this tool is showing: { id, title, folder, updated_at }
    const shortLink = id => o.shortLink ? o.shortLink(id) : (() => { const u = new URL(location.href); u.hash = ''; u.searchParams.set('asset', id); u.searchParams.delete('theme'); u.searchParams.delete('view'); return u.toString(); })();
    const setUrl = id => { try { const u = new URL(location.href); u.searchParams.set('asset', id); u.hash = ''; history.replaceState(null, '', u.toString()); } catch (e) {} };

    function paint() {
      const a = SIsb.getActiveFolder();
      const lg = a ? (a.logo ? '<span class="sifb-lg"><img alt="" src="' + esc(a.logo) + '"></span>' : '<span class="sifb-lg">' + esc(initials(a.name)) + '</span>') : '';
      const curTxt = cur && a && cur.folder === a.id
        ? '<b>' + esc(cur.title || 'Untitled') + '</b> · saved ' + esc(ago(cur.updated_at))
        : (a ? 'Not saved to this folder yet' : '');
      const can = !!(user && a);
      bar.innerHTML =
        (a ? '<button type="button" class="sifb-m" data-a="folders" title="Change merchant in Merchant Folders">' + lg + '<span class="sifb-mn"><small>Merchant folder</small><b>' + esc(a.name) + '</b></span></button>'
           : '<button type="button" class="sifb-m none" data-a="folders">📁 Pick a merchant folder</button>') +
        '<span class="sifb-cur">' + (user ? curTxt : 'Sign in to save to merchant folders') + '</span>' +
        (user ? '' : '<button type="button" class="sifb-b" data-a="signin">Sign in</button>') +
        '<button type="button" class="sifb-b p" data-a="save"' + (can ? '' : ' disabled') + ' title="' + (cur && a && cur.folder === a.id ? 'Update “' + esc(cur.title) + '”' : 'Save to ' + esc(a ? a.name : 'the folder')) + '">Save</button>' +
        '<button type="button" class="sifb-b" data-a="saveas"' + (can ? '' : ' disabled') + '>Save as new</button>' +
        '<button type="button" class="sifb-b" data-a="load"' + (can ? '' : ' disabled') + '>Load ▾</button>' +
        '<button type="button" class="sifb-b" data-a="link"' + (can ? '' : ' disabled') + ' title="Saves, then copies a short link">🔗 Short link</button>';
    }

    async function save(asNew) {
      const a = SIsb.getActiveFolder(); if (!a) { goFolders(); return null; }
      const updating = !asNew && cur && cur.folder === a.id;
      let title = updating ? cur.title : prompt('Name this ' + o.tool + ' save:', (o.defaultTitle && o.defaultTitle()) || o.tool);
      if (title == null) return null;
      title = title.trim() || ((o.defaultTitle && o.defaultTitle()) || o.tool);
      try {
        const res = await SIsb.saveAsset({ id: updating ? cur.id : undefined, merchant_ref: a.id, kind: o.kind, title: title, data: o.getData() });
        cur = { id: res.id, title: title, folder: a.id, updated_at: res.updated_at || new Date().toISOString() };
        setUrl(res.id); paint();
        toast((updating ? 'Updated “' : 'Saved “') + title + '” to ' + a.name);
        return cur;
      } catch (e) { toast('Couldn’t save: ' + (e.message || e)); return null; }
    }

    async function loadId(id, quiet) {
      try {
        const r = await SIsb.getAsset(id);
        if (r.kind !== o.kind) throw new Error('That save is for a different tool');
        o.applyData(r.data || {});
        cur = { id: r.id, title: r.title, folder: r.merchant_ref, updated_at: r.updated_at };
        // Opening a save makes its merchant the active one (reps only; merchants just view it).
        if (user) {
          const a = SIsb.getActiveFolder();
          if (!a || a.id !== r.merchant_ref) {
            let logo = '';
            try { const m = await SIsb.getMerchant(r.merchant_ref); logo = m.logo_path || ''; } catch (e) {}
            SIsb.setActiveFolder({ id: r.merchant_ref, name: r.merchant, logo_path: logo });
          }
        }
        setUrl(r.id); paint();
        if (!quiet) toast('Loaded “' + r.title + '”');
      } catch (e) { toast('Couldn’t load: ' + (e.message || e)); }
    }

    async function openList(btn) {
      const old = bar.querySelector('.sifb-dd'); if (old) { old.remove(); return; }
      const a = SIsb.getActiveFolder(); if (!a) return;
      const dd = document.createElement('div'); dd.className = 'sifb-dd'; dd.innerHTML = '<div class="em">Loading…</div>';
      bar.appendChild(dd);
      try {
        const rows = await SIsb.listAssets(a.id, o.kind);
        dd.innerHTML = rows.length ? rows.map(r => '<div class="it' + (cur && cur.id === r.id ? ' cur' : '') + '" data-id="' + esc(r.id) + '"><b>' + esc(r.title || 'Untitled') + '</b><span>' +
          esc((r.updated_by_email || r.rep_email || '').split('@')[0]) + ' · ' + esc(ago(r.updated_at)) + '</span></div>').join('')
          : '<div class="em">No ' + esc(o.tool) + ' saves in ' + esc(a.name) + ' yet.</div>';
      } catch (e) { dd.innerHTML = '<div class="em">' + esc(e.message || e) + '</div>'; }
      dd.addEventListener('click', ev => { const it = ev.target.closest('.it'); if (!it) return; dd.remove(); loadId(it.dataset.id); });
    }

    bar.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-a]'); if (!b) return;
      const act = b.dataset.a;
      if (act === 'folders') return goFolders();
      if (act === 'signin') {
        const email = prompt('Sign in to save to merchant folders.\nEnter your ShipInsure email — we’ll send a magic link:');
        if (!email) return;
        try { const { error } = await SIsb.signInMagic(email.trim()); toast(error ? 'Error: ' + error.message : 'Magic link sent — open it in this browser, then reload'); } catch (e) { toast('Error: ' + (e.message || e)); }
        return;
      }
      if (act === 'save') return save(false);
      if (act === 'saveas') return save(true);
      if (act === 'load') return openList(b);
      if (act === 'link') {
        const s = await save(false); if (!s) return;
        const url = shortLink(s.id);
        try { await navigator.clipboard.writeText(url); toast('Short link copied'); } catch (e) { prompt('Copy this link:', url); }
      }
    });
    document.addEventListener('click', ev => { const dd = bar.querySelector('.sifb-dd'); if (dd && !bar.contains(ev.target)) dd.remove(); });
    SIsb.onActiveFolder(paint);

    // The Hub's Copy Link uses this when the current design is saved.
    window.siFolderShortLink = () => cur ? shortLink(cur.id) : null;

    paint();
    const ready = SIsb.currentUser().then(u => { user = u; paint(); }, () => {});
    const want = new URLSearchParams(location.search).get('asset');
    if (want) ready.then(() => loadId(want, true));
    return { save: save, load: loadId, current: () => cur };
  }

  window.SIFolderBar = { mount: mount };
})();
