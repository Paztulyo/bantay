// Runs every browser test, one after another, against the test server (start it first: npm run serve).
// Pass test names to run only those: node run-all.js burn_test tip_test
const { spawnSync } = require('child_process');
const path = require('path');
const { BASE } = require('./env');
const SUITE = [
  ['burn_test.js'], // the close effect: drawers burn away
  ['ready_test.js'], // Be ready search, red Close buttons
  ['ready_test.js', 'w=390', 'h=844'],
  ['fday_test.js'], // forecast days and Play the week
  ['tuck_test.js'], // folding the map cards on larger screens
  ['panel_test.js'], // the pull tab on phones
  ['tip_test.js'], // the map's hover label on touch
  ['views_ui.js'], // the visitor count chip
  ['lang_test.js'], // English, Tagalog, Ilocano: the switch, the drawer, the phone header
  ['header_test.js'], // the header at every width in each language, with the real fonts
  ['header_test.js', 'vis'], // the same with the visitor chip showing
  ['ask_api.js'], // the Ask endpoint on its own, every outside call faked
  ['ask_test.js'], // the Ask tab: questions, answers, hotline cards, errors, Tagalog
  ['ask_test.js', 'w=390', 'h=844', 'dark'],
];
(async () => {
  try { await fetch(BASE + '/'); } catch (e) { console.error(`Nothing at ${BASE}. Start the test server first: npm run serve`); process.exit(2); }
  const only = process.argv.slice(2).map(a => a.replace(/\.js$/, ''));
  const runs = SUITE.filter(([f]) => !only.length || only.includes(f.replace(/\.js$/, '')));
  const failed = [];
  for (const [file, ...args] of runs) {
    const name = [file, ...args].join(' ');
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { encoding: 'utf8', timeout: 15 * 60e3 });
    const out = (r.stdout || '') + (r.stderr || '');
    const ok = r.status === 0 && /ALL PASS\s*$/.test(out.trim());
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${Math.round((Date.now() - t0) / 1000)}s)`);
    if (!ok) { failed.push(name); console.log(out.split('\n').filter(l => /FAIL|error|Error/.test(l)).slice(0, 12).map(l => '      ' + l).join('\n')); }
  }
  console.log(failed.length ? `\n${failed.length} of ${runs.length} failed: ${failed.join(', ')}` : `\nAll ${runs.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
