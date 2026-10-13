// SerpApi 経由で Google Hotels の検索結果を取得する。
// https://serpapi.com/google-hotels-api
// 必要な環境変数: SERPAPI_KEY

import { nightsBetween } from '../lib/util.mjs';

export const name = 'serpapi';

export function isEnabled(env) {
  return Boolean(env.SERPAPI_KEY);
}

export async function fetchStayQuotes(stay, { env, currency, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    engine: 'google_hotels',
    q: stay.query,
    check_in_date: stay.checkIn,
    check_out_date: stay.checkOut,
    adults: String(stay.adults ?? 1),
    currency,
    hl: 'ja',
    gl: 'jp',
    sort_by: '3', // 安い順
    api_key: env.SERPAPI_KEY,
  });
  const res = await fetchImpl(`https://serpapi.com/search.json?${params}`);
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`SerpApi: ${body.error}`);
  return parseSerpApiHotels(body, stay, currency);
}

export function parseSerpApiHotels(body, stay, currency) {
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  return (body.properties ?? [])
    .map((p) => {
      const perNight = p.rate_per_night?.extracted_lowest ?? null;
      const total = p.total_rate?.extracted_lowest ?? (perNight ? perNight * nights : null);
      return {
        name: p.name,
        total,
        perNight: perNight ?? (total ? Math.round(total / nights) : null),
        currency,
        rating: p.overall_rating ?? null,
        latitude: p.gps_coordinates?.latitude ?? null,
        longitude: p.gps_coordinates?.longitude ?? null,
        url: p.link ?? null,
      };
    })
    .filter((q) => q.name && q.total);
}
