const ACTION_LABEL = { BUY: '買い時', WAIT: '待ち', WATCH: '様子見', ENDED: '終了', NO_DATA: 'データなし' };
const PROVIDER_LABEL = { serpapi: 'Google Flights (SerpApi)', duffel: 'Duffel', 'google-scrape': 'Google Flights (scrape)', mock: 'モック' };
const PALETTE = ['#3a62c4', '#c4572e', '#2e9e6a', '#8a4fc4', '#c49a2e'];

let currency = 'JPY';
const yen = (v) => (v == null ? '-' : new Intl.NumberFormat('ja-JP', { style: 'currency', currency }).format(v));
const fmtDate = (ms) => new Date(ms).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });

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
}

function renderCard(route, store) {
  const node = document.getElementById('route-card').content.cloneNode(true);
  const $ = (sel) => node.querySelector(sel);
  $('.label').textContent = route.label;
  $('.dates').textContent =
    `${route.origin} → ${route.destination} / ${route.departDate}` +
    (route.returnDate ? ` 〜 ${route.returnDate}` : ' 片道') +
    (route.daysToDeparture >= 0 ? `（出発まで ${route.daysToDeparture} 日）` : '');

  const rec = route.recommendation;
  $('.badge').textContent = ACTION_LABEL[rec.action] ?? rec.action;
  $('.badge').classList.add(rec.action);
  $('.reason').textContent = rec.reason;

  const stats = [
    ['現在の最安値', yen(route.latest?.price)],
    ['観測最安値', yen(route.allTimeLow)],
    ['観測最高値', yen(route.allTimeHigh)],
    ['相場レンジ', route.typicalRange ? `${yen(route.typicalRange[0])}〜${yen(route.typicalRange[1])}` : '-'],
    ['7日間の傾向', route.slopePerDay == null ? '-' : `${route.slopePerDay > 0 ? '+' : ''}${yen(route.slopePerDay)}/日`],
    ['観測回数', `${route.samples} 回`],
  ];
  for (const [k, v] of stats) {
    const div = document.createElement('div');
    div.innerHTML = '<dt></dt><dd></dd>';
    div.querySelector('dt').textContent = k;
    div.querySelector('dd').textContent = v;
    $('.stats').append(div);
  }

  const records = store?.records ?? [];
  if (records.length || store?.insights?.serpapi?.priceHistory) {
    const canvas = $('canvas');
    // テンプレート複製後に DOM へ追加されてから描画する
    queueMicrotask(() => drawChart(canvas, route, store));
  } else {
    $('.chart-wrap').innerHTML = '<p class="empty">グラフ表示に必要なデータがまだありません。</p>';
  }

  const lastTs = records.at(-1)?.ts;
  const tbody = $('.quotes tbody');
  for (const r of records.filter((r) => r.ts === lastTs)) {
    for (const q of r.quotes) {
      const tr = document.createElement('tr');
      const cells = [
        PROVIDER_LABEL[r.provider] ?? r.provider,
        q.airline ?? '-',
        yen(q.price),
        q.stops == null ? '-' : q.stops === 0 ? '直行' : `${q.stops}回`,
        q.durationMin == null ? '-' : `${Math.floor(q.durationMin / 60)}時間${q.durationMin % 60}分`,
      ];
      cells.forEach((c, i) => {
        const td = document.createElement('td');
        td.textContent = c;
        if (i === 2) td.className = 'num';
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

  const byProvider = new Map();
  for (const r of store?.records ?? []) {
    if (!byProvider.has(r.provider)) byProvider.set(r.provider, []);
    byProvider.get(r.provider).push({ x: Date.parse(r.ts), y: r.minPrice });
  }
  [...byProvider].forEach(([provider, data], i) => {
    datasets.push({
      label: PROVIDER_LABEL[provider] ?? provider,
      data,
      borderColor: PALETTE[i % PALETTE.length],
      backgroundColor: PALETTE[i % PALETTE.length],
      borderWidth: 2,
      pointRadius: data.length > 60 ? 0 : 2,
      tension: 0.2,
    });
  });

  const history = store?.insights?.serpapi?.priceHistory;
  if (history?.length) {
    datasets.push({
      label: 'Google の価格履歴',
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
