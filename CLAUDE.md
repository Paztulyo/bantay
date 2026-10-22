# Bantay El Niño

A live El Niño monitor for Benguet and Baguio: a 3D terrain map with weather, active fires and the dry-stage outlook,
the PAGASA outlook timeline, charts, a hotlines and tips guide, and the sources behind every number. In English,
Tagalog and Ilocano.
Live at https://www.bantayelnino.com (Vercel project `bantay-el-nino`). bantayelnino.com redirects there (308), and the old
https://bantay-el-nino-eta.vercel.app still serves the site; the page's canonical link points search engines at www.

## How it's built

- Plain HTML, CSS and ES modules. No framework, no build step. three.js 0.147.0 loads from jsDelivr.
- `api/*.js` are Vercel functions that fetch and cache the live sources, all through `api/_lib.js`:
  `enso` (NOAA CPC, PAGASA), `dams` (PAGASA Agno cascade levels), `fires` (NASA FIRMS), `landcover` (ESA WorldCover),
  `osm` (OpenStreetMap via Overpass), `views` (visitor count in Upstash Redis).
- The browser fetches Open-Meteo (weather by town), AWS Terrain Tiles and OpenFreeMap vector tiles directly.
- `data/outlook.json` is editorial: updated by hand each month from PAGASA's outlook, with the advisory cited.
  `data/guide.json` holds the hotlines and tips, numbers checked against official sites. Benguet's `drydays` come from
  PAGASA's forecast dry days table, a picture inside the outlook PDF (page 21 of the 21 Oct 2026 issue); the `temp`
  line is still BaguioCityGuide's reading of the September maps, since the new temperature maps are vector drawings.
