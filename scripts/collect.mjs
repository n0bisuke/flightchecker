// config/routes.json の各路線について、有効なプロバイダから運賃を取得し data/prices/ に追記する。
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readJson, writeJson, daysUntil, routeDates } from './lib/util.mjs';
import { selectProviders } from './providers/index.mjs';
import { runAnalysis } from './analyze.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOP_N = 5;

export async function collect({ env = process.env, now = new Date(), dataDir = join(ROOT, 'data') } = {}) {
  const config = await readJson(join(ROOT, 'config/routes.json'));
  const currency = config.currency ?? 'JPY';
  const providers = selectProviders(env);
  if (providers.length === 0) {
    // 未設定でもサイトのデプロイまでは進められるよう、失敗にはしない
    console.warn('::warning::有効なプロバイダがありません。SERPAPI_KEY / DUFFEL_TOKEN / ENABLE_SCRAPER=1 / PROVIDERS=mock のいずれかを設定してください。');
    await runAnalysis({ dataDir, now });
    return { ts: now.toISOString(), results: [] };
  }
  console.log(`providers: ${providers.map((p) => p.name).join(', ')}`);

  const browser = providers.some((p) => p.name === 'google-scrape') ? await launchBrowser() : null;
  const status = { ts: now.toISOString(), results: [] };

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

  await writeJson(join(dataDir, 'status.json'), status);
  await runAnalysis({ dataDir, now });
  return status;
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
