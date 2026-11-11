// fathom-call — Supabase Edge Function (project oiljklutlmtztascnkpm)
//
// Reads a Fathom call so the One-Pager can draft a meeting recap from it. Takes any of:
//   • a call link    https://fathom.video/calls/<recording id>
//   • a share link   https://fathom.video/share/<token>
//   • a folder link  https://fathom.video/folders/<id>
// Fathom's API has no folders, so a folder link is read as "this merchant's calls": the calls whose
// invitees include the merchant's email domain (the Brand Folder's store URL), newest first.
//
// Only signed-in @shipinsure.io reps (their Supabase login, checked with Supabase Auth). The Fathom
// key never reaches a browser: it's this function's secret.
//
// Setup (once):
//   supabase secrets set FATHOM_API_KEY=<key from Fathom → Settings → API Access> --project-ref oiljklutlmtztascnkpm
//   supabase functions deploy fathom-call --project-ref oiljklutlmtztascnkpm --no-verify-jwt
// (--no-verify-jwt: the gateway can't check this project's ES256 tokens; the function checks them
// with Supabase Auth itself, as below.)

const FATHOM = 'https://api.fathom.ai/external/v1';
const ORIGINS = [/^https:\/\/drewshafe\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const MAX_PAGES = 12;          // pages of meetings scanned to find a call (Fathom pages are small)
const MAX_TRANSCRIPT = 120000; // characters of transcript returned for the main call
const FOLDER_CALLS = 3;        // calls returned for a folder link (newest first)

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ORIGINS.some((re) => re.test(origin));
  return {
    'access-control-allow-origin': ok ? origin! : 'https://drewshafe.github.io',
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
  };
}

type Link = { kind: 'call'; id: number } | { kind: 'share'; token: string } | { kind: 'folder'; id: string };
function parseLink(raw: string): Link | null {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (_) { return null; }
  if (!/(^|\.)fathom\.(video|ai)$/i.test(u.hostname)) return null;
  let m = u.pathname.match(/\/calls\/(\d+)/);
  if (m) return { kind: 'call', id: +m[1] };
  m = u.pathname.match(/\/share\/([\w-]+)/);
  if (m) return { kind: 'share', token: m[1] };
  m = u.pathname.match(/\/folders\/([\w-]+)/);
  if (m) return { kind: 'folder', id: m[1] };
  return null;
}
const cleanDomain = (d: string) => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');