- Keys live only in Vercel environment variables: `FIRMS_MAP_KEY`, and `KV_REST_API_URL` + `KV_REST_API_TOKEN`
  (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`). Never put a key in code, a commit or a log. This repo is public.
- `vercel.json` serves `/js/` and `/css/` with `must-revalidate`, so changes show without cache-busting.
- Languages: `js/i18n.js` translates the page in place, text and labels, including whatever the app draws later, from
  `js/lang/tl.js` and `js/lang/ilo.js`. Those two are generated: edit `i18n/strings_*.py` (English, Tagalog, Ilocano
  side by side) or `i18n/patterns.py` (text with numbers and dates), then run `python3 i18n/gen.py`. The Be ready
  drawer renders itself through `t()`. Kept in English on purpose: agency, town, dam and source names, PAGASA's
  dry-stage and alert names, bulletin terms (Niño 3.4, RONI), and the Sources method notes and quotes.
  The choice: `?lang=` first, then the saved choice, then the phone's language.

| File | What it does |
|---|---|
| `js/app.js` | App shell: outlook data, timeline, charts, modes, the Sources drawer |
| `js/map3d.js` | The 3D terrain map and its labels |
| `js/live.js`, `js/osm.js` | Live feeds with a health status per source; OpenStreetMap layers |
| `js/weather.js`, `js/weather3d.js` | Weather card, forecast days, Play the week; weather drawn on the map |
| `js/ovpanel.js` | Map cards fold to the edges: pull tab on phones, fold handles on larger screens |
| `js/guide.js` | Be ready drawer: tips by dry stage, tap-to-call hotlines, search |
| `js/smoke.js` | Drawers burn away when they close |
| `js/views.js` | Visitor count chip, hidden until the count store answers |
| `js/i18n.js`, `js/lang/` | The EN / TL / ILO switch and the translation layer; dictionaries made by `i18n/gen.py` |
| `js/headfit.js` | Keeps the desktop header to one row: hides more context chips if the advisory line runs long |
| `js/icons.js`, `js/util.js` | Section icons; shared helpers, the tooltip, Manila time |
| `img/` | The logo (`logo.svg`, traced from the owner's artwork), the favicon and the home-screen icon. The header carries the logo inline; on the dark theme its green lifts to `#2f8f6b` |
| `css/app.css`, `extra.css`, `glass.css`, `brief.css` | Base styles, then each layer on top, in load order |

## Working rules

- Leave the map's drag controls alone. They work.
- Prefer a small module that watches the DOM over editing `app.js` (92 KB) or `map3d.js` (48 KB).
- Every animation respects `prefers-reduced-motion` and pauses in background tabs.
- Check every change at phone width (390) and desktop, in light and dark.
- Copy on the site: direct, plain words, no em dashes in sentences, no filler. This is an emergency tool: urgency comes
  from dates and numbers, not alarm styling. The same goes for the Tagalog and Ilocano.
- New or changed English on the site needs its Tagalog and Ilocano: that includes `data/outlook.json` every month and
  `data/guide.json`. Add the lines to `i18n/strings_*.py`, run `python3 i18n/gen.py`, then with the test server up
  `node i18n/untranslated.js tl` and `ilo`. A missing line shows in English, so nothing breaks, but the page reads mixed.
- Translations were drafted by Claude. Ilocano above all needs a native speaker's check before anyone relies on it;
  `i18n/review.csv` lists every line side by side. Hotline names, numbers and steps matter most.
- Header widths are tuned per language (`css/extra.css`, `css/brief.css`); `header_test.js` checks them.
- Don't create accounts, accept terms or connect services for the owner (Upstash, for example). Say what's needed.
- Never bypass CAPTCHAs or bot checks. Don't delete deployments without the owner's explicit go-ahead.
- Screenshots are for checking work, not deliverables.

## Run and test locally

```bash
cd tests
npm install
npx playwright install chromium
npm run serve     # http://127.0.0.1:8765/?test=1 with every data source mocked
npm test          # in a second terminal; or: node run-all.js burn_test tip_test
```

- `?test=1` swaps every live source for the files in `tests/mocks/`, so runs are repeatable and work offline.
- Each test prints `PASS`/`FAIL` lines and ends with `ALL PASS` or `N FAILED`. Screenshots go to `tests/out/`.
- `burn_test.js` the close effect; `ready_test.js` Be ready search and drawers; `fday_test.js` forecast days;
  `tuck_test.js` card folding on desktop; `panel_test.js` the phone pull tab; `tip_test.js` the map label on touch;
  `views_ui.js` the visitor chip; `lang_test.js` the language switch; `header_test.js` the header at every width in each
  language, with the site's real fonts (the `@fontsource` dev packages). Most take `w=`, `h=`, `dark`, and `rm`
  (reduced motion).
- `burn_frames.js` captures the close effect in slow motion (`dark`, `phone`, `src`, `map`); `sheet.py TAG` makes a
  contact sheet from the frames (needs Pillow).
- The tests run Chromium with software WebGL (SwiftShader) so the map renders anywhere. It's slow: tests wait on
  conditions for anything that loads, with short pauses only to let a click or an animation settle.
- Mock data: `osm.json` is © OpenStreetMap contributors (ODbL); terrain tiles from AWS Terrain Tiles.

## Deploy

The repo is connected to the Vercel project: every push to `main` deploys to production, and other branches get preview
deployments. `.vercelignore` keeps `tests/`, `i18n/` and this file off the site. After a deploy, load the live site, check the
console, and confirm the changed files are the ones being served. To undo a bad deploy, roll back to the previous
deployment in Vercel rather than rewriting history.

## Open items

- A national page (`/ph`: every province's PAGASA stage on a 3D map, weather, fires, a monthly stage check) is in
  progress on the `ph` branch. It runs on preview deployments only and is not on `main`.

- The visitor count is built but dormant until Upstash is connected in Vercel; it needs a redeploy after.
  `MIN_SHOW` in `js/views.js` (the number below which the chip stays hidden) is 0 until the owner picks a floor.
- Tagalog and Ilocano await a native speaker's review (`i18n/review.csv`).
