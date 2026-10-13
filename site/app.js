const ACTION_LABEL = { BUY: '買い時', WAIT: '待ち', WATCH: '様子見', ENDED: '終了', NO_DATA: 'データなし' };
const PROVIDER_LABEL = { serpapi: 'Google Flights (SerpApi)', duffel: 'Duffel', 'google-scrape': 'Google Flights (scrape)', mock: 'モック' };
const STAY_PROVIDER_LABEL = { serpapi: 'Google Hotels (SerpApi)', rakuten: '楽天トラベル', mock: 'モック' };
const PALETTE = ['#3a62c4', '#c4572e', '#2e9e6a', '#8a4fc4', '#c49a2e'];

let currency = 'JPY';
const yen = (v) => (v == null ? '-' : new Intl.NumberFormat('ja-JP', { style: 'currency', currency }).format(v));
const fmtDate = (ms) => new Date(ms).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
const fmtDepart = (d) => {
  const [, m, day] = d.split('-').map(Number);
  const w = '日月火水木金土'[new Date(`${d}T00:00:00Z`).getUTCDay()];
  return `${m}/${day}(${w})`;
};
const airports = (v) => (Array.isArray(v) ? v.join('・') : v);

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const root = document.getElementById('routes');
  let summary;
  try {
    summary = await getJson('data/summary.json');
  } catch {
    document.getElementById('updated').textContent = '';
    root.innerHTML = '<p class="empty">まだデータがありません。GitHub Actions の「Collect prices」を実行してください。</p>';
    return;
  }
  currency = summary.currency;
  document.getElementById('updated').textContent =
    `最終更新: ${new Date(summary.generatedAt).toLocaleString('ja-JP')}`;

  for (const route of summary.routes) {
    const store = await getJson(`data/prices/${encodeURIComponent(route.id)}.json`).catch(() => null);
    root.append(renderCard(route, store));
  }

  const stays = document.getElementById('stays');
  for (const stay of summary.stays ?? []) {
    const store = await getJson(`data/stays/${encodeURIComponent(stay.id)}.json`).catch(() => null);
    stays.append(renderStayCard(stay, store));
  }
}

function fillStats(container, stats) {
  for (const [k, v] of stats) {
    const div = document.createElement('div');
    div.innerHTML = '<dt></dt><dd></dd>';
    div.querySelector('dt').textContent = k;
    div.querySelector('dd').textContent = v;
    container.append(div);
  }
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function renderStayCard(stay, store) {
  const node = document.getElementById('stay-card').content.cloneNode(true);
  const $ = (sel) => node.querySelector(sel);
  $('.label').textContent = stay.label;
  $('.dates').textContent =
    `${fmtDepart(stay.checkIn)}〜${fmtDepart(stay.checkOut)} ${stay.nights}泊 / 大人${stay.adults}名 / 半径${stay.radiusKm}km` +
    (stay.daysToCheckIn >= 0 ? `（チェックインまで ${stay.daysToCheckIn} 日）` : '');

  const rec = stay.recommendation;
  $('.badge').textContent = ACTION_LABEL[rec.action] ?? rec.action;
  $('.badge').classList.add(rec.action);
  $('.reason').textContent = rec.reason;

  fillStats($('.stats'), [
    ['最安（宿泊合計）', yen(stay.latest?.price)],
    ['最安（1泊あたり）', stay.latest ? yen(Math.round(stay.latest.price / stay.nights)) : '-'],
    ['中央値（宿泊合計）', yen(stay.latestMedian)],
    ['観測最安値', yen(stay.allTimeLow)],
    ['7日間の傾向', stay.slopePerDay == null ? '-' : `${stay.slopePerDay > 0 ? '+' : ''}${yen(stay.slopePerDay)}/日`],
    ['空室のある宿', stay.latest ? `${stay.latestHotelCount} 件` : '-'],
  ]);

  const records = store?.records ?? [];
  if (records.length) {
    const canvas = $('canvas');
    queueMicrotask(() => drawStayChart(canvas, stay, records));
  } else {
    $('.chart-wrap').innerHTML = '<p class="empty">グラフ表示に必要なデータがまだありません。</p>';
  }

  const lastTs = records.at(-1)?.ts;
  const rows = records
    .filter((r) => r.ts === lastTs)
    .flatMap((r) => r.quotes.map((q) => ({ ...q, provider: r.provider })))
    .sort((a, b) => a.total - b.total)
    .slice(0, 15);
  for (const q of rows) {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    const href = q.url && safeUrl(q.url);
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = q.name;
      nameTd.append(a);
    } else {
      nameTd.textContent = q.name;
    }
    tr.append(nameTd);
    const cells = [
      [yen(q.total), true],
      [yen(q.perNight), true],
      [q.rating == null ? '-' : q.rating.toFixed(1), true],
      [q.distanceKm == null ? '-' : `${q.distanceKm} km`, true],
      [STAY_PROVIDER_LABEL[q.provider] ?? q.provider, false],
    ];
    for (const [c, num] of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      if (num) td.className = 'num';
      tr.append(td);
    }
    $('.quotes tbody').append(tr);
  }
  return node;
}

