// modal.js
//
// Country detail modal — opens on map click, shows a 4-stat header, three
// SVG charts (tone distribution, daily volume, top targets), and the top
// tonal articles list. Reads from data + palette + the live filterState
// (passed in via initCountryModal). Doesn't write to filterState.
//
// Public surface:
//   initCountryModal(filterState)  — wires up close/Escape handlers, must
//                                    be called once at startup
//   openCountryModal(fips)         — open the modal for a country
//   closeCountryModal()            — close it
import { COUNTRIES, ROWS, ARTICLE_INDEX, DATES, DATE_INDEX } from './data.js';
import { toneTagOf } from './palette.js';

let _filterState = null;
let cmEl, cmCharts;

export function initCountryModal(filterState) {
  _filterState = filterState;
  cmEl = document.getElementById('country-modal');
  cmCharts = document.getElementById('cm-charts');
  document.getElementById('country-modal-close').addEventListener('click', closeCountryModal);
  cmEl.addEventListener('click', e => { if (e.target === cmEl) closeCountryModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && cmEl.classList.contains('open')) closeCountryModal();
  });
}

function fmtToneLabel(v) {
  if (v < -0.5) return { txt: v.toFixed(2), cls: 'neg' };
  if (v > 0.5)  return { txt: '+' + v.toFixed(2), cls: 'pos' };
  return { txt: v.toFixed(2), cls: '' };
}

function buildCountryModalData(fips) {
  const f = _filterState;
  // For the modal we ALWAYS include the clicked country's rows even if its
  // bloc is filtered out elsewhere — the modal is *about* this country.
  // We keep the domain + date + tone filters because those reflect a
  // genuine question the user is currently asking.
  const rows = ROWS.filter(r =>
    r.reporter === fips &&
    r.domain === f.domain &&
    DATE_INDEX.get(r.date) >= f.dateMin &&
    DATE_INDEX.get(r.date) <= f.dateMax &&
    f.toneTags.has(toneTagOf(r.avg_tone))
  );

  let articles = 0, toneNum = 0, toneDen = 0;
  const byDate = new Map();
  const byMentioned = new Map();
  const toneBuckets = [0, 0, 0, 0, 0];  // <-3, -3 to -1, -1 to +1, +1 to +3, >+3
  const activeDays = new Set();
  for (const r of rows) {
    articles += r.count;
    toneNum += r.avg_tone * r.count;
    toneDen += r.count;
    activeDays.add(r.date);
    byDate.set(r.date, (byDate.get(r.date) || 0) + r.count);
    byMentioned.set(r.mentioned, (byMentioned.get(r.mentioned) || 0) + r.count);
    let b;
    if (r.avg_tone < -3) b = 0;
    else if (r.avg_tone < -1) b = 1;
    else if (r.avg_tone <= 1) b = 2;
    else if (r.avg_tone <= 3) b = 3;
    else b = 4;
    toneBuckets[b] += r.count;
  }

  // Top tonal articles for this reporter, intersected with current filter window.
  // ARTICLE_INDEX[fips] holds up to 100 most-extreme-tone articles already.
  const allArts = ARTICLE_INDEX[fips] || [];
  const topArts = allArts
    .filter(a => {
      const di = DATE_INDEX.get(a.date);
      if (di === undefined) return false;
      if (di < f.dateMin || di > f.dateMax) return false;
      if (!a.domains || !a.domains.includes(f.domain)) return false;
      if (!f.toneTags.has(toneTagOf(a.tone))) return false;
      return true;
    })
    .slice(0, 12);  // show at most 12 in the modal

  return {
    articles,
    meanTone: toneDen ? toneNum / toneDen : 0,
    pairs: byMentioned.size,
    activeDays: activeDays.size,
    toneBuckets,
    byDate, byMentioned,
    topArts,
  };
}

// SVG helper
function svgEl(tag, attrs = {}, text = null) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (text != null) el.textContent = text;
  return el;
}

