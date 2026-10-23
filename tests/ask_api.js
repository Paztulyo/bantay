// The Ask endpoint (api/ask.js) on its own, no browser or server: every outside call is faked, so this checks what it
// sends to the AI Gateway, what it gives back, and what it refuses. Run: node ask_api.js
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT); // the endpoint reads data/*.json from the working directory, as on Vercel

const logs = [], fails = [];
const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };

// fake outside world
let gateway = null, calls = [];
const OM = n => Array.from({ length: n }, (_, i) => ({ current: { temperature_2m: 18 + i, apparent_temperature: 17 + i, weather_code: 2 }, daily: { time: ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'], weather_code: [2, 61, 3, 0], temperature_2m_max: [22, 21, 22, 23], temperature_2m_min: [15, 15, 14, 14], precipitation_sum: [0, 6.2, 0.4, 0], precipitation_probability_max: [20, 70, 35, 5] } }));
global.fetch = async (url, opts = {}) => {
  url = String(url); calls.push({ url, opts });
  const res = (status, body, text) => ({ ok: status < 400, status, json: async () => body, text: async () => text ?? JSON.stringify(body) });
  if (url.startsWith('https://ai-gateway.vercel.sh/')) {
    if (gateway instanceof Error) throw gateway;
    return res(gateway.status, gateway.body);
  }
  if (url.startsWith('https://api.open-meteo.com/')) return res(200, OM(new URL(url).searchParams.get('latitude').split(',').length));
  if (url.startsWith('https://www.pagasa.dost.gov.ph/flood')) return res(500, {}, 'down');
  if (url.startsWith('https://firms.modaps.eosdis.nasa.gov/')) return res(200, null, 'latitude,longitude,acq_date,acq_time,confidence,frp,daynight\n16.32,120.70,2026-10-22,0542,n,3.1,D\n');
  return res(404, {});
};
const answer = (input, extra = {}) => ({ status: 200, body: { content: [{ type: 'tool_use', name: 'reply', input }], usage: { input_tokens: 900, cache_read_input_tokens: 5000, output_tokens: 80 }, stop_reason: 'tool_use', ...extra } });

function call(handler, { method = 'POST', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = { method, body, headers: { origin: 'https://www.bantayelnino.com', 'user-agent': 'Mozilla/5.0 (iPhone)', 'x-real-ip': '203.0.113.' + (headers.ip || 7), ...headers } };
    const out = { headers: {} };
    const res = {
      setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; },
      status(c) { out.status = c; return this; },
      send(b) { out.body = JSON.parse(b); resolve(out); },
    };
    handler(req, res);
  });
}

(async () => {
  const captured = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => captured.push(a.join(' ')); console.error = (...a) => captured.push(a.join(' '));
  let mod;
  try { mod = await import(path.join(ROOT, 'api/ask.js')); } finally { console.log = orig.log; console.error = orig.error; }
  const handler = mod.default;
  const quiet = async fn => { console.log = (...a) => captured.push(a.join(' ')); console.error = (...a) => captured.push(a.join(' ')); try { return await fn(); } finally { console.log = orig.log; console.error = orig.error; } };

  // readiness
  delete process.env.AI_GATEWAY_API_KEY; delete process.env.VERCEL_OIDC_TOKEN; delete process.env.ASK_OFF;
  let r = await call(handler, { method: 'GET' });
  ok(r.body.ready === false, 'GET: not ready without a key or an OIDC token');
  r = await call(handler, { method: 'GET', headers: { 'x-vercel-oidc-token': 'oidc-test' } });
  ok(r.body.ready === true && /s-maxage/.test(r.headers['cache-control']), 'GET: ready with the OIDC header, cached at the edge');
  process.env.ASK_OFF = '1';
  r = await call(handler, { method: 'GET', headers: { 'x-vercel-oidc-token': 'oidc-test' } });
  ok(r.body.ready === false, 'GET: ASK_OFF=1 turns it off');
  r = await call(handler, { body: { q: 'hi' }, headers: { 'x-vercel-oidc-token': 'oidc-test' } });
  ok(r.body.ok === false && r.body.reason === 'unavailable', 'POST while off: unavailable');
  delete process.env.ASK_OFF;
  process.env.AI_GATEWAY_API_KEY = 'gw-test-key';

  // refusals
  r = await call(handler, { body: { q: 'hi' }, headers: { origin: 'https://evil.example' } });
  ok(r.status === 403, 'POST from another site: 403');
  r = await call(handler, { body: { q: 'hi' }, headers: { origin: '' } });
  ok(r.status === 403, 'POST with no Origin: 403');
  r = await call(handler, { body: { q: 'hi' }, headers: { 'user-agent': 'python-requests/2.31' } });
  ok(r.status === 403, 'POST from a script: 403');
  r = await call(handler, { body: { q: '   ' } });
  ok(r.status === 400 && r.body.reason === 'empty', 'empty question: 400 empty');
  r = await call(handler, { body: { q: 'x'.repeat(401) } });
  ok(r.status === 400 && r.body.reason === 'long', '401 characters: 400 long');
  r = await call(handler, { method: 'DELETE' });
  ok(r.status === 405, 'other methods: 405');
  ok(!calls.some(c => c.url.includes('ai-gateway')), 'none of the refusals reached the AI Gateway');

  // a good question
  calls = [];
  gateway = answer({ answer: 'PAGASA’s 21 October outlook puts Benguet in drought by the end of December 2026 — call (074) 442-1234 or 0917 123 4567.', hotlines: ['h3', 'zz9', 'e0', 'h3', 'h6', 'h7'], emergency: false });
  const Q = 'When will Benguet be in drought? My number is 0918 000 0000';
  r = await quiet(() => call(handler, { body: { q: Q, lang: 'tl', hist: [{ q: 'Hello', a: 'Hi there.' }, { q: '', a: 'dropped' }] } }));
  const gw = calls.find(c => c.url.includes('ai-gateway'));
  const P = gw && JSON.parse(gw.opts.body);
  ok(r.status === 200 && r.body.ok === true, 'a question gets an answer');
  ok(gw && gw.opts.headers.Authorization === 'Bearer gw-test-key' && gw.opts.headers['anthropic-version'], 'the gateway call carries the key and the API version');
  ok(P && P.model === 'anthropic/claude-haiku-5.5' && P.tool_choice?.name === 'reply' && P.tools?.[0]?.name === 'reply', 'Haiku 5.5 with the reply tool forced');
  ok(P && P.system.length === 3 && P.system[1].cache_control?.type === 'ephemeral' && /^DATA\n/.test(P.system[1].text), 'the site data is the cached system block');
  ok(P && /HOTLINES/.test(P.system[1].text) && !/\d{3}-\d{4}|09\d\d \d{3}/.test(P.system[1].text), 'the data names hotlines but holds no phone numbers');
  ok(P && /^LIVE\n/.test(P.system[2].text) && /TODAY: /.test(P.system[2].text) && /WEATHER \(Open-Meteo/.test(P.system[2].text) && /Baguio City: now/.test(P.system[2].text), 'the live block has today and Baguio’s weather');
  ok(P && !/AGNO DAM LEVELS|FIRE DETECTIONS/.test(P.system[2].text), 'no dam or fire lookups for a question about neither');
  ok(P && P.messages.length === 3 && P.messages[0].content === 'Hello' && P.messages[1].role === 'assistant' && /\[page language: tl\]\nWhen will Benguet/.test(P.messages[2].content), 'history goes first, then the question with the page language');
  ok(!/\d{3}[\s-]\d{4}/.test(r.body.answer) && /\(see below\)/.test(r.body.answer), `phone numbers are taken out of the answer: ${r.body.answer}`);
  ok(!/—/.test(r.body.answer), 'em dashes are taken out');
  ok(JSON.stringify(r.body.hotlines) === '["h3","e0","h6"]', `hotlines: unknown ids dropped, duplicates merged, three at most (${r.body.hotlines})`);
  ok(!captured.some(l => l.includes('When will Benguet') || l.includes('0918')), 'the logs never hold the question');
  ok(captured.some(l => /^\[ask\] tl \d+ms in=900 cached=5000/.test(l)), 'the log line has the language, time and token counts');

  // live lookups a question asks for
  calls = [];
  gateway = answer({ answer: 'Ambuklao is below its normal high water level.', hotlines: [], emergency: false });
  r = await quiet(() => call(handler, { body: { q: 'How full is Ambuklao dam? Any fire near Itogon or in La Trinidad?' } }));
  let live = JSON.parse(calls.find(c => c.url.includes('ai-gateway')).opts.body).system[2].text;
  ok(/AGNO DAM LEVELS \(PAGASA's live table didn't answer; last saved reading/.test(live), 'a dam question gets the dam levels, from the saved reading when PAGASA is down');
  ok(/FIRE DETECTIONS: not available/.test(live), 'a fire question without the FIRMS key says detections are unavailable');
  ok(/- Itogon: now/.test(live) && /- La Trinidad: now/.test(live), 'towns the question names get their own forecast');
  process.env.FIRMS_MAP_KEY = 'firms-test';
  calls = [];
  r = await quiet(() => call(handler, { body: { q: 'May sunog ba ngayon?' } }));
  live = JSON.parse(calls.find(c => c.url.includes('ai-gateway')).opts.body).system[2].text;
  ok(/FIRE DETECTIONS \(NASA FIRMS satellites[^)]*\): in Benguet and Baguio: Itogon \d+ \(latest 22 Oct 13:42\)/.test(live), 'with the key, detections are counted by town in Manila time');
  ok(!calls.some(c => c.url.includes('firms') && !c.url.includes('firms-test')) && !live.includes('firms-test'), 'the FIRMS key stays out of the prompt');

  // emergencies and odd replies
  gateway = answer({ answer: 'Call 911 now.', hotlines: ['e0', 'h3'], emergency: true });
  r = await quiet(() => call(handler, { body: { q: 'There is smoke behind our house in La Trinidad' } }));
  ok(r.body.ok && r.body.emergency === true, 'emergency flag comes through');
  gateway = { status: 200, body: { content: [{ type: 'text', text: 'Plain text answer.' }], usage: {} } };
  r = await quiet(() => call(handler, { body: { q: 'water tips?' } }));
  ok(r.body.ok && r.body.answer === 'Plain text answer.' && r.body.hotlines.length === 0, 'a text-only reply still works');
  gateway = { status: 200, body: { content: [{ type: 'tool_use', name: 'reply', input: { answer: '', hotlines: [] } }] } };
  r = await quiet(() => call(handler, { body: { q: 'water tips?' } }));
  ok(!r.body.ok && r.body.reason === 'busy', 'an empty answer counts as busy');

  // gateway trouble
  for (const [status, reason] of [[402, 'unavailable'], [401, 'unavailable'], [400, 'unavailable'], [429, 'busy'], [503, 'busy']]) {
    gateway = { status, body: { error: { type: 'x', message: 'nope' } } };
    r = await quiet(() => call(handler, { body: { q: 'water tips?' }, headers: { ip: 50 + status % 40 } }));
    ok(!r.body.ok && r.body.reason === reason, `gateway ${status}: ${reason}`);
  }
  gateway = new Error('socket hang up');
  r = await quiet(() => call(handler, { body: { q: 'water tips?' }, headers: { ip: 99 } }));
  ok(!r.body.ok && r.body.reason === 'busy', 'gateway unreachable: busy');

  // rate limit: 12 in ten minutes per connection
  gateway = answer({ answer: 'Fine.', hotlines: [], emergency: false });
  let last;
  for (let i = 0; i < 13; i++) last = await quiet(() => call(handler, { body: { q: 'water tips?' }, headers: { ip: 200 } }));
  ok(last.status === 429 && last.body.reason === 'limit', 'the 13th question in ten minutes from one connection: 429 limit');
  r = await quiet(() => call(handler, { body: { q: 'water tips?' }, headers: { ip: 201 } }));
  ok(r.body.ok, 'another connection still gets answers');

  console.log(logs.join('\n'));
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('1 FAILED'); process.exit(1); });
