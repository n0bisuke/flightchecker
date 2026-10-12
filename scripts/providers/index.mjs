import * as serpapi from './serpapi.mjs';
import * as duffel from './duffel.mjs';
import * as googleScrape from './google-flights-scrape.mjs';
import * as mock from './mock.mjs';

export const allProviders = [serpapi, duffel, googleScrape, mock];

/** PROVIDERS=serpapi,mock のように明示されていればそれを、なければ設定済みのものを使う。 */
export function selectProviders(env) {
  if (env.PROVIDERS) {
    const wanted = env.PROVIDERS.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = wanted.filter((n) => !allProviders.some((p) => p.name === n));
    if (unknown.length) throw new Error(`Unknown provider(s): ${unknown.join(', ')}`);
    return allProviders.filter((p) => wanted.includes(p.name));
  }
  return allProviders.filter((p) => p.isEnabled(env));
}