function drawStayChart(canvas, stay, records) {
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--muted').trim();
  const grid = css.getPropertyValue('--border').trim();
  const byProvider = new Map();
  for (const r of records) {
    if (!byProvider.has(r.provider)) byProvider.set(r.provider, []);
    byProvider.get(r.provider).push(r);
  }
  const datasets = [];
  [...byProvider].forEach(([provider, rs], i) => {
    const color = PALETTE[i % PALETTE.length];
    const label = STAY_PROVIDER_LABEL[provider] ?? provider;
    const radius = rs.length > 60 ? 0 : 2;
    datasets.push(
      { label: `${label} 最安`, data: rs.map((r) => ({ x: Date.parse(r.ts), y: r.minPrice })), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: radius, tension: 0.2 },
      { label: `${label} 中央値`, data: rs.map((r) => ({ x: Date.parse(r.ts), y: r.medianPrice ?? r.minPrice })), borderColor: color, backgroundColor: color, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.2 },
    );
  });
  const xs = records.map((r) => Date.parse(r.ts));
  new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { type: 'linear', min: Math.min(...xs), max: Math.max(...xs), ticks: { color: text, callback: fmtDate, maxTicksLimit: 8 }, grid: { color: grid } },
        y: { ticks: { color: text, callback: (v) => yen(v) }, grid: { color: grid } },
      },
      plugins: {
        legend: { labels: { color: text } },
        tooltip: {
          callbacks: {
            title: (items) => new Date(items[0].parsed.x).toLocaleString('ja-JP'),
            label: (item) => `${item.dataset.label}: ${yen(item.parsed.y)}（${stay.nights}泊合計）`,
          },
        },
      },
    },
  });
}

function renderCard(route, store) {
  const node = document.getElementById('route-card').content.cloneNode(true);
  const $ = (sel) => node.querySelector(sel);
  $('.label').textContent = route.label;
  const range = route.departDateFrom === route.departDateTo
    ? fmtDepart(route.departDateFrom)
    : `${fmtDepart(route.departDateFrom)}〜${fmtDepart(route.departDateTo)}`;
  $('.dates').textContent =
    `${airports(route.origin)} → ${airports(route.destination)} / ${range}` +
    (route.returnDate ? ` 復路 ${fmtDepart(route.returnDate)}` : ' 片道') +
    (route.daysToDeparture >= 0 ? `（出発まで ${route.daysToDeparture} 日）` : '');

  const rec = route.recommendation;
  $('.badge').textContent = ACTION_LABEL[rec.action] ?? rec.action;
  $('.badge').classList.add(rec.action);
  $('.reason').textContent = rec.reason;

  const stats = [
    ['現在の最安値', yen(route.latest?.price)],
    ['最安の出発日', route.latest?.departDate ? fmtDepart(route.latest.departDate) : '-'],
    ['観測最安値', yen(route.allTimeLow)],
    ['観測最高値', yen(route.allTimeHigh)],
    ['相場レンジ', route.typicalRange ? `${yen(route.typicalRange[0])}〜${yen(route.typicalRange[1])}` : '-'],
    ['7日間の傾向', route.slopePerDay == null ? '-' : `${route.slopePerDay > 0 ? '+' : ''}${yen(route.slopePerDay)}/日`],
    ['観測回数', `${route.samples} 回`],
  ];
  fillStats($('.stats'), stats);

  const cheapest = Math.min(...route.byDate.map((d) => d.price ?? Infinity));
  for (const d of route.byDate) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="d"></span><span class="p"></span>';
    li.querySelector('.d').textContent = fmtDepart(d.date);
    li.querySelector('.p').textContent = d.daysToDeparture < 0 ? '出発済み' : yen(d.price);
    if (d.price === cheapest && d.daysToDeparture >= 0) li.classList.add('best');
    if (d.daysToDeparture < 0) li.classList.add('past');
    $('.by-date').append(li);
  }

  const records = store?.records ?? [];
  if (records.length) {
    const canvas = $('canvas');
    // テンプレート複製後に DOM へ追加されてから描画する
    queueMicrotask(() => drawChart(canvas, route, store));
  } else {
    $('.chart-wrap').innerHTML = '<p class="empty">グラフ表示に必要なデータがまだありません。</p>';
  }

  const lastTs = records.at(-1)?.ts;
  const tbody = $('.quotes tbody');
  const latestRecords = records.filter((r) => r.ts === lastTs).sort((a, b) => a.minPrice - b.minPrice);
  for (const r of latestRecords) {
    for (const q of r.quotes) {
      const tr = document.createElement('tr');
      const cells = [
        r.departDate ? fmtDepart(r.departDate) : '-',
        PROVIDER_LABEL[r.provider] ?? r.provider,
        q.airline ?? '-',
        yen(q.price),
        q.stops == null ? '-' : q.stops === 0 ? '直行' : `${q.stops}回`,
        q.durationMin == null ? '-' : `${Math.floor(q.durationMin / 60)}時間${q.durationMin % 60}分`,
      ];
      cells.forEach((c, i) => {
        const td = document.createElement('td');
        td.textContent = c;
        if (i === 3) td.className = 'num';
        tr.append(td);
      });
      tbody.append(tr);
    }
  }
  return node;
}

