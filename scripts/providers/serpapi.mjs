// SerpApi 経由で Google Flights の検索結果を取得する。
// https://serpapi.com/google-flights-api
// 必要な環境変数: SERPAPI_KEY

import { codes } from '../lib/util.mjs';

export const name = 'serpapi';

export function isEnabled(env) {
  return Boolean(env.SERPAPI_KEY);
}

export async function fetchQuotes(route, { departDate, env, currency, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    engine: 'google_flights',
    // 複数空港はカンマ区切りで指定できる（例: HND,NRT）
    departure_id: codes(route.origin).join(','),
    arrival_id: codes(route.destination).join(','),
    outbound_date: departDate,
    type: route.returnDate ? '1' : '2',
    adults: String(route.adults ?? 1),
    currency,
    hl: 'ja',
    gl: 'jp',
    api_key: env.SERPAPI_KEY,
  });
  if (route.returnDate) params.set('return_date', route.returnDate);

  const res = await fetchImpl(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`SerpApi: ${body.error}`);
  return parseSerpApiResponse(body, currency);
}

export function parseSerpApiResponse(body, currency) {
  const flights = [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
  const quotes = flights
    .filter((f) => typeof f.price === 'number')
    .map((f) => {
      const legs = f.flights ?? [];
      return {
        price: f.price,
        currency,
        airline: [...new Set(legs.map((l) => l.airline).filter(Boolean))].join(' / ') || null,
        stops: Math.max(legs.length - 1, 0),
        durationMin: f.total_duration ?? null,
        departTime: legs[0]?.departure_airport?.time ?? null,
      };
    });

  const pi = body.price_insights;
  const insights = pi
    ? {
        lowestPrice: pi.lowest_price ?? null,
        priceLevel: pi.price_level ?? null,
        typicalRange: Array.isArray(pi.typical_price_range) ? pi.typical_price_range : null,
        // [[unix秒, 価格], ...] Google が持つ過去の価格推移
        priceHistory: Array.isArray(pi.price_history) ? pi.price_history : null,
      }
    : null;

  return { quotes, insights };
}
