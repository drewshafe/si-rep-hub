// anthropic-token — Supabase Edge Function (project oiljklutlmtztascnkpm)
//
// Trades a signed-in rep's Supabase access token for a short-lived Claude API token through
// Anthropic Workload Identity Federation. Anthropic verifies the JWT itself against federation
// rule rep-hub-reps (issuer = this project's Auth, aud = authenticated, an @shipinsure.io email),
// so no Anthropic key lives here or in any browser. The function exists only because
// /v1/oauth/token can't be called from a web page (no CORS); /v1/messages can, so the tools
// call Claude directly with the token this returns.
//
// Deploy: supabase functions deploy anthropic-token --project-ref oiljklutlmtztascnkpm --no-verify-jwt
// (--no-verify-jwt: the gateway can't check this project's ES256 tokens; Anthropic checks them.)

const FEDERATION = {
  federation_rule_id: 'fdrl_01EmnLu4aus7pG8RwCE9HMoi',
  organization_id: '1a80bdca-acb8-42bf-acbc-2a17ff4efe45',
  service_account_id: 'svac_01NjoThaaseVnDqtPoALUwr9',
  workspace_id: 'wrkspc_01URiP4WcbwE1y2C8AWqGPcv',
};

// Pages allowed to ask for a token (the tools on GitHub Pages + local previews).
const ORIGINS = [/^https:\/\/drewshafe\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ORIGINS.some((re) => re.test(origin));
  return {
    'access-control-allow-origin': ok ? origin! : 'https://drewshafe.github.io',
    'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
  };
}

// The parts of a login token the federation rule checks (no signature, no full email).
function peek(jwt: string) {
  try {
    const part = (x: string) => JSON.parse(atob(x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (x.length % 4)) % 4)));
    const [h, p] = jwt.split('.').slice(0, 2).map(part);
    return { alg: h.alg, kid: h.kid || null, iss: p.iss, aud: p.aud, role: p.role, email_domain: String(p.email || '').split('@')[1] || null,
      lifetime_s: p.exp - p.iat, expires_in_s: p.exp - Math.floor(Date.now() / 1000), has_jti: 'jti' in p, has_sub: !!p.sub };
  } catch (_) { return null; }
}
function hint(t: ReturnType<typeof peek>) {
  if (!t) return 'The login token could not be read.';
  if (/^HS/.test(t.alg)) return 'Supabase signed this login with the legacy shared secret (' + t.alg + '). Anthropic only accepts ES256/RS256: in Supabase → Project Settings → JWT Keys, rotate to the ES256 key, then sign out and back in.';
  if (!t.kid) return 'The login token has no key id (kid).';
  if (t.iss !== 'https://oiljklutlmtztascnkpm.supabase.co/auth/v1') return 'Token issuer is ' + t.iss + ', not the registered issuer URL.';
  if (t.lifetime_s > 3600) return 'Login tokens last ' + t.lifetime_s + 's; the issuer accepts at most 1 hour. Raise the issuer\'s maximum token lifetime in the Console.';
  if (t.expires_in_s < -30) return 'The login token had expired; sign out and back in.';
  return 'Token looks right (alg ' + t.alg + ', aud ' + JSON.stringify(t.aud) + ', role ' + t.role + ', @' + t.email_domain + '), so the federation rule is refusing it: check its audience, subject and condition, and the Console\'s authentication history.';
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('origin'));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...h, 'content-type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt || jwt.split('.').length !== 3) return json({ error: 'Sign in to the Rep Hub first' }, 401);

  const r = await fetch('https://api.anthropic.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt, ...FEDERATION }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Anthropic keeps denials opaque ("Authentication failed"; the reason is in the Console's
    // Workload identity → authentication history), so name what in this token could fail the rule.
    const t = peek(jwt);
    return json({ error: (j && j.error && j.error.message) || 'Token exchange failed', status: r.status, token: t, hint: hint(t) }, r.status === 401 ? 401 : 502);
  }
  return json({ access_token: j.access_token, expires_in: j.expires_in, scope: j.scope });
});