async function fathom(path: string, params?: [string, string][]) {
  const key = Deno.env.get('FATHOM_API_KEY');
  if (!key) throw Object.assign(new Error('The Fathom API key isn’t set up yet (FATHOM_API_KEY secret).'), { status: 503 });
  const qs = params && params.length ? '?' + params.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
  const r = await fetch(FATHOM + path + qs, { headers: { 'X-Api-Key': key, accept: 'application/json' } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw Object.assign(new Error('Fathom said ' + r.status + (r.status === 429 ? ' (too many requests; try again in a minute)' : t ? ': ' + t.slice(0, 200) : '')), { status: r.status === 429 ? 429 : 502 });
  }
  return r.json();
}

// deno-lint-ignore no-explicit-any
type Meeting = any;
// Pages of meetings (newest first), stopping as soon as `stop` finds what it wants.
async function scan(params: [string, string][], stop: (m: Meeting) => boolean, pages = MAX_PAGES): Promise<Meeting[]> {
  const out: Meeting[] = [];
  let cursor = '';
  for (let i = 0; i < pages; i++) {
    const j = await fathom('/meetings', cursor ? params.concat([['cursor', cursor]]) : params);
    for (const m of j.items || []) { out.push(m); if (stop(m)) return out; }
    cursor = j.next_cursor || '';
    if (!cursor || !(j.items || []).length) break;
  }
  return out;
}

function transcriptText(t: Meeting[] | null | undefined) {
  if (!Array.isArray(t)) return '';
  const s = t.map((x) => (x.timestamp ? '[' + x.timestamp + '] ' : '') + ((x.speaker && x.speaker.display_name) || 'Speaker') + ': ' + (x.text || '')).join('\n');
  return s.length > MAX_TRANSCRIPT ? s.slice(0, MAX_TRANSCRIPT) + '\n[…transcript cut for length]' : s;
}
function shape(m: Meeting, transcript: string) {
  return {
    recording_id: m.recording_id,
    title: m.title || m.meeting_title || 'Call',
    date: m.recording_start_time || m.scheduled_start_time || m.created_at || null,
    url: m.url || null,
    share_url: m.share_url || null,
    recorded_by: m.recorded_by ? { name: m.recorded_by.name, email: m.recorded_by.email } : null,
    invitees: (m.calendar_invitees || []).map((p: Meeting) => ({ name: p.name || p.matched_speaker_display_name || '', email: p.email || '', external: !!p.is_external })),
    summary: (m.default_summary && m.default_summary.markdown_formatted) || '',
    action_items: (m.action_items || []).map((a: Meeting) => ({ description: a.description, assignee: a.assignee ? a.assignee.name || a.assignee.email || '' : '', completed: !!a.completed })),
    transcript,
  };
}
async function transcriptFor(m: Meeting) {
  if (Array.isArray(m.transcript)) return transcriptText(m.transcript);
  try { return transcriptText((await fathom('/recordings/' + m.recording_id + '/transcript')).transcript); } catch (_) { return ''; }
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
    // The project's public key (also in sb.js) when the legacy anon key isn't in the environment.
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') || 'sb_publishable_DTbJR5CxMe6wFYKKhogEtQ_XJyp4nMs', authorization: 'Bearer ' + jwt },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!who || !/@shipinsure\.io$/i.test(who.email || '')) return json({ error: 'Sign in to the Rep Hub with your ShipInsure email' }, 401);

  let body: { url?: string; domain?: string } = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  const link = parseLink(String(body.url || ''));
  if (!link) return json({ error: 'That isn’t a Fathom call, share or folder link' }, 400);
  const domain = cleanDomain(body.domain || '');
  const base: [string, string][] = [['include_summary', 'true'], ['include_action_items', 'true']];
  const byDomain: [string, string][] = domain ? [['calendar_invitees_domains[]', domain]] : [];

  try {
    if (link.kind === 'folder') {
      if (!domain) return json({ error: 'A Fathom folder link needs the merchant’s store URL on its Brand Folder (✎ Edit folder), so its calls can be found.' }, 400);
      const calls = await scan(base.concat(byDomain), () => false, 2);
      if (!calls.length) return json({ error: 'No Fathom calls with anyone @' + domain + ' yet. Paste a call or share link instead.' }, 404);
      const top = calls.slice(0, FOLDER_CALLS);
      const first = shape(top[0], await transcriptFor(top[0]));
      return json({ kind: 'folder', domain, calls: [first].concat(top.slice(1).map((m) => shape(m, ''))) });
    }
    const hit = (m: Meeting) => link.kind === 'call' ? m.recording_id === link.id : String(m.share_url || '').replace(/\/+$/, '').endsWith('/share/' + link.token);
    // The merchant's own calls first (fast), then everything the key can see.
    let found = domain ? (await scan(base.concat(byDomain), hit, 4)).find(hit) : null;
    if (!found) found = (await scan(base, hit)).find(hit);
    if (!found && link.kind === 'call') {
      // Not in the scanned pages (an older call): its transcript still loads by id.
      const transcript = transcriptText((await fathom('/recordings/' + link.id + '/transcript')).transcript);
      if (!transcript) return json({ error: 'Couldn’t find that call in Fathom' }, 404);
      return json({ kind: 'call', calls: [shape({ recording_id: link.id, url: String(body.url) }, transcript)] });
    }
    if (!found) return json({ error: 'Couldn’t find that shared call. It may be older than the calls scanned, or not visible to the Fathom key; paste its fathom.video/calls/… link instead.' }, 404);
    return json({ kind: 'call', calls: [shape(found, await transcriptFor(found))] });
  } catch (e) {
    const err = e as Error & { status?: number };
    return json({ error: err.message || 'Fathom request failed' }, err.status || 502);
  }
});
