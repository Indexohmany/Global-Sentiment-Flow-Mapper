// data.js
//
// Loads the split JSON data files and exports the resolved values plus the
// few quantities we always derive from them right after load (ROWS, DATES,
// DATE_INDEX). Top-level await stays inside this module — ES modules
// guarantee that any consumer of these exports waits for our await to
// resolve before evaluating, so the rest of the app can `import` and use
// the values directly without re-awaiting.
//
// Layout on disk:
//   data/countries/index.json:  [ "AC", "AE", "AF", ... ]   manifest
//   data/countries/<FIPS>.json: { name, lat, lon, bloc, shapes }
//   data/articles.json:         { FIPS: [ {date, url, source, tone, mentioned, domains}, ... ] }
//   data/flows/<domain>.json:   [ {date, reporter, mentioned, domain, count, avg_tone, delta_tone}, ... ]

const fetchJson = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status} ${r.statusText}`);
  return r.json();
});

async function loadCountries() {
  const fipsList = await fetchJson('data/countries/index.json');
  const entries = await Promise.all(
    fipsList.map(fips =>
      fetchJson(`data/countries/${fips}.json`).then(c => [fips, c])
    )
  );
  return Object.fromEntries(entries);
}

const [_COUNTRIES, _ARTICLE_INDEX, _politicsFlows, _scienceFlows, _sportsFlows] =
  await Promise.all([
    loadCountries(),
    fetchJson('data/articles.json'),
    fetchJson('data/flows/politics.json'),
    fetchJson('data/flows/science.json'),
    fetchJson('data/flows/sports.json'),
  ]);

export const COUNTRIES     = _COUNTRIES;
export const ARTICLE_INDEX = _ARTICLE_INDEX;
export const ROWS = [..._politicsFlows, ..._scienceFlows, ..._sportsFlows];

// Sorted unique dates from ROWS, used for index-based time-window
// filtering so the time slider can be a simple integer range.
export const DATES = (() => {
  const set = new Set();
  for (const r of ROWS) set.add(r.date);
  return [...set].sort();
})();
export const DATE_INDEX = new Map();
for (let i = 0; i < DATES.length; i++) DATE_INDEX.set(DATES[i], i);

const totalArts = Object.values(ARTICLE_INDEX).reduce((s, a) => s + a.length, 0);
console.log(
  `Loaded ${ROWS.length} rows, ${Object.keys(COUNTRIES).length} country polygons, ` +
  `${totalArts} retained articles across ${Object.keys(ARTICLE_INDEX).length} reporters`
);
console.log(`Dataset spans ${DATES.length} unique dates: ${DATES[0]} .. ${DATES[DATES.length - 1]}`);
