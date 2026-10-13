// 楽天トラベル空室検索 API で、指定地点の周辺にある空室ありの宿と料金を取得する。
// https://webservice.rakuten.co.jp/documentation/vacant-hotel-search
// 必要な環境変数: RAKUTEN_APP_ID, RAKUTEN_ACCESS_KEY
// 任意: RAKUTEN_REFERER（アプリ登録時に許可したサイトの URL。Referer チェックがある場合に送る）

export const name = 'rakuten';

const ENDPOINT = 'https://openapi.rakuten.co.jp/engine/api/Travel/VacantHotelSearch/20170426';

export function isEnabled(env) {
  return Boolean(env.RAKUTEN_APP_ID && env.RAKUTEN_ACCESS_KEY);
}

export async function fetchStayQuotes(stay, { env, currency, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    applicationId: env.RAKUTEN_APP_ID,
    accessKey: env.RAKUTEN_ACCESS_KEY,
    format: 'json',
    formatVersion: '2',
    checkinDate: stay.checkIn,
    checkoutDate: stay.checkOut,
    adultNum: String(stay.adults ?? 1),
    latitude: String(stay.latitude),
    longitude: String(stay.longitude),
    // 楽天の検索半径は 0.1〜3.0 km
    searchRadius: String(Math.min(3, Math.max(0.1, stay.radiusKm ?? 1))),
    datumType: '1', // 世界測地系・度
    sort: '+roomCharge',
    hits: '30',
  });
  const headers = env.RAKUTEN_REFERER ? { Referer: env.RAKUTEN_REFERER, Origin: new URL(env.RAKUTEN_REFERER).origin } : {};
  const res = await fetchImpl(`${ENDPOINT}?${params}`, { headers });
  const body = await res.json().catch(() => ({}));
  // 空室が1件もない場合は 404 not_found が返る
  if (res.status === 404 && body.error === 'not_found') return [];
  if (!res.ok) throw new Error(`Rakuten HTTP ${res.status}: ${body.error_description ?? body.error ?? ''}`);
  return parseRakutenResponse(body, currency);
}

/** formatVersion 1 / 2 どちらのレスポンスも扱う。 */
export function parseRakutenResponse(body, currency) {
  const quotes = [];
  for (const entry of body.hotels ?? []) {
    const parts = Array.isArray(entry) ? entry : entry.hotel ?? [];
    const info = parts.find((p) => p.hotelBasicInfo)?.hotelBasicInfo;
    if (!info) continue;

    // 各プランの宿泊合計（dailyCharge.total）のうち最安を採用
    let total = null;
    for (const part of parts) {
      for (const room of [].concat(part.roomInfo ?? [])) {
        const items = Array.isArray(room) ? room : [room];
        for (const item of items) {
          const t = item.dailyCharge?.total;
          if (typeof t === 'number' && t > 0 && (total === null || t < total)) total = t;
        }
      }
    }
    if (total === null) continue;

    quotes.push({
      name: info.hotelName,
      total,
      perNight: null, // 泊数で割るのは収集側で行う
      currency,
      rating: info.reviewAverage ?? null,
      latitude: info.latitude ?? null,
      longitude: info.longitude ?? null,
      url: info.planListUrl ?? info.hotelInformationUrl ?? null,
    });
  }
  return quotes;
}
