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
 *   kit.colors = { primary, accent } (brand.colors; set with SIBrand.set(id, 'colors', {...}))
 *   kit.accentFallback             the folder's accent from its calculator branding (bld / cb)
 *   SIBrand.palette(url)           → the image's main colors, most used first (white / black / grey skipped)
 *   SIBrand.optimal(hexes, bg)     → { border, text }: the brand color for an accent bar, and one that
 *                                    reads on bg (≥ 4.5:1, darkened from the brand color if none does)
 *   SIBrand.colorsFor(kit)         → the candidates in order: brand colors, folder accent, then the logo's
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
    let r = await c.from('merchants').select('logo_path, brand, bld, cb').eq('id', id).single();
    if (r.error && missingCol(r.error)) { r = await c.from('merchants').select('logo_path, bld, cb').eq('id', id).single(); if (r.data) r.data.noBrandCol = true; }
    if (r.error) throw r.error;
    const b = (r.data && r.data.brand) || {};
    out.main = (r.data && r.data.logo_path) || '';
    EXTRA.forEach(k => { out[k] = typeof b[k] === 'string' ? b[k] : ''; });
    const col = b.colors || {};
    out.colors = { primary: HEX(col.primary), accent: HEX(col.accent) };
    const bb = ((r.data && r.data.bld) || {}).branding || {}, cb = ((r.data && r.data.cb) || {}).branding || {};
    out.accentFallback = HEX(bb.accent) || HEX(cb.accentHex) || HEX(cb.accent);
    if (r.data && r.data.noBrandCol) out.needsSql = true;
    return out;
  }
  async function set(id, k, v) {
    if (!id) throw new Error('Pick a merchant folder first');
    const url = k === 'colors' ? '' : v ? await store(v) : '';
    if (/^data:/.test(url)) throw new Error('Sign in to save images to the brand kit');
    if (k === 'main') { await SIsb.updateFolder(id, { logoUrl: url || null }); return get(id); }
    if (k === 'colors') return setColors(id, v || {});
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
  async function setColors(id, v) {
    const c = await SIsb.client();
    const cur = await c.from('merchants').select('brand').eq('id', id).single();
    if (cur.error) throw (missingCol(cur.error) ? new Error(NEED_SQL) : cur.error);
    const brand = Object.assign({}, (cur.data && cur.data.brand) || {});
    const colors = { primary: HEX(v.primary), accent: HEX(v.accent) };
    if (colors.primary || colors.accent) brand.colors = colors; else delete brand.colors;
    const { error } = await c.from('merchants').update({ brand: brand, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw (missingCol(error) ? new Error(NEED_SQL) : error);
    return get(id);
  }

  // ── Colors ──
  function HEX(v) { v = String(v || '').trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) return ('#' + v.replace('#', '')).toLowerCase(); if (/^#?[0-9a-f]{3}$/i.test(v)) return ('#' + v.replace('#', '').split('').map(c => c + c).join('')).toLowerCase(); return ''; }
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function hsl(h) {
    const [r, g, b] = rgb(h).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1)); let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(hh * 60 + 360) % 360, s, l];
  }
  function fromHsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
  }
  // The image's main colors: pixels grouped coarsely, near-white / near-black / grey left out.
  function palette(src) {
    return new Promise(res => {
      if (!src) return res([]);
      const im = new Image(); if (!/^data:/.test(src)) im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const k = Math.min(1, 120 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
          const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
          const d = x.getImageData(0, 0, c.width, c.height).data, bins = {};
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 200) continue;
            const hex = toHex([d[i], d[i + 1], d[i + 2]]), [, s, l] = hsl(hex);
            if (l > 0.93 || l < 0.07 || s < 0.18) continue;
            const key = [d[i] >> 4, d[i + 1] >> 4, d[i + 2] >> 4].join(',');
            const b = bins[key] || (bins[key] = { n: 0, r: 0, g: 0, b: 0 }); b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
          }
          const all = Object.values(bins).sort((a, b) => b.n - a.n), total = all.reduce((v, b) => v + b.n, 0);
          res(all.filter(b => b.n >= total * 0.04).slice(0, 5).map(b => toHex([b.r / b.n, b.g / b.n, b.b / b.n])));
        } catch (e) { res([]); }
      };
      im.onerror = () => res([]);
      im.src = src;
    });
  }
  async function colorsFor(kit) {
    kit = kit || {};
    const out = [(kit.colors || {}).primary, (kit.colors || {}).accent, kit.accentFallback].map(HEX).filter(Boolean);
    if (!out.length) for (const s of [kit.main, kit.lock, kit.secondary, kit.hero]) { const p = await palette(s); if (p.length) { out.push(...p); break; } }
    return out.filter((v, i, a) => a.indexOf(v) === i);
  }
  // Border: the first brand color with some color in it (not near-white). Text: the first that reads on
  // bg at 4.5:1; if none, the border color darkened (or lightened on a dark box) until it does.
  function optimal(list, bg) {
    bg = HEX(bg) || '#ffffff';
    const c = (list || []).map(HEX).filter(Boolean); if (!c.length) return null;
    const border = c.find(h => { const [, s, l] = hsl(h); return s >= 0.2 && l < 0.9; }) || c.find(h => hsl(h)[2] < 0.9) || c[0];
    // Text keeps the border's hue (as the live modals do), darkened just enough to read; only a border
    // color that's far too light hands over to another brand color that already reads.
    const tune = h0 => { let [h, s, l] = hsl(h0); const dark = lum(bg) > 0.4; for (let i = 0; i < 60 && contrast(fromHsl(h, s, l), bg) < 4.5; i++) l = dark ? Math.max(0, l - 0.02) : Math.min(1, l + 0.02); return contrast(h0, bg) >= 4.5 ? h0 : fromHsl(h, s, l); };
    let text = contrast(border, bg) >= 4.5 ? border : contrast(border, bg) >= 2.2 ? tune(border) : (c.find(h => contrast(h, bg) >= 4.5 && hsl(h)[1] >= 0.15) || tune(border));
    return { border, text };
  }
  window.SIBrand = { SLOTS, get, set, store, NEED_SQL, palette, optimal, colorsFor, contrast, HEX };
})();