function drawChart(canvas, route, store) {
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--muted').trim();
  const grid = css.getPropertyValue('--border').trim();
  const datasets = [];

  // 出発日ごとに、各収集時点での全プロバイダ中の最安値を線にする
  const byDate = new Map();
  for (const r of store?.records ?? []) {
    const key = r.departDate ?? route.departDateFrom;
    if (!byDate.has(key)) byDate.set(key, new Map());
    const points = byDate.get(key);
    const x = Date.parse(r.ts);
    points.set(x, Math.min(points.get(x) ?? Infinity, r.minPrice));
  }
  [...byDate].sort(([a], [b]) => a.localeCompare(b)).forEach(([date, points], i) => {
    const data = [...points].sort(([a], [b]) => a - b).map(([x, y]) => ({ x, y }));
    datasets.push({
      label: `${fmtDepart(date)} 発`,
      data,
      borderColor: PALETTE[i % PALETTE.length],
      backgroundColor: PALETTE[i % PALETTE.length],
      borderWidth: 2,
      pointRadius: data.length > 60 ? 0 : 2,
      tension: 0.2,
    });
  });

  const target = route.latest?.departDate;
  const history = target ? store?.insights?.serpapi?.[target]?.priceHistory : null;
  if (history?.length) {
    datasets.push({
      label: `Google の価格履歴（${fmtDepart(target)}）`,
      data: history.map(([t, p]) => ({ x: t * 1000, y: p })),
      borderColor: '#888',
      borderDash: [4, 4],
      borderWidth: 1.5,
      pointRadius: 0,
    });
  }

  const all = datasets.flatMap((d) => d.data.map((p) => p.x));
  if (route.typicalRange && all.length) {
    const xs = [Math.min(...all), Math.max(...all)];
    const band = 'rgba(46, 158, 106, 0.12)';
    datasets.push(
      { label: '相場レンジ', data: xs.map((x) => ({ x, y: route.typicalRange[1] })), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: band },
      { label: '_range_low', data: xs.map((x) => ({ x, y: route.typicalRange[0] })), borderWidth: 0, pointRadius: 0 },
    );
  }

  new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { type: 'linear', min: Math.min(...all), max: Math.max(...all), ticks: { color: text, callback: fmtDate, maxTicksLimit: 8 }, grid: { color: grid } },
        y: { ticks: { color: text, callback: (v) => yen(v) }, grid: { color: grid } },
      },
      plugins: {
        legend: { labels: { color: text, filter: (item) => !item.text.startsWith('_') } },
        tooltip: {
          filter: (item) => !item.dataset.label.startsWith('_'),
          callbacks: {
            title: (items) => new Date(items[0].parsed.x).toLocaleString('ja-JP'),
            label: (item) => `${item.dataset.label}: ${yen(item.parsed.y)}`,
          },
        },
      },
    },
  });
}

main();
