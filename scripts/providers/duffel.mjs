// Duffel API でオファー（実際に予約可能な運賃）を検索する。
// https://duffel.com/docs/api/v2/offer-requests
// 必要な環境変数: DUFFEL_TOKEN
// ※ duffel_test_ トークンでは架空の「Duffel Airways」等が返るため、実価格の参考にはならない。

import { codes } from '../lib/util.mjs';

export const name = 'duffel';

export function isEnabled(env) {
  return Boolean(env.DUFFEL_TOKEN);
}

export async function fetchQuotes(route, ctx) {
  // 複数空港の場合は出発・到着空港の組み合わせごとに検索する
  const quotes = [];
  for (const origin of codes(route.origin)) {
    for (const destination of codes(route.destination)) {
      quotes.push(...(await searchOffers(route, origin, destination, ctx)).quotes);
    }
  }
  return { quotes, insights: null };
}

async function searchOffers(route, origin, destination, { departDate, env, currency, fetchImpl = fetch }) {
  const slices = [{ origin, destination, departure_date: departDate }];
  if (route.returnDate) {
    slices.push({ origin: destination, destination: origin, departure_date: route.returnDate });
  }
  const passengers = Array.from({ length: route.adults ?? 1 }, () => ({ type: 'adult' }));

  const res = await fetchImpl(
    'https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=20000',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DUFFEL_TOKEN}`,
        'Duffel-Version': 'v2',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ data: { slices, passengers, cabin_class: 'economy' } }),
    },
  );
  if (!res.ok) throw new Error(`Duffel HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return parseDuffelResponse(await res.json(), currency);
}

export function parseDuffelResponse(body, currency) {
  const quotes = (body.data?.offers ?? [])
    // 通貨換算はしない。設定通貨と一致するオファーのみ採用する。
    .filter((o) => o.total_currency === currency)
    .map((o) => {
      const first = o.slices?.[0];
      const segments = first?.segments ?? [];
      return {
        price: Math.round(Number(o.total_amount)),
        currency: o.total_currency,
        airline: o.owner?.name ?? null,
        stops: Math.max(segments.length - 1, 0),
        durationMin: parseIsoDuration(first?.duration),
        departTime: segments[0]?.departing_at ?? null,
      };
    });
  return { quotes, insights: null };
}

function parseIsoDuration(value) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(value ?? '');
  if (!m) return null;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
