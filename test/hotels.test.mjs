import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSerpApiHotels } from '../scripts/hotel-providers/serpapi-hotels.mjs';
import { parseRakutenResponse } from '../scripts/hotel-providers/rakuten.mjs';
import * as rakuten from '../scripts/hotel-providers/rakuten.mjs';
import { allHotelProviders } from '../scripts/hotel-providers/index.mjs';
import { selectProviders } from '../scripts/providers/index.mjs';
import { analyzeStay } from '../scripts/lib/analysis.mjs';
import { distanceKm, nightsBetween } from '../scripts/lib/util.mjs';

const stay = { id: 's', query: '盛岡駅 ホテル', latitude: 39.7016, longitude: 141.1366, radiusKm: 1.5, checkIn: '2027-08-09', checkOut: '2027-08-11', adults: 1 };

test('SerpApi Google Hotels のレスポンスを解析する', () => {
  const quotes = parseSerpApiHotels(
    {
      properties: [
        { name: 'ホテルA', rate_per_night: { extracted_lowest: 7000 }, total_rate: { extracted_lowest: 14500 }, overall_rating: 4.1, gps_coordinates: { latitude: 39.70, longitude: 141.13 }, link: 'https://a.example' },
        { name: 'ホテルB', rate_per_night: { extracted_lowest: 9000 } },
        { name: '料金なし' },
      ],
    },
    stay,
    'JPY',
  );
  assert.equal(quotes.length, 2);
  assert.equal(quotes[0].total, 14500);
  assert.equal(quotes[1].total, 18000);
});

test('楽天トラベルのレスポンス（formatVersion 2 / 1）を解析する', () => {
  const v2 = {
    hotels: [
      [
        { hotelBasicInfo: { hotelName: 'ホテル盛岡', planListUrl: 'https://travel.rakuten.co.jp/x', reviewAverage: 4.2, latitude: 39.70, longitude: 141.14 } },
        { roomInfo: [{ roomBasicInfo: { planName: '素泊まり' } }, { dailyCharge: { total: 15000 } }] },
        { roomInfo: [{ roomBasicInfo: { planName: '朝食付' } }, { dailyCharge: { total: 18000 } }] },
      ],
    ],
  };
  const v1 = { hotels: [{ hotel: [{ hotelBasicInfo: { hotelName: 'B' } }, { roomInfo: [{ dailyCharge: { total: 12000 } }] }] }] };
  assert.deepEqual(parseRakutenResponse(v2, 'JPY').map((q) => [q.name, q.total]), [['ホテル盛岡', 15000]]);
  assert.deepEqual(parseRakutenResponse(v1, 'JPY').map((q) => [q.name, q.total]), [['B', 12000]]);
});

test('楽天トラベル: 空室なし (404 not_found) は空配列、他のエラーは例外', async () => {
  const env = { RAKUTEN_APP_ID: 'a', RAKUTEN_ACCESS_KEY: 'k' };
  let calledUrl;
  const notFound = async (url) => {
    calledUrl = url;
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
  };
  assert.deepEqual(await rakuten.fetchStayQuotes(stay, { env, currency: 'JPY', fetchImpl: notFound }), []);
  assert.match(calledUrl, /openapi\.rakuten\.co\.jp.*checkinDate=2027-08-09&checkoutDate=2027-08-11/);
  assert.match(calledUrl, /accessKey=k/);
  const denied = async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden', error_description: 'bad referer' }) });
  await assert.rejects(rakuten.fetchStayQuotes(stay, { env, currency: 'JPY', fetchImpl: denied }), /403/);
});

test('宿プロバイダの選択', () => {
  assert.deepEqual(selectProviders({ SERPAPI_KEY: 'x', RAKUTEN_APP_ID: 'a', RAKUTEN_ACCESS_KEY: 'k' }, allHotelProviders).map((p) => p.name), ['serpapi', 'rakuten']);
  assert.deepEqual(selectProviders({ RAKUTEN_APP_ID: 'a' }, allHotelProviders), []);
  // PROVIDERS=rakuten は航空券側では何も選ばれないがエラーにはならない
  assert.deepEqual(selectProviders({ PROVIDERS: 'rakuten' }), []);
});

test('analyzeStay と距離・泊数', () => {
  assert.equal(nightsBetween('2027-08-09', '2027-08-11'), 2);
  assert.ok(Math.abs(distanceKm(39.7016, 141.1366, 39.7016, 141.1483) - 1.0) < 0.05);
  const r = analyzeStay(stay, { records: [{ ts: '2026-10-13T00:00:00Z', provider: 'rakuten', minPrice: 14000, medianPrice: 20000, quoteCount: 12 }] }, new Date('2026-10-13T01:00:00Z'));
  assert.equal(r.nights, 2);
  assert.equal(r.latest.price, 14000);
  assert.equal(r.latestMedian, 20000);
  assert.equal(r.recommendation.action, 'WATCH');
  assert.equal(analyzeStay(stay, null, new Date('2027-08-10T00:00:00Z')).recommendation.action, 'ENDED');
});
