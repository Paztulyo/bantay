// The Ask tab in Be ready: shown only when /api/ask is ready, questions and answers, hotline cards from guide.json,
// errors, the language switch, and the phone layout. /api/ask is faked here; ask_api.js checks the endpoint itself.
// Takes w=, h=, dark, rm (reduced motion).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const THREE_DIR = path.join(__dirname, 'node_modules/three');
const { BASE, OUT, LAUNCH } = require('./env');
const args = Object.fromEntries(process.argv.slice(2).map(a => [a.split('=')[0], a.split('=')[1] ?? '1']));
const W = +(args.w || 1440), H = +(args.h || 900), dark = !!args.dark, rm = !!args.rm;
const G = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'guide.json'), 'utf8'));
const tel = v => { const d = String(v).split(' to ')[0].replace(/\D/g, ''); return d.length <= 4 ? 'tel:' + d : 'tel:+63' + d.replace(/^0/, ''); };

(async () => {
  const browser = await chromium.launch({ ...LAUNCH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const mobile = W < 768, tag = `${W}${dark ? '_dark' : ''}${rm ? '_rm' : ''}`;
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };
  const open = async ({ ready = true, lang } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: rm ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) logs.push(`[console] ${m.text()}`); });
    page.on('pageerror', e => { logs.push(`[pageerror] ${e.message}`); fails.push('page error: ' + e.message); });
    await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, r.request().url().split('three@0.147.0/')[1])) }));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('https://fonts.gstatic.com/**', r => r.abort());
    const posts = [];
    page.posts = posts; page.next = null; // page.next: what the next POST answers ({json} or 'abort')
    await page.route('**/api/ask', async r => {
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ready }) });
      const body = JSON.parse(r.request().postData() || '{}');
      posts.push(body);
      const n = page.next || { json: { ok: true, answer: `Answer to: ${body.q}`, hotlines: [], emergency: false } };
      page.next = null;
      if (n.delay) await new Promise(res => setTimeout(res, n.delay));
      if (n === 'abort' || n.abort) return r.abort('failed');
      return r.fulfill({ status: n.status || 200, contentType: 'application/json', body: JSON.stringify(n.json) });
    });
    await page.goto(BASE + '/?test=1' + (lang ? '&lang=' + lang : ''), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#gpanA') && document.querySelector('#gpanH .hl'), null, { timeout: 120000 });
    return page;
  };
  const st = page => page.evaluate(() => {
    const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    const a = document.querySelector('#gpanA');
    return {
      ready: document.documentElement.classList.contains('ask-ready'),
      tabA: vis(document.querySelector('#gtabA')), cta: [...document.querySelectorAll('.ask-cta')].some(vis),
      open: !document.querySelector('#guide').hidden, onAsk: document.querySelector('#gtabA').getAttribute('aria-selected') === 'true',
      panA: !a.hidden, search: vis(document.querySelector('.gsearch')),
      sugg: [...a.querySelectorAll('#askSugg button')].filter(vis).map(b => b.textContent),
      turns: [...a.querySelectorAll('.ask-turn')].map(tn => ({
        q: tn.querySelector('.ask-q').textContent.replace(/^\S+ asked: |^[^:]+: /, ''),
        a: tn.querySelector('.ask-text')?.textContent || '', wait: !!tn.querySelector('.ask-wait'), err: tn.querySelector('.ask-a.err p')?.textContent || '',
        retry: !!tn.querySelector('.ask-retry'), sos: !!tn.querySelector('.ask-sos'),
        hot: [...tn.querySelectorAll('.ask-hot li')].map(li => ({ name: li.querySelector('.hname b').textContent, area: li.querySelector('.harea')?.textContent || '', tels: [...li.querySelectorAll('a.hnum')].map(x => x.getAttribute('href')) })),
      })),
      draft: a.querySelector('#askQ')?.value, left: a.querySelector('#askLeft')?.textContent, newBtn: vis(a.querySelector('#askNew')),
      focus: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
      overflow: document.querySelector('#guide .drawer-c').scrollWidth - document.querySelector('#guide .drawer-c').clientWidth,
    };
  });
  const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 }).then(() => true).catch(() => false);
  const shot = async (page, name) => {
    const dc = await page.$('#guide .drawer-c'); const b = dc && await dc.boundingBox();
    try { await page.screenshot({ path: OUT + name + '_' + tag + '.png', clip: b ? { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, H - b.y) } : undefined, timeout: 60000 }); } catch (e) { logs.push('shot failed ' + name + ': ' + e.message.split('\n')[0]); }
  };

  // ---- not ready: nothing shows, and asking for the tab lands on Hotlines
  let page = await open({ ready: false });
  await page.waitForTimeout(800);
  let s = await st(page);
  ok(!s.ready && !s.tabA && !s.cta, 'not ready: no Ask tab and no Ask button');
  await page.evaluate(() => document.querySelector('[data-guide="ask"]')?.click());
  await page.waitForTimeout(300);
  s = await st(page);
  ok(!s.open || !s.onAsk, 'not ready: the hidden button cannot open Ask');
  await page.context().close();

  // ---- ready
  page = await open();
  ok(await until(page, () => document.documentElement.classList.contains('ask-ready')), 'ready: the page learns Ask is on');
  s = await st(page);
  ok(s.cta, 'the What to do card shows "Ask a question"');
  await page.click('.ask-cta >> visible=true');
  await page.waitForTimeout(400);
  s = await st(page);
  ok(s.open && s.onAsk && s.panA && s.tabA, 'the button opens Be ready on the Ask tab');
  ok(!s.search, 'the search box steps aside on Ask');
  ok(s.sugg.length === 4, `four suggestions show (${s.sugg.length})`);
  ok(mobile ? s.focus === 'guideClose' : s.focus === 'askQ', `focus: ${s.focus} (box on desktop, Close on phones)`);
  ok(s.overflow <= 0, `no sideways scroll in the drawer (${s.overflow})`);
  await shot(page, 'ask_empty');

  // a suggestion, with a slow answer: dots, then the answer with hotline cards
  page.next = { delay: 700, json: { ok: true, answer: 'PAGASA’s 21 October outlook puts Benguet in drought by the end of December 2026.', hotlines: ['h6', 'h3', 'zz1'], emergency: false } };
  await page.click('#askSugg button >> nth=0');
  await page.waitForTimeout(150);
  s = await st(page);
  ok(s.turns.length === 1 && s.turns[0].wait, 'while waiting, the turn shows the dots');
  if (rm) ok(await page.evaluate(() => getComputedStyle(document.querySelector('.ask-dots i')).animationName === 'none'), 'reduced motion: the dots hold still');
  ok(await until(page, () => document.querySelector('.ask-text')), 'the answer arrives');
  s = await st(page);
  const sent = page.posts[0] || {};
  ok(sent.q === 'When will Benguet be in drought?' && sent.lang === 'en' && Array.isArray(sent.hist) && sent.hist.length === 0, `request: ${JSON.stringify(sent)}`);
  const t0 = s.turns[0] || { hot: [] };
  ok(/drought by the end of December 2026/.test(t0.a), 'the answer text shows');
  const pdrrmo = G.hotlines[2].items[0], fire = G.hotlines[1].items[1];
  ok(t0.hot.length === 2 && t0.hot[0].name === pdrrmo.n && t0.hot[1].name === fire.n, `hotline cards in the AI's order, unknown ids skipped (${t0.hot.map(h => h.name)})`);
  ok(t0.hot[0] && JSON.stringify(t0.hot[0].tels) === JSON.stringify(pdrrmo.nums.map(n => tel(n.v))), 'card numbers are guide.json’s tap-to-call links');
  ok(t0.hot[1] && t0.hot[1].area === 'La Trinidad', `cards name the area (${t0.hot[1] && t0.hot[1].area})`);
  ok(s.sugg.length === 0 && s.newBtn, 'after the first answer: suggestions hide, Start over shows');
  await shot(page, 'ask_answer');

  // typed question, Enter sends, history goes along; newest first
  page.next = { json: { ok: true, answer: 'There is smoke near you? Call 911 now.', hotlines: ['e0', 'h3'], emergency: true } };
  await page.click('#askQ');
  await page.keyboard.type('May usok sa likod ng bahay namin');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('sa La Trinidad');
  s = await st(page);
  ok(s.draft === 'May usok sa likod ng bahay namin\nsa La Trinidad', 'Shift+Enter starts a new line');
  await page.keyboard.press('Enter');
  ok(await until(page, () => document.querySelectorAll('.ask-text').length === 2), 'Enter sends');
  s = await st(page);
  const sent2 = page.posts[1] || {};
  ok(sent2.hist && sent2.hist.length === 1 && sent2.hist[0].q === 'When will Benguet be in drought?' && /drought/.test(sent2.hist[0].a), 'the earlier turn goes along as history');
  ok(s.turns[0].q.startsWith('May usok') && s.turns[1].q.startsWith('When will'), 'newest turn on top');
  ok(s.turns[0].sos && !s.turns[0].hot.some(h => h.tels.includes('tel:911')) && s.turns[0].hot.length === 1, 'emergency: a 911 card on top, not repeated in the list');
  ok(s.draft === '', 'the box clears after sending');
  await shot(page, 'ask_emergency');

  // errors
  page.next = { json: { ok: false, reason: 'limit' }, status: 429 };
  await page.fill('#askQ', 'Another question'); await page.keyboard.press('Enter');
  ok(await until(page, () => document.querySelector('.ask-turn .ask-a.err')), 'a refusal shows as a message');
  s = await st(page);
  ok(/lot of questions/.test(s.turns[0].err) && !s.turns[0].retry, 'limit: says to wait, no retry button');
  page.next = 'abort';
  await page.fill('#askQ', 'Will it rain?'); await page.keyboard.press('Enter');
  ok(await until(page, () => document.querySelectorAll('.ask-a.err').length === 2), 'a failed request shows as a message');
  s = await st(page);
  ok(/No answer came back|offline/.test(s.turns[0].err) && s.turns[0].retry, 'network failure: a Try again button');
  await page.click('.ask-retry');
  ok(await until(page, () => document.querySelector('.ask-turn .ask-text')?.textContent === 'Answer to: Will it rain?'), 'Try again asks the same question again');
  s = await st(page);
  ok(s.turns.length === 4 && page.posts.at(-1).q === 'Will it rain?', `the failed turn is replaced (${s.turns.length} turns)`);

  // the 400-character limit
  await page.fill('#askQ', 'x'.repeat(390));
  await page.dispatchEvent('#askQ', 'input');
  s = await st(page);
  ok(/10 characters left/.test(s.left), `near the limit, a counter shows (${s.left})`);
  await page.fill('#askQ', 'y'.repeat(450));
  s = await st(page);
  ok(s.draft.length === 400, `the box stops at 400 characters (${s.draft.length})`);
  await page.fill('#askQ', '');

  // arrows move across the three tabs
  await page.focus('#gtabA'); await page.keyboard.press('ArrowRight');
  s = await st(page);
  ok(s.focus === 'gtabH' && !s.onAsk && s.search, 'ArrowRight from Ask wraps to Hotlines, and the search comes back');
  await page.keyboard.press('ArrowLeft');
  s = await st(page);
  ok(s.focus === 'gtabA' && s.onAsk && s.turns.length === 4, 'ArrowLeft returns to Ask with the conversation kept');

  // Tagalog: the frame changes, the conversation stays, questions go with lang=tl
  await page.evaluate(() => document.querySelector('#guideClose').click());
  await page.waitForTimeout(600);
  await page.click('.lang [data-lang="tl"]');
  ok(await until(page, () => document.documentElement.lang === 'tl'), 'switched to Tagalog');
  await page.evaluate(() => document.querySelector('[data-guide="ask"]').click());
  await page.waitForTimeout(400);
  s = await st(page);
  ok(await page.evaluate(() => document.querySelector('#gtabA').textContent === 'Magtanong' && document.querySelector('.ask-intro').textContent.startsWith('Magtanong sa English, Tagalog o Ilocano')), 'the tab and the intro are in Tagalog');
  ok(s.turns.length === 4, 'the conversation survives the switch');
  await page.click('#askNew');
  s = await st(page);
  ok(s.turns.length === 0 && s.sugg.length === 4 && s.sugg[0] === 'Kailan papasok sa drought ang Benguet?', `Start over: suggestions back, in Tagalog (${s.sugg[0]})`);
  await page.click('#askSugg button >> nth=2');
  ok(await until(page, () => document.querySelector('.ask-text')), 'a Tagalog suggestion gets an answer');
  const sent3 = page.posts.at(-1);
  ok(sent3.lang === 'tl' && sent3.q === 'Paano ako makakatipid ng tubig sa bahay?', `sent in Tagalog with lang=tl (${sent3.q})`);
  s = await st(page);
  ok(s.overflow <= 0, `no sideways scroll in Tagalog (${s.overflow})`);
  await shot(page, 'ask_tl');
  await page.context().close();

  console.log(logs.join('\n'));
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('1 FAILED'); process.exit(1); });
