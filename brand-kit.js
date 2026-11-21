/* Brand kit — each merchant folder's reusable images, shared by every Rep Hub tool.
 *
 *   main       merchants.logo_path (the folder's logo)
 *   secondary, hero, favicon, banner, lock   merchants.brand (jsonb; needs si-rep-hub/brand-kit.sql)
 *
 * Images are public URLs in the 'logos' bucket (SIsb.uploadLogo), so tools can copy them into saves.
 *
 *   SIBrand.SLOTS                 [{ k, label, hint }]
 *   SIBrand.get(folderId)         → { main, secondary, hero, favicon, banner, lock } ('' when empty)
 *   SIBrand.set(folderId, k, v)   v = data: URL (uploaded first), a URL, or '' to clear → the new kit
 *   SIBrand.store(dataUrl)        → a public URL (signed in), else the data URL back
 */
(function () {
  const SLOTS = [
    { k: 'main',      label: 'Main logo',      hint: 'The folder logo' },
    { k: 'secondary', label: 'Secondary logo', hint: 'Alternate / light version' },
    { k: 'hero',      label: 'Hero logo',      hint: 'Large logo for heroes' },
    { k: 'favicon',   label: 'Favicon',        hint: 'Square icon' },
    { k: 'banner',    label: 'Banner',         hint: 'Wide banner image' },
    { k: 'lock',      label: 'Custom SI lock', hint: 'Their logo in the ShipInsure lock' }
  ];
  const EXTRA = SLOTS.filter(s => s.k !== 'main').map(s => s.k);
  const NEED_SQL = 'Run si-rep-hub/brand-kit.sql in Supabase to turn on brand kits';
  const missingCol = e => /brand/.test(String((e && (e.message || e.details)) || '')) && /column|schema/i.test(String((e && e.message) || ''));

  async function store(dataUrl) {
    if (!/^data:/.test(String(dataUrl || ''))) return dataUrl || '';
    try { if (window.SIsb && await SIsb.currentUser()) { const u = await SIsb.uploadLogo(dataUrl); if (u) return u; } } catch (e) {}
    return dataUrl;
  }
  async function get(id) {
    const out = { main: '', secondary: '', hero: '', favicon: '', banner: '', lock: '' };
    if (!id || !window.SIsb) return out;
    const c = await SIsb.client();
    let r = await c.from('merchants').select('logo_path, brand').eq('id', id).single();
    if (r.error && missingCol(r.error)) { r = await c.from('merchants').select('logo_path').eq('id', id).single(); if (r.data) r.data.noBrandCol = true; }
    if (r.error) throw r.error;
    const b = (r.data && r.data.brand) || {};
    out.main = (r.data && r.data.logo_path) || '';
    EXTRA.forEach(k => { out[k] = typeof b[k] === 'string' ? b[k] : ''; });
    if (r.data && r.data.noBrandCol) out.needsSql = true;
    return out;
  }
  async function set(id, k, v) {
    if (!id) throw new Error('Pick a merchant folder first');
    const url = v ? await store(v) : '';
    if (/^data:/.test(url)) throw new Error('Sign in to save images to the brand kit');
    if (k === 'main') { await SIsb.updateFolder(id, { logoUrl: url || null }); return get(id); }
    if (EXTRA.indexOf(k) < 0) throw new Error('Unknown brand kit slot: ' + k);
    const c = await SIsb.client();
    const cur = await c.from('merchants').select('brand').eq('id', id).single();
    if (cur.error) throw (missingCol(cur.error) ? new Error(NEED_SQL) : cur.error);
    const brand = Object.assign({}, (cur.data && cur.data.brand) || {});
    if (url) brand[k] = url; else delete brand[k];
    const { error } = await c.from('merchants').update({ brand: brand, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw (missingCol(error) ? new Error(NEED_SQL) : error);
    return get(id);
  }
  window.SIBrand = { SLOTS, get, set, store, NEED_SQL };
})();
