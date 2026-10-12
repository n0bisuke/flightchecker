import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestSeries, percentileRank, quantile, slopePerDay, recommend, analyzeRoute } from '../scripts/lib/analysis.mjs';
import { daysUntil, routeDates } from '../scripts/lib/util.mjs';

test('cheapestSeries は同一時刻の中で最安のプロバイダを採用する', () => {
  const s = cheapestSeries([
    { ts: '2026-10-01T00:00:00Z', provider: 'a', minPrice: 12000 },
    { ts: '2026-10-01T00:00:00Z', provider: 'b', minPrice: 11000 },
    { ts: '2026-09-30T00:00:00Z', provider: 'a', minPrice: 13000 },
  ]);
  assert.deepEqual(s.map((p) => [p.price, p.provider]), [[13000, 'a'], [11000, 'b']]);
});

test('percentileRank と quantile', () => {
  assert.equal(percentileRank([1, 2, 3, 4], 1), 0.125);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20);
});

test('slopePerDay は1日あたりの変化量を返す', () => {
  const pts = [0, 1, 2, 3].map((d) => ({ ts: new Date(Date.UTC(2026, 9, 1 + d)).toISOString(), price: 10000 - d * 100 }));
  assert.equal(Math.round(slopePerDay(pts)), -100);
  assert.equal(slopePerDay(pts.slice(0, 2)), null);
});

test('daysUntil', () => {
  assert.equal(daysUntil('2026-10-20', new Date('2026-10-12T23:00:00Z')), 8);
});

test('recommend: 出発直前は BUY、下落傾向なら WAIT、相場上限超えも WAIT', () => {
  const latest = { price: 20000 };
  assert.equal(recommend({ days: 10, latest, pct: 0.5, slope: 0, typicalRange: null }).action, 'BUY');
  assert.equal(recommend({ days: 60, latest, pct: 0.5, slope: -200, typicalRange: null }).action, 'WAIT');
  assert.equal(recommend({ days: 60, latest, pct: 0.5, slope: 0, typicalRange: [15000, 19000] }).action, 'WAIT');
  assert.equal(recommend({ days: 60, latest, pct: 0.5, slope: 0, typicalRange: [20000, 25000] }).action, 'BUY');
  assert.equal(recommend({ days: 60, latest, pct: 0.1, slope: 0, typicalRange: null }).action, 'BUY');
  assert.equal(recommend({ days: 60, latest, pct: 0.5, slope: 0, typicalRange: null }).action, 'WATCH');
  assert.equal(recommend({ days: 60, latest: null }).action, 'NO_DATA');
  assert.equal(recommend({ days: -1, latest }).action, 'ENDED');
});

test('analyzeRoute は候補日の中の最安日を採用し、その日の SerpApi 相場レンジを優先する', () => {
  const route = { id: 'r', origin: ['HND', 'NRT'], destination: 'OKA', departDateFrom: '2026-12-20', departDateTo: '2026-12-22' };
  const ts = '2026-10-12T00:00:00Z';
  const store = {
    records: [
      { ts, departDate: '2026-12-20', provider: 'serpapi', minPrice: 16000 },
      { ts, departDate: '2026-12-21', provider: 'serpapi', minPrice: 14000 },
      { ts, departDate: '2026-12-21', provider: 'google-scrape', minPrice: 14500 },
    ],
    insights: { serpapi: { '2026-12-21': { typicalRange: [15000, 22000], priceLevel: 'low' } } },
  };
  const r = analyzeRoute(route, store, new Date('2026-10-12T01:00:00Z'));
  assert.equal(r.latest.departDate, '2026-12-21');
  assert.deepEqual(r.typicalRange, [15000, 22000]);
  assert.equal(r.recommendation.action, 'BUY');
  assert.deepEqual(r.byDate.map((d) => [d.date, d.price]), [['2026-12-20', 16000], ['2026-12-21', 14000], ['2026-12-22', null]]);
});

test('analyzeRoute は全候補日が過ぎたら ENDED', () => {
  const route = { id: 'r', origin: 'OKA', destination: 'HND', departDateFrom: '2026-10-15', departDateTo: '2026-10-18' };
  const r = analyzeRoute(route, { records: [{ ts: '2026-10-14T00:00:00Z', departDate: '2026-10-15', provider: 'mock', minPrice: 9000 }] }, new Date('2026-10-19T00:00:00Z'));
  assert.equal(r.recommendation.action, 'ENDED');
});

test('routeDates は範囲を展開し、単一日付にも対応する', () => {
  assert.deepEqual(routeDates({ departDateFrom: '2026-10-30', departDateTo: '2026-11-02' }), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(routeDates({ departDate: '2026-12-06' }), ['2026-12-06']);
});
