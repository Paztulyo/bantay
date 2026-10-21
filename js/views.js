// The visitor count in the header. A browser counts once, on its first visit; later loads only add page views
// (api/views.js keeps the numbers). The chip stays hidden until the count store is connected and answering.
const FLAG = 'bantay:counted';
const MIN_SHOW = 0; // raise to keep the chip hidden until the count passes it

async function run() {
  const chip = document.getElementById('visChip');
  if (!chip) return;
  let first = false;
  try { first = localStorage.getItem(FLAG) !== '1'; } catch { /* storage blocked: never count, so it can't inflate */ }
  const auto = navigator.webdriver; // automated browsers (tests, scrapers) read the count but never add to it
  let d;
  try {
    const r = await fetch('/api/views' + (first && !auto ? '?first=1' : ''), { method: auto ? 'GET' : 'POST', cache: 'no-store' });
    if (!r.ok) return;
    d = await r.json();
  } catch { return; }
  if (!d || d.status !== 'ok') return;
  if (first && d.counted) try { localStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
  if (d.visitors < Math.max(1, MIN_SHOW)) return;
  chip.querySelector('b').textContent = new Intl.NumberFormat('en-PH').format(d.visitors);
  chip.querySelector('span').textContent = d.visitors === 1 ? 'visitor' : 'visitors';
  chip.hidden = false;
  chip.parentElement.classList.add('has-vis'); // lets the header make room for it (css/brief.css)
  // say how it counts, once, in Sources
  const body = document.querySelector('#drawer #srcBody');
  if (body && !document.getElementById('visNote')) {
    body.insertAdjacentHTML('afterend', '<p class="src" id="visNote">Visitors are counted once per browser, from when the counter started. Reloads and bots don’t add to it, and no personal data is kept.</p>');
  }
}
run();
