// The desktop header keeps to one row with the advisory status line whole. The context chips give way first: the
// CSS breakpoints (css/extra.css, css/brief.css) fit today's text, and this hides more chips, least useful first,
// whenever the status line would still be cut short: a longer advisory next month, or a wordier language. On the
// narrowest desktops the Simple/Detailed switch needs room too: then the tagline goes, and last the name beside the logo.
const top = document.querySelector('.top'), status = document.getElementById('status');
const DESK = matchMedia('(min-width:1101px)');
const ORDER = ['#spanChip', '.ctx .chip.opt', '.ctx', '.brand-t span', '.brand-t'];
const ORDER_VIS = ['#spanChip', '.ctx .chip.opt', '.ctx .chip:not(.vis)', '.ctx', '.brand-t span', '.brand-t'];
const cut = () => status.scrollWidth > status.clientWidth + 1;

const watch = new MutationObserver(fit);
function fit() {
  for (const el of top.querySelectorAll('.fit-hide')) el.classList.remove('fit-hide');
  if (DESK.matches) for (const sel of top.querySelector('.ctx.has-vis') ? ORDER_VIS : ORDER) {
    if (!cut()) break;
    for (const el of top.querySelectorAll(sel)) el.classList.add('fit-hide');
  }
  watch.takeRecords(); // our own class changes are not news
}

if (top && status) {
  // new text in the status line or the chips (a fresh advisory, a translation, the visitor count), and the width
  watch.observe(top, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  new ResizeObserver(fit).observe(top);
  document.fonts?.addEventListener?.('loadingdone', fit);
  document.addEventListener('bantay:view', fit); // Simple and Detailed show different things in the header
  fit();
}
