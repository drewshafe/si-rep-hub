// hubspot-note — Supabase Edge Function (project oiljklutlmtztascnkpm)
//
// Posts a Brand Folder's Brief as a note on the merchant's HubSpot deal (associated to the deal, its
// company and its contacts). Two steps so the rep always sees which deal it lands on:
//   { dry: true, deal?, domain?, name? }   → { deal: { id, name, stage, url }, candidates: [...] }
//   { deal, html }                         → { ok: true, noteId, url }
// `deal` is a deal id or a HubSpot deal URL. Without one, the deal is found by the company domain
// (the folder's store URL), then by deal name containing the merchant name; open deals first.
//
// Only signed-in @shipinsure.io reps (their Supabase login, checked with Supabase Auth). The HubSpot
// token never reaches a browser: it's this function's secret.
//
// Setup (once):
//   HubSpot → Settings → Integrations → Private Apps → Create: scopes crm.objects.deals.read,
//     crm.objects.deals.write, crm.objects.companies.read, crm.objects.contacts.read,
//     crm.objects.contacts.write → copy the access token.
//   supabase secrets set HUBSPOT_TOKEN=<token> --project-ref oiljklutlmtztascnkpm
//   supabase functions deploy hubspot-note --project-ref oiljklutlmtztascnkpm --no-verify-jwt

const HS = 'https://api.hubapi.com';
const PORTAL = '22466049';
const ORIGINS = [/^https:\/\/drewshafe\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const MAX_HTML = 60000;
// HubSpot-defined association types from a note.
const NOTE_TO = { deal: 214, company: 190, contact: 202 };

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ORIGINS.some((re) => re.test(origin));
  return {
    'access-control-allow-origin': ok ? origin! : 'https://drewshafe.github.io',
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
  };
}

