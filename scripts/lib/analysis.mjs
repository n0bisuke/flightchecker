// 価格履歴から統計値と「買い時」の目安を計算する。
// 機械学習ではなくシンプルな経験則によるヒューリスティック。

import { daysUntil } from './util.mjs';

const DAY = 86_400_000;

/** 1回の収集（同一 ts）ごとに、全プロバイダ中の最安値をとった系列を作る。 */
export function cheapestSeries(records) {
  const byTs = new Map();
  for (const r of records) {
    const cur = byTs.get(r.ts);
    if (!cur || r.minPrice < cur.price) byTs.set(r.ts, { ts: r.ts, price: r.minPrice, provider: r.provider });
  }
  return [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

export function percentileRank(values, x) {
  if (values.length === 0) return null;
  const below = values.filter((v) => v < x).length;
  const equal = values.filter((v) => v === x).length;
  return (below + equal / 2) / values.length;
}

export function quantile(values, q) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (pos - lo));
}

/** 最小二乗法による傾き（円/日）。点が少なすぎる場合は null。 */
export function slopePerDay(points) {
  if (points.length < 3) return null;
  const xs = points.map((p) => Date.parse(p.ts) / DAY);
  const ys = points.map((p) => p.price);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

export function analyzeRoute(route, store, now = new Date()) {
  const records = store?.records ?? [];
  const series = cheapestSeries(records);
  const prices = series.map((p) => p.price);
  const latest = series.at(-1) ?? null;
  const days = daysUntil(route.departDate, now);

  const recent = series.filter((p) => now.getTime() - Date.parse(p.ts) <= 7 * DAY);
  const slope = slopePerDay(recent);

  // 相場レンジ: Google の典型価格帯があれば優先し、なければ自前の履歴の四分位
  const google = store?.insights?.serpapi;
  const typicalRange =
    google?.typicalRange ?? (prices.length >= 5 ? [quantile(prices, 0.25), quantile(prices, 0.75)] : null);

  const allTimeLow = prices.length ? Math.min(...prices) : null;
  const pct = latest && prices.length >= 5 ? percentileRank(prices, latest.price) : null;

  return {
    id: route.id,
    label: route.label ?? route.id,
    origin: route.origin,
    destination: route.destination,
    departDate: route.departDate,
    returnDate: route.returnDate ?? null,
    daysToDeparture: days,
    latest,
    allTimeLow,
    allTimeHigh: prices.length ? Math.max(...prices) : null,
    samples: series.length,
    percentile: pct,
    slopePerDay: slope === null ? null : Math.round(slope),
    typicalRange,
    priceLevel: google?.priceLevel ?? null,
    recommendation: recommend({ days, latest, pct, slope, typicalRange }),
  };
}

export function recommend({ days, latest, pct, slope, typicalRange }) {
  if (days < 0) return { action: 'ENDED', reason: '出発日を過ぎました' };
  if (!latest) return { action: 'NO_DATA', reason: 'まだ価格データがありません' };

  const [low, high] = typicalRange ?? [null, null];
  if (days <= 14) return { action: 'BUY', reason: '出発まで2週間を切ると値上がりしやすい時期です' };
  if (low !== null && latest.price <= low) return { action: 'BUY', reason: '相場レンジの下限以下です' };
  if (pct !== null && pct <= 0.15) return { action: 'BUY', reason: 'これまでの観測の中でかなり安い水準です' };
  if (days > 30 && slope !== null && slope < -50) {
    return { action: 'WAIT', reason: '直近1週間は下落傾向です' };
  }
  if (days > 30 && high !== null && latest.price >= high) {
    return { action: 'WAIT', reason: '相場レンジの上限以上で割高です' };
  }
  if (days <= 30 && slope !== null && slope > 0) {
    return { action: 'BUY', reason: '出発1か月以内で上昇傾向です' };
  }
  return { action: 'WATCH', reason: '相場並みです。引き続き様子見' };
}
