// data/prices/*.json から data/summary.json（サイト表示用）を生成する。
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readJson, writeJson } from './lib/util.mjs';
import { analyzeRoute } from './lib/analysis.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export async function runAnalysis({ dataDir = join(ROOT, 'data'), now = new Date() } = {}) {
  const config = await readJson(join(ROOT, 'config/routes.json'));
  const routes = [];
  for (const route of config.routes) {
    const store = await readJson(join(dataDir, 'prices', `${route.id}.json`), null);
    routes.push(analyzeRoute(route, store, now));
  }
  const summary = { generatedAt: now.toISOString(), currency: config.currency ?? 'JPY', routes };
  await writeJson(join(dataDir, 'summary.json'), summary);
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await runAnalysis();
  for (const r of summary.routes) {
    console.log(`${r.id}: ${r.latest?.price ?? '-'} ${summary.currency} → ${r.recommendation.action} (${r.recommendation.reason})`);
  }
}