function renderToneChart(buckets) {
  const W = 720, H = 130, P = { l: 30, r: 16, t: 14, b: 38 };
  const labels = ['<−3', '−3 to −1', '−1 to +1', '+1 to +3', '>+3'];
  const colors = ['#b83322', '#e86a3a', '#a6aeb8', '#9cc08a', '#3a9d8a'];
  const max = Math.max(1, ...buckets);
  const bw = (W - P.l - P.r) / buckets.length;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}` });
  svg.appendChild(svgEl('line', {
    x1: P.l, y1: P.t, x2: P.l, y2: H - P.b,
    stroke: '#2a3140', 'stroke-width': 1,
  }));
  for (let i = 0; i < buckets.length; i++) {
    const v = buckets[i];
    const h = ((H - P.t - P.b) * v) / max;
    const x = P.l + bw * i + 6;
    const y = H - P.b - h;
    svg.appendChild(svgEl('rect', {
      x: x.toFixed(1), y: y.toFixed(1),
      width: (bw - 12).toFixed(1), height: h.toFixed(1),
      fill: colors[i],
    }));
    svg.appendChild(svgEl('text', {
      x: (x + (bw - 12) / 2).toFixed(1),
      y: (y - 5).toFixed(1),
      'text-anchor': 'middle',
      fill: '#d6dae0',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': '10',
    }, v.toLocaleString()));
    svg.appendChild(svgEl('text', {
      x: (x + (bw - 12) / 2).toFixed(1),
      y: H - P.b + 18,
      'text-anchor': 'middle',
      fill: '#8a93a3',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': '9',
    }, labels[i]));
  }
  return svg;
}

function renderTimelineChart(byDate) {
  const W = 720, H = 110, P = { l: 30, r: 16, t: 14, b: 28 };
  const dates = DATES.slice(_filterState.dateMin, _filterState.dateMax + 1);
  const values = dates.map(d => byDate.get(d) || 0);
  const max = Math.max(1, ...values);
  const bw = (W - P.l - P.r) / Math.max(values.length, 1);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}` });
  svg.appendChild(svgEl('line', {
    x1: P.l, y1: H - P.b, x2: W - P.r, y2: H - P.b,
    stroke: '#2a3140', 'stroke-width': 1,
  }));
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === 0) continue;
    const h = ((H - P.t - P.b) * v) / max;
    svg.appendChild(svgEl('rect', {
      x: (P.l + bw * i + 1).toFixed(1),
      y: (H - P.b - h).toFixed(1),
      width: Math.max(2, bw - 2).toFixed(1),
      height: h.toFixed(1),
      fill: '#c9a96e',
      opacity: '0.85',
    }));
  }
  if (dates.length > 0) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fmt = d => { const [, mm, dd] = d.split('-'); return `${months[+mm - 1]} ${+dd}`; };
    svg.appendChild(svgEl('text', {
      x: P.l, y: H - 8,
      fill: '#5b6473',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': '9',
    }, fmt(dates[0])));
    svg.appendChild(svgEl('text', {
      x: W - P.r, y: H - 8,
      'text-anchor': 'end',
      fill: '#5b6473',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': '9',
    }, fmt(dates[dates.length - 1])));
  }
  return svg;
}

