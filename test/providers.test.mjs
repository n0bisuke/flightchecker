import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSerpApiResponse } from '../scripts/providers/serpapi.mjs';
import { parseDuffelResponse } from '../scripts/providers/duffel.mjs';
import { parseResultTexts, buildSearchUrl } from '../scripts/providers/google-flights-scrape.mjs';
import { selectProviders } from '../scripts/providers/index.mjs';

test('SerpApi のレスポンスを解析する', () => {
  const { quotes, insights } = parseSerpApiResponse(
    {
      best_flights: [
        { price: 15800, total_duration: 155, flights: [{ airline: 'JAL', departure_airport: { time: '2026-12-20 07:00' } }] },
      ],
      other_flights: [{ price: 21000, total_duration: 300, flights: [{ airline: 'ANA' }, { airline: 'ANA' }] }, { flights: [] }],
      price_insights: { lowest_price: 15800, price_level: 'typical', typical_price_range: [14000, 23000], price_history: [[1760000000, 17000]] },
    },
    'JPY',
  );
  assert.equal(quotes.length, 2);
  assert.deepEqual(quotes[1], { price: 21000, currency: 'JPY', airline: 'ANA', stops: 1, durationMin: 300, departTime: null });
  assert.deepEqual(insights.typicalRange, [14000, 23000]);
});

test('Duffel のレスポンスは設定通貨のオファーのみ採用する', () => {
  const { quotes } = parseDuffelResponse(
    {
      data: {
        offers: [
          { total_amount: '18200.00', total_currency: 'JPY', owner: { name: 'ANA' }, slices: [{ duration: 'PT2H35M', segments: [{ departing_at: '2026-12-20T08:00:00' }] }] },
          { total_amount: '120.00', total_currency: 'USD', owner: { name: 'X' }, slices: [] },
        ],
      },
    },
    'JPY',
  );
  assert.deepEqual(quotes, [{ price: 18200, currency: 'JPY', airline: 'ANA', stops: 0, durationMin: 155, departTime: '2026-12-20T08:00:00' }]);
});

test('Google Flights の結果テキストから運賃を抽出する', () => {
  const quotes = parseResultTexts(
    [
      '6:15 AM\n – \n8:50 AM\nSkymark\n2 hr 35 min\nHND–OKA\nNonstop\n110 kg CO2e\n¥12,340\none way',
      '9:00 AM\n – \n3:10 PM\nANA, Peach\n6 hr 10 min\nHND–OKA\n1 stop\n45 min KIX\nJP¥19,800\none way',
      'Best departing flights',
    ],
    'JPY',
  );
  assert.equal(quotes.length, 2);
  assert.deepEqual(quotes[0], { price: 12340, currency: 'JPY', airline: 'Skymark', stops: 0, durationMin: 155, departTime: '6:15 AM' });
  assert.equal(quotes[1].stops, 1);
  assert.equal(quotes[1].airline, 'ANA, Peach');
});

test('検索 URL に往復/片道が反映される', () => {
  assert.match(buildSearchUrl({ origin: 'HND', destination: 'OKA', departDate: '2026-12-20' }, 'JPY'), /one\+way/);
  assert.match(buildSearchUrl({ origin: 'NRT', destination: 'TPE', departDate: '2027-02-05', returnDate: '2027-02-09' }, 'JPY'), /through\+2027-02-09/);
});

test('selectProviders は環境変数に応じて選択する', () => {
  assert.deepEqual(selectProviders({ SERPAPI_KEY: 'x', ENABLE_SCRAPER: '1' }).map((p) => p.name), ['serpapi', 'google-scrape']);
  assert.deepEqual(selectProviders({ PROVIDERS: 'mock' }).map((p) => p.name), ['mock']);
  assert.throws(() => selectProviders({ PROVIDERS: 'nope' }));
});
