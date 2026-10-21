// Cards on the map fold away to the map's edges, so the terrain can be seen whole.
// The month badge and weather card fold together into a pull tab on the right edge; the legend folds into one on the left.
// Phones: only the right panel exists (no legend), it starts folded, and it also swipes; the tab previews the live
// temperature, plus the town when it isn't Baguio City. Larger screens: both panels start open and remember being folded.
// The open/closed state is a class: `open` on phones (folded by default), `tucked` on larger screens (open by default),
// so the cards sit in the right place on first paint before this module runs.
const PHONE = matchMedia('(max-width: 640px)');
const DEFAULT_TOWN = 'Baguio City';
const vp = document.getElementById('vp');
const panel = document.getElementById('ovPanel'), tab = document.getElementById('ovTab'), sum = document.getElementById('ovSum');
const card = document.getElementById('wxcard'), badge = document.getElementById('mbadge');
const keep = {
  get(k) { try { return localStorage.getItem('bantay.' + k) === '1'; } catch (e) { return false; } },
  set(k, v) { try { localStorage.setItem('bantay.' + k, v ? '1' : '0'); } catch (e) { /* private mode */ } },
};
// put a remembered fold in place without the slide, so a returning visitor doesn't watch the cards leave on every load
function instantly(fn) {
  vp?.classList.add('ov-instant'); fn();
  requestAnimationFrame(() => requestAnimationFrame(() => vp?.classList.remove('ov-instant')));
}

if (panel && tab && sum && card && badge) {
  const isOpen = () => (PHONE.matches ? panel.classList.contains('open') : !panel.classList.contains('tucked'));
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // what the tab shows: the live temperature from the weather card, or the month when there is no weather to show.
  // It only rebuilds when that changes, so a redraw elsewhere never swaps the icon out from under a finger mid-tap.
  let shown = '';
  function paint() {
    const t = !card.hidden && card.querySelector('.wxc-temp b');
    let key, build, say, k = '';
    if (t) {
      const temp = t.textContent.trim(), cond = card.querySelector('.wxc-temp span')?.textContent.trim() || '';
      const town = card.querySelector('.wxc-place b')?.textContent.trim() || DEFAULT_TOWN, svg = card.querySelector('.wxc-ico svg');
      k = card.dataset.k || '';
      key = ['wx', temp, town, svg ? svg.getAttribute('class') : '', k].join('|');
      say = [temp, cond, town].filter(Boolean).join(', ');
      build = () => {
        const parts = [];
        if (svg) { const g = svg.cloneNode(true); g.classList.add('static'); parts.push(g); }
        parts.push(el('b', '', temp));
        if (town !== DEFAULT_TOWN) parts.push(el('span', 'ot-town', town));
        return parts;
      };
    } else {
      const m = badge.querySelector('.mbadge-h b')?.textContent.trim() || '';
      key = 'm|' + m; say = m;
      build = () => [el('span', 'ot-month', m.split(/\s+/)[0] || 'Details')];
    }
    if (key !== shown) { shown = key; sum.replaceChildren(...build()); tab.dataset.k = k; }
    tab.setAttribute('aria-label', isOpen() ? 'Hide the month and weather' : 'Show the month and weather' + (say ? ` (${say})` : ''));
  }

  function setOpen(on, save) {
    if (PHONE.matches) panel.classList.toggle('open', on);
    else { panel.classList.toggle('tucked', !on); if (save) keep.set('tuckR', !on); }
    panel.parentElement.classList.toggle('ov-open', on && PHONE.matches); // phones fade the compass, which the open tab would crowd
    tab.setAttribute('aria-expanded', String(on));
    paint();
  }

  // a swipe that ends on the tab is followed by a click; this swallows that click so the panel doesn't flip back
  let swiped = false, swipeT = 0;
  tab.addEventListener('click', () => { if (swiped) { swiped = false; return; } setOpen(!isOpen(), true); });

  // swipe left on the tab to open, swipe right on the panel to close. Gestures on the hourly chart are left alone,
  // since dragging a finger across it reads the hours.
  let pid = null, sx = 0, sy = 0, t0 = 0;
  panel.addEventListener('pointerdown', e => {
    swiped = false;
    if (!PHONE.matches || e.pointerType === 'mouse' || e.target.closest('.wxc-spark')) return;
    pid = e.pointerId; sx = e.clientX; sy = e.clientY; t0 = e.timeStamp;
  });
  panel.addEventListener('pointerup', e => {
    if (e.pointerId !== pid) return;
    pid = null;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (e.timeStamp - t0 > 700 || Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if ((dx > 0) !== isOpen()) return; // right closes an open panel, left opens a closed one
    if (tab.contains(e.target)) { swiped = true; clearTimeout(swipeT); swipeT = setTimeout(() => { swiped = false; }, 450); }
    setOpen(dx < 0);
  });
  panel.addEventListener('pointercancel', () => { pid = null; });

  // Escape tucks it away on a phone, unless a drawer is open (Escape belongs to the drawer then)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !isOpen() || !PHONE.matches || document.querySelector('.drawer:not([hidden])')) return;
    setOpen(false);
    tab.focus();
  });

  // crossing the breakpoint (rotating a tablet, resizing a window): phones start folded, larger screens go back to
  // whatever was chosen there
  const place = () => instantly(() => {
    panel.classList.remove(PHONE.matches ? 'tucked' : 'open');
    setOpen(PHONE.matches ? false : !keep.get('tuckR'));
  });
  PHONE.addEventListener('change', place);

  // the card and badge are re-rendered by weather.js and app.js; follow them
  const mo = new MutationObserver(paint);
  mo.observe(card, { childList: true, attributes: true, attributeFilter: ['hidden', 'data-k'] });
  mo.observe(badge, { childList: true });
  place();
}

// the legend: a tab on its right edge folds it off the left of the map (larger screens; phones have no legend)
const legPanel = document.querySelector('.ov-bl'), legend = document.getElementById('legend');
if (legPanel && legend) {
  legPanel.insertAdjacentHTML('beforeend', '<button class="lg-tab" id="legTab" type="button" aria-controls="legend"><svg class="ot-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg><span class="lg-lbl"><span>Legend</span></span></button>');
  const lt = document.getElementById('legTab');
  const setLeg = (tucked, save) => {
    legPanel.classList.toggle('tucked', tucked);
    lt.setAttribute('aria-expanded', String(!tucked));
    lt.setAttribute('aria-label', tucked ? 'Show the legend' : 'Hide the legend');
    if (save) keep.set('tuckL', tucked);
  };
  lt.addEventListener('click', () => setLeg(!legPanel.classList.contains('tucked'), true));
  instantly(() => setLeg(keep.get('tuckL'), false));
}