async function hs(path: string, init: RequestInit = {}) {
  const token = Deno.env.get('HUBSPOT_TOKEN');
  if (!token) throw Object.assign(new Error('The HubSpot connection isn’t set up yet (HUBSPOT_TOKEN secret).'), { status: 503 });
  const r = await fetch(HS + path, { ...init, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json', ...(init.headers || {}) } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw Object.assign(new Error('HubSpot said ' + r.status + (t ? ': ' + t.slice(0, 240) : '')), { status: r.status === 429 ? 429 : r.status === 404 ? 404 : 502 });
  }
  return r.status === 204 ? {} : r.json();
}

const dealUrl = (id: string) => 'https://app.hubspot.com/contacts/' + PORTAL + '/record/0-3/' + id;
const cleanDomain = (d: string) => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
function dealIdOf(v: unknown) {
  const s = String(v || '').trim();
  if (/^\d{4,}$/.test(s)) return s;
  const m = s.match(/\/(?:record\/0-3|deal)\/(\d{4,})/);
  return m ? m[1] : '';
}
// deno-lint-ignore no-explicit-any
type Deal = { id: string; name: string; stage: string; closed: boolean; url: string; created: string };
// deno-lint-ignore no-explicit-any
const shape = (d: any): Deal => ({
  id: String(d.id), name: d.properties?.dealname || '(no name)', stage: d.properties?.dealstage || '',
  closed: /closed/i.test(d.properties?.dealstage || ''), url: dealUrl(String(d.id)), created: d.properties?.createdate || '',
});
const PROPS = ['dealname', 'dealstage', 'createdate'];

// Deal stage ids → their labels ("appointmentscheduled" → "Demo Booked"), read once per cold start.
let stageLabels: Record<string, string> | null = null;
async function labelStages(deals: Deal[]) {
  if (!stageLabels) {
    stageLabels = {};
    try {
      const j = await hs('/crm/v3/pipelines/deals');
      // deno-lint-ignore no-explicit-any
      for (const p of (j.results || []) as any[]) for (const st of (p.stages || []) as any[]) stageLabels[st.id] = st.label;
    } catch (_) { /* labels are a nicety */ }
  }
  deals.forEach((d) => { d.closed = d.closed || /closed/i.test(stageLabels![d.stage] || ''); d.stage = stageLabels![d.stage] || d.stage; });
  return deals;
}
async function getDeal(id: string) { return shape(await hs('/crm/v3/objects/deals/' + id + '?properties=' + PROPS.join(','))); }
async function assocIds(from: string, id: string, to: string): Promise<string[]> {
  const j = await hs('/crm/v4/objects/' + from + '/' + id + '/associations/' + to + '?limit=100');
  // deno-lint-ignore no-explicit-any
  return (j.results || []).map((x: any) => String(x.toObjectId));
}
async function findDeals(domain: string, name: string): Promise<Deal[]> {
  const out = new Map<string, Deal>();
  if (domain) {
    const cs = await hs('/crm/v3/objects/companies/search', { method: 'POST', body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }], limit: 5 }) });
    // deno-lint-ignore no-explicit-any
    for (const c of (cs.results || []) as any[]) {
      const ids = await assocIds('companies', String(c.id), 'deals');
      if (ids.length) {
        const b = await hs('/crm/v3/objects/deals/batch/read', { method: 'POST', body: JSON.stringify({ properties: PROPS, inputs: ids.slice(0, 50).map((id) => ({ id })) }) });
        // deno-lint-ignore no-explicit-any
        for (const d of (b.results || []) as any[]) out.set(String(d.id), shape(d));
      }
    }
  }
  if (!out.size && name) {
    const ds = await hs('/crm/v3/objects/deals/search', { method: 'POST', body: JSON.stringify({ query: name, properties: PROPS, limit: 10 }) });
    // deno-lint-ignore no-explicit-any
    for (const d of (ds.results || []) as any[]) out.set(String(d.id), shape(d));
  }
  // Open deals first, newest first.
  return [...out.values()].sort((a, b) => (+a.closed - +b.closed) || String(b.created).localeCompare(String(a.created)));
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('origin'));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...h, 'content-type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  // A signed-in rep: Supabase Auth checks the login token, and it must be a ShipInsure email.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Sign in to the Rep Hub first' }, 401);
  const who = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', {
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') || 'sb_publishable_DTbJR5CxMe6wFYKKhogEtQ_XJyp4nMs', authorization: 'Bearer ' + jwt },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!who || !/@shipinsure\.io$/i.test(who.email || '')) return json({ error: 'Sign in to the Rep Hub with your ShipInsure email' }, 401);

  let body: { dry?: boolean; deal?: string; domain?: string; name?: string; html?: string } = {};
  try { body = await req.json(); } catch (_) { /* empty */ }

  try {
    if (body.dry) {
      const id = dealIdOf(body.deal);
      if (id) return json({ deal: (await labelStages([await getDeal(id)]))[0], candidates: [] });
      const candidates = await labelStages(await findDeals(cleanDomain(body.domain || ''), String(body.name || '').trim()));
      candidates.sort((a, b) => (+a.closed - +b.closed) || String(b.created).localeCompare(String(a.created)));
      if (!candidates.length) return json({ error: 'No HubSpot deal found for this merchant. Paste the deal link in the Brief’s HubSpot deal field.' }, 404);
      return json({ deal: candidates[0], candidates });
    }

    const id = dealIdOf(body.deal);
    if (!id) return json({ error: 'Pick the HubSpot deal first' }, 400);
    const html = String(body.html || '').trim();
    if (!html) return json({ error: 'The brief is empty' }, 400);
    if (html.length > MAX_HTML) return json({ error: 'The brief is too long for a HubSpot note' }, 400);

    const [companies, contacts] = await Promise.all([assocIds('deals', id, 'companies'), assocIds('deals', id, 'contacts')]);
    const to = (ids: string[], type: number) => ids.map((x) => ({ to: { id: x }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: type }] }));
    const note = await hs('/crm/v3/objects/notes', {
      method: 'POST',
      body: JSON.stringify({
        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: html + '<p><i>Posted from the Rep Hub Brief by ' + String(who.email).replace(/[<>&"]/g, '') + '</i></p>' },
        associations: to([id], NOTE_TO.deal).concat(to(companies.slice(0, 10), NOTE_TO.company), to(contacts.slice(0, 25), NOTE_TO.contact)),
      }),
    });
    return json({ ok: true, noteId: String(note.id), url: dealUrl(id), companies: companies.length, contacts: contacts.length });
  } catch (e) {
    const err = e as Error & { status?: number };
    return json({ error: err.message || 'HubSpot request failed' }, err.status || 502);
  }
});
