// config/routes.json の各路線の運賃と、config/stays.json の各宿泊条件の料金を
// 有効なプロバイダから取得し、data/prices/ と data/stays/ に追記する。
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readJson, writeJson, daysUntil, routeDates, nightsBetween, distanceKm } from './lib/util.mjs';
import { selectProviders } from './providers/index.mjs';
import { allHotelProviders } from './hotel-providers/index.mjs';
import { runAnalysis } from './analyze.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOP_N = 5;
const TOP_N_STAYS = 10;

export async function collect({ env = process.env, now = new Date(), dataDir = join(ROOT, 'data') } = {}) {
  const flightProviders = selectProviders(env);
  const hotelProviders = selectProviders(env, allHotelProviders);
  const status = { ts: now.toISOString(), results: [] };

  if (flightProviders.length === 0 && hotelProviders.length === 0) {
    // 未設定でもサイトのデプロイまでは進められるよう、失敗にはしない
    console.warn('::warning::有効なプロバイダがありません。SERPAPI_KEY / DUFFEL_TOKEN / RAKUTEN_APP_ID+RAKUTEN_ACCESS_KEY / ENABLE_SCRAPER=1 / PROVIDERS=mock のいずれかを設定してください。');
  }
  if (flightProviders.length) {
    console.log(`flight providers: ${flightProviders.map((p) => p.name).join(', ')}`);
    await collectFlights({ env, now, dataDir, providers: flightProviders, status });
  }
  if (hotelProviders.length) {
    console.log(`hotel providers: ${hotelProviders.map((p) => p.name).join(', ')}`);
    await collectStays({ env, now, dataDir, providers: hotelProviders, status });
  }

  await writeJson(join(dataDir, 'status.json'), status);
  await runAnalysis({ dataDir, now });
  return status;
}

async function collectFlights({ env, now, dataDir, providers, status }) {
  const config = await readJson(join(ROOT, 'config/routes.json'));
  const currency = config.currency ?? 'JPY';
  const browser = providers.some((p) => p.name === 'google-scrape') ? await launchBrowser() : null;
  try {
    for (const route of config.routes) {
      const dates = routeDates(route).filter((d) => daysUntil(d, now) >= 0);
      if (dates.length === 0) {
        console.log(`skip ${route.id}: 出発日を過ぎています`);
        continue;
      }
      const file = join(dataDir, 'prices', `${route.id}.json`);
      const store = await readJson(file, { routeId: route.id, records: [], insights: {} });

      for (const departDate of dates) {
        for (const provider of providers) {
          const label = `${route.id} ${departDate} [${provider.name}]`;
          try {
            const { quotes, insights } = await provider.fetchQuotes(route, { departDate, env, currency, browser, now });
            const sorted = quotes.filter((q) => q.currency === currency).sort((a, b) => a.price - b.price);
            if (sorted.length === 0) throw new Error('運賃が取得できませんでした');

            store.records.push({
              ts: now.toISOString(),
              departDate,
              provider: provider.name,
              currency,
              minPrice: sorted[0].price,
              quoteCount: sorted.length,
              quotes: sorted.slice(0, TOP_N),
              ...(insights?.typicalRange ? { typicalRange: insights.typicalRange } : {}),
              ...(insights?.priceLevel ? { priceLevel: insights.priceLevel } : {}),
            });
            // 価格履歴などサイズの大きい情報は出発日ごとに最新分だけ保持する
            if (insights) {
              store.insights[provider.name] ??= {};
              store.insights[provider.name][departDate] = { ts: now.toISOString(), ...insights };
            }

            console.log(`ok   ${label} min ${sorted[0].price} ${currency} (${sorted.length} quotes)`);
            status.results.push({ routeId: route.id, departDate, provider: provider.name, ok: true, minPrice: sorted[0].price });
          } catch (err) {
            console.error(`fail ${label} ${err.message}`);
            status.results.push({ routeId: route.id, departDate, provider: provider.name, ok: false, error: err.message });
          }
        }
      }
      await writeJson(file, store);
    }
  } finally {
    await browser?.close();
  }
}

async function collectStays({ env, now, dataDir, providers, status }) {
  const config = await readJson(join(ROOT, 'config/stays.json'), { stays: [] });
  const currency = config.currency ?? 'JPY';

  for (const stay of config.stays) {
    if (daysUntil(stay.checkIn, now) < 0) {
      console.log(`skip ${stay.id}: チェックイン日を過ぎています`);
      continue;
    }
    const nights = nightsBetween(stay.checkIn, stay.checkOut);
    const file = join(dataDir, 'stays', `${stay.id}.json`);
    const store = await readJson(file, { stayId: stay.id, records: [] });

    for (const provider of providers) {
      const label = `${stay.id} [${provider.name}]`;
      try {
        const quotes = (await provider.fetchStayQuotes(stay, { env, currency, now }))
          .filter((q) => q.currency === currency && q.total > 0)
          .map((q) => ({
            ...q,
            perNight: q.perNight ?? Math.round(q.total / nights),
            distanceKm:
              q.latitude != null && q.longitude != null
                ? Math.round(distanceKm(stay.latitude, stay.longitude, q.latitude, q.longitude) * 100) / 100
                : null,
          }))
          // 座標が分かる宿は指定半径の外を除外する
          .filter((q) => q.distanceKm === null || q.distanceKm <= (stay.radiusKm ?? 1))
          .sort((a, b) => a.total - b.total);
        if (quotes.length === 0) throw new Error('空室・料金が取得できませんでした');

        const totals = quotes.map((q) => q.total);
        store.records.push({
          ts: now.toISOString(),
          provider: provider.name,
          currency,
          minPrice: totals[0],
          medianPrice: totals[Math.floor((totals.length - 1) / 2)],
          quoteCount: quotes.length,
          quotes: quotes.slice(0, TOP_N_STAYS).map(({ latitude, longitude, ...q }) => q),
        });
        console.log(`ok   ${label} min ${totals[0]} ${currency} (${quotes.length} hotels)`);
        status.results.push({ stayId: stay.id, provider: provider.name, ok: true, minPrice: totals[0] });
      } catch (err) {
        console.error(`fail ${label} ${err.message}`);
        status.results.push({ stayId: stay.id, provider: provider.name, ok: false, error: err.message });
      }
    }
    await writeJson(file, store);
  }
}

async function launchBrowser() {
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch({ headless: true });
  } catch (err) {
    console.error(`playwright を起動できません: ${err.message}`);
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const status = await collect();
  // 全滅した場合のみ失敗扱いにする（一部プロバイダの失敗は許容）
  if (status.results.length > 0 && status.results.every((r) => !r.ok)) process.exit(1);
}
