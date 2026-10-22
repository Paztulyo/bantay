// Reads PAGASA's "Outlook over different provinces" tables out of the climate outlook PDF text.
// Each month's table lists, per island group, three counts (dry condition, dry spell, drought)
// and then the three province lists one after another. The PDF text loses the column breaks,
// so the lists come out as one run of names; the counts say where each list ends.
// Every count is checked, and anything that doesn't add up is reported, never guessed.

// Map names (data/ph_provinces.json). PAGASA uses the same spelling for most of them.
export const PROVINCES = ["Abra", "Agusan del Norte", "Agusan del Sur", "Aklan", "Albay", "Antique", "Apayao", "Aurora", "Basilan", "Bataan", "Batanes", "Batangas", "Benguet", "Biliran", "Bohol", "Bukidnon", "Bulacan", "Cagayan", "Camarines Norte", "Camarines Sur", "Camiguin", "Capiz", "Catanduanes", "Cavite", "Cebu", "City of Isabela", "Cotabato", "Davao Occidental", "Davao Oriental", "Davao de Oro", "Davao del Norte", "Davao del Sur", "Dinagat Islands", "Eastern Samar", "Guimaras", "Ifugao", "Ilocos Norte", "Ilocos Sur", "Iloilo", "Isabela", "Kalinga", "La Union", "Laguna", "Lanao del Norte", "Lanao del Sur", "Leyte", "Maguindanao del Norte", "Maguindanao del Sur", "Marinduque", "Masbate", "Metro Manila", "Misamis Occidental", "Misamis Oriental", "Mountain Province", "Negros Occidental", "Negros Oriental", "Northern Samar", "Nueva Ecija", "Nueva Vizcaya", "Occidental Mindoro", "Oriental Mindoro", "Palawan", "Pampanga", "Pangasinan", "Quezon", "Quirino", "Rizal", "Romblon", "Samar", "Sarangani", "Siquijor", "Sorsogon", "South Cotabato", "Southern Leyte", "Special Geographic Area", "Sultan Kudarat", "Sulu", "Surigao del Norte", "Surigao del Sur", "Tarlac", "Tawi-Tawi", "Zambales", "Zamboanga Sibugay", "Zamboanga del Norte", "Zamboanga del Sur"];

// PAGASA spellings that differ from the map name
export const ALIAS = {
  'Metropolitan Manila': 'Metro Manila',
  'Metro Manila': 'Metro Manila',
  'Samar (Western Samar)': 'Samar',
  'Cotabato (North Cotabato)': 'Cotabato',
  'North Cotabato': 'Cotabato',
  'Davao de Oro (Compostela Valley)': 'Davao de Oro',
  'Compostela Valley': 'Davao de Oro',
  'Special Geographic Area (SGA)': 'Special Geographic Area',
  'Isabela City': 'City of Isabela',
};
// Places PAGASA lists on their own that sit inside a province on the map
export const SUB = {
  'Palawan (Kalayaan)': { parent: 'Palawan', label: 'Kalayaan Islands' },
  'Davao City': { parent: 'Davao del Sur', label: 'Davao City' },
};

const VOCAB = [...new Set([...PROVINCES, ...Object.keys(ALIAS), ...Object.keys(SUB)])].sort((a, b) => b.length - a.length);
const KEYS = ['cond', 'spell', 'drought'];
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const clean = s => s.replace(/-\s*\n\s*/g, '-').replace(/\s+/g, ' ').trim();

// split a run of names into known names, longest match first; unknown pieces are returned too
export function splitNames(run) {
  const s = clean(run).replace(/\bNone\b/g, ' ');
  const names = [], unknown = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;
    const hit = VOCAB.find(v => s.startsWith(v, i) && (i + v.length === s.length || /[\s,]/.test(s[i + v.length])));
    if (hit) { names.push(hit); i += hit.length; continue; }
    const j = s.indexOf(',', i);
    const bad = s.slice(i, j < 0 ? s.length : j).trim();
    unknown.push(bad); names.push('?' + bad);
    i = j < 0 ? s.length : j + 1;
  }
  return { names, unknown };
}

