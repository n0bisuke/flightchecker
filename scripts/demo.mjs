// モック価格で過去45日分の履歴を作り、.demo-data/ に出力する（ローカル確認用）。
// 使い方: npm run demo && DATA_DIR=.demo-data npm run serve
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { readJson, writeJson, routeDates } from './lib/util.mjs';
import { mockQuotes } from './providers/mock.mjs';
import { mockStayQuotes } from './hotel-providers/mock.mjs';
import { runAnalysis } from './analyze.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(ROOT, '.demo-data');
const config = await readJson(join(ROOT, 'config/routes.json'));
const currency = config.currency ?? 'JPY';
const now = new Date();

await rm(dataDir, { recursive: true, force: true });
for (const route of config.routes) {
  const records = [];
  for (let h = 45 * 24; h >= 0; h -= 6) {
    const at = new Date(now.getTime() - h * 3_600_000);
    for (const departDate of routeDates(route)) {
      const quotes = mockQuotes(route, departDate, currency, at).sort((a, b) => a.price - b.price);
      records.push({ ts: at.toISOString(), departDate, provider: 'mock', currency, minPrice: quotes[0].price, quoteCount: quotes.length, quotes });
    }
  }
  await writeJson(join(dataDir, 'prices', `${route.id}.json`), { routeId: route.id, records, insights: {} });
}
const stayConfig = await readJson(join(ROOT, 'config/stays.json'), { stays: [] });
for (const stay of stayConfig.stays) {
  const records = [];
  for (let h = 45 * 24; h >= 0; h -= 6) {
    const at = new Date(now.getTime() - h * 3_600_000);
    const quotes = mockStayQuotes(stay, currency, at).sort((a, b) => a.total - b.total);
    const totals = quotes.map((q) => q.total);
    records.push({
      ts: at.toISOString(), provider: 'mock', currency, minPrice: totals[0],
      medianPrice: totals[Math.floor((totals.length - 1) / 2)], quoteCount: quotes.length,
      quotes: quotes.map(({ latitude, longitude, ...q }) => ({ ...q, distanceKm: 0.3 })),
    });
  }
  await writeJson(join(dataDir, 'stays', `${stay.id}.json`), { stayId: stay.id, records });
}
await writeJson(join(dataDir, 'status.json'), { ts: now.toISOString(), results: [] });
await runAnalysis({ dataDir, now });
console.log(`demo data written to ${dataDir}`);