function renderTargetsChart(byMentioned) {
  const top = [...byMentioned.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length === 0) {
    const svg = svgEl('svg', { viewBox: '0 0 720 40' });
    svg.appendChild(svgEl('text', {
      x: 360, y: 24, 'text-anchor': 'middle',
      fill: '#5b6473',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': '11',
    }, 'No mentioned-country data in current filter'));
    return svg;
  }
  const W = 720, P = { l: 80, r: 80, t: 6, b: 6 };
  const rowH = 22;
  const H = top.length * rowH + P.t + P.b;
  const max = top[0][1];
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}` });
  for (let i = 0; i < top.length; i++) {
    const [code, n] = top[i];
    const cn = COUNTRIES[code];
    const name = cn ? cn.name : code;
    const y = P.t + i * rowH;
    const bw = ((W - P.l - P.r) * n) / max;
    svg.appendChild(svgEl('rect', {
      x: P.l, y: (y + 6).toFixed(1),
      width: bw.toFixed(1), height: 12,
      fill: '#5d7a64',
    }));
    svg.appendChild(svgEl('text', {
      x: P.l - 8, y: y + 16,
      'text-anchor': 'end',
      fill: '#d6dae0',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': '11',
    }, name.length > 16 ? code : name));
    svg.appendChild(svgEl('text', {
      x: P.l + bw + 6, y: y + 16,
      fill: '#8a93a3',
      'font-family': 'JetBrains Mono, monospace',
      'font-size': '11',
    }, n.toLocaleString()));
  }
  return svg;
}

// Render the top-articles list (URL + source + tone + date + mentioned)
function renderArticleList(articles) {
  const list = document.createElement('div');
  list.className = 'article-list';
  if (articles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No high-tone articles in current filter window for this country.';
    list.appendChild(empty);
    return list;
  }
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtDate = d => { const [, mm, dd] = d.split('-'); return `${months[+mm - 1]} ${+dd}`; };
  // Truncate URLs for display
  function shortUrl(u) {
    try {
      const x = new URL(u);
      let p = x.pathname;
      if (p.length > 60) p = p.slice(0, 57) + '…';
      return x.host + p;
    } catch (e) {
      return u.slice(0, 80);
    }
  }
  for (const a of articles) {
    const row = document.createElement('div');
    row.className = 'article';

    const tone = document.createElement('div');
    tone.className = 'tone ' + (a.tone < -0.5 ? 'neg' : (a.tone > 0.5 ? 'pos' : ''));
    tone.textContent = (a.tone > 0 ? '+' : '') + a.tone.toFixed(2);
    row.appendChild(tone);

    const body = document.createElement('div');
    body.className = 'body';
    const src = document.createElement('div');
    src.className = 'source';
    src.innerHTML =
      `<span>${escapeHtml(a.source || '?')}</span>` +
      `<span class="sep">·</span>` +
      `<span>${fmtDate(a.date)}</span>`;
    body.appendChild(src);
    const url = document.createElement('div');
    url.className = 'url-line';
    const link = document.createElement('a');
    link.href = a.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = shortUrl(a.url);
    url.appendChild(link);
    body.appendChild(url);
    row.appendChild(body);

    const mentions = document.createElement('div');
    mentions.className = 'mentions';
    const codes = (a.mentioned || []).slice(0, 4).join(' ');
    mentions.innerHTML = `<span class="lbl">re:</span><span class="codes">${escapeHtml(codes) || '—'}</span>`;
    row.appendChild(mentions);

    list.appendChild(row);
  }
  return list;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function openCountryModal(fips) {
  const c = COUNTRIES[fips];
  if (!c) return;
  const data = buildCountryModalData(fips);

  document.getElementById('cm-name').textContent = c.name;
  document.getElementById('cm-fips').textContent = fips;
  document.getElementById('cm-bloc').textContent = c.bloc.replace(/_/g, ' ');
  document.getElementById('cm-articles').textContent = data.articles.toLocaleString();
  const toneEl = document.getElementById('cm-tone');
  if (data.articles > 0) {
    const tlbl = fmtToneLabel(data.meanTone);
    toneEl.textContent = tlbl.txt;
    toneEl.className = 'v ' + tlbl.cls;
  } else {
    toneEl.textContent = '—';
    toneEl.className = 'v';
  }
  document.getElementById('cm-pairs').textContent = data.pairs;
  document.getElementById('cm-days').textContent = data.activeDays;

  cmCharts.innerHTML = '';
  if (data.articles === 0 && data.topArts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No coverage from this country under current filters.';
    cmCharts.appendChild(empty);
  } else {
    if (data.articles > 0) {
      const sec1 = document.createElement('div');
      sec1.className = 'chart-section';
      sec1.innerHTML = '<div class="title">Tone Distribution</div>';
      sec1.appendChild(renderToneChart(data.toneBuckets));
      cmCharts.appendChild(sec1);

      const sec2 = document.createElement('div');
      sec2.className = 'chart-section';
      sec2.innerHTML = '<div class="title">Daily Article Volume</div>';
      sec2.appendChild(renderTimelineChart(data.byDate));
      cmCharts.appendChild(sec2);

      const sec3 = document.createElement('div');
      sec3.className = 'chart-section';
      sec3.innerHTML = '<div class="title">Top Mentioned Countries</div>';
      sec3.appendChild(renderTargetsChart(data.byMentioned));
      cmCharts.appendChild(sec3);
    }

    // Articles section
    const sec4 = document.createElement('div');
    sec4.className = 'chart-section';
    sec4.innerHTML = '<div class="title">Top Tonal Articles · Driving Sentiment Shift</div>';
    sec4.appendChild(renderArticleList(data.topArts));
    cmCharts.appendChild(sec4);
  }

  // Filter context
  const fs = _filterState;
  const ctx = [];
  ctx.push(`Domain: ${fs.domain}`);
  const days = fs.dateMax - fs.dateMin + 1;
  ctx.push(days === DATES.length ? 'all 21 days'
           : `${DATES[fs.dateMin]} → ${DATES[fs.dateMax]}`);
  if (fs.toneTags.size < 3) ctx.push(`tone: ${[...fs.toneTags].join(', ')}`);
  ctx.push('region/min-count filters: not applied to this country view');
  document.getElementById('cm-filters').textContent = ctx.join(' · ');

  cmEl.classList.add('open');
}

export function closeCountryModal() { cmEl.classList.remove('open'); }