function issuedDate(pages) {
  const all = pages.join('\n');
  const tally = {};
  for (const m of all.matchAll(/Issued:\s*(\d{1,2})\s+([A-Z][a-z]+)\s+(20\d\d)/g)) {
    const mi = MONTH_NAMES.indexOf(m[2]);
    if (mi < 0) continue;
    const d = `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    tally[d] = (tally[d] || 0) + 1;
  }
  for (const m of all.matchAll(/Issuance:\s*(20\d\d-\d\d-\d\d)/g)) tally[m[1]] = (tally[m[1]] || 0) + 0.5;
  const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

export function parseOutlook(pages) {
  const problems = [];
  const months = [];
  const stages = {}; // month -> map name -> stage
  const subs = {};   // month -> label -> {parent, stage}
  for (const page of pages) {
    const head = page.match(/OUTLOOK OVER DIFFERENT PROVINCES\s+by end of ([A-Z][a-z]{2})[a-z]*\.? (20\d\d)/);
    if (!head) continue;
    const month = `${head[2]}-${String(MON[head[1]]).padStart(2, '0')}`;
    if (!MON[head[1]] || stages[month]) { problems.push(`Unreadable or repeated month heading: ${head[0]}`); continue; }
    months.push(month);
    stages[month] = {}; subs[month] = {};
    const sum = [0, 0, 0];
    const re = /\b(LUZON|VISAYAS|MINDANAO)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\s\S]*?)(?=\b(?:VISAYAS|MINDANAO)\s+\d+\s+\d+\s+\d+|\bTOTAL\s+\d)/g;
    let areas = 0;
    for (const m of page.matchAll(re)) {
      areas++;
      const counts = [+m[2], +m[3], +m[4]];
      counts.forEach((c, k) => { sum[k] += c; });
      const { names, unknown } = splitNames(m[5]);
      unknown.forEach(u => problems.push(`${month} ${m[1]}: name not recognised: "${u}"`));
      const want = counts[0] + counts[1] + counts[2];
      if (names.length !== want) {
        problems.push(`${month} ${m[1]}: ${names.length} names for ${want} counted (${counts.join(' / ')})`);
        continue;
      }
      let at = 0;
      counts.forEach((c, k) => {
        for (const raw of names.slice(at, at + c)) {
          if (raw.startsWith('?')) continue;
          if (SUB[raw]) { subs[month][SUB[raw].label] = { parent: SUB[raw].parent, stage: KEYS[k] }; continue; }
          const name = ALIAS[raw] || raw;
          if (stages[month][name] && stages[month][name] !== KEYS[k]) problems.push(`${month}: ${name} listed under two stages`);
          stages[month][name] = KEYS[k];
        }
        at += c;
      });
    }
    if (areas !== 3) problems.push(`${month}: found ${areas} of 3 island groups`);
    const tot = page.match(/\bTOTAL\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (!tot) problems.push(`${month}: no TOTAL row`);
    else if (tot.slice(1).map(Number).join() !== sum.join()) problems.push(`${month}: TOTAL ${tot.slice(1).join(' / ')} but the island groups add to ${sum.join(' / ')}`);
  }
  if (!months.length) problems.push('No "Outlook over different provinces" tables found');
  months.sort();
  return { issued: issuedDate(pages), months, stages, subs, problems };
}

// What changed between the published file and a new draft, for the person approving it
export function diffStages(pub, draft) {
  const out = [];
  if (!pub) return out;
  for (const m of draft.months) {
    const a = (pub.stages || {})[m] || null, b = draft.stages[m];
    if (!a) { out.push({ month: m, name: '*', from: null, to: 'new month' }); continue; }
    for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if ((a[n] || null) !== (b[n] || null)) out.push({ month: m, name: n, from: a[n] || null, to: b[n] || null });
    }
  }
  return out;
}
