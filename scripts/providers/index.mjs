import * as serpapi from './serpapi.mjs';
import * as duffel from './duffel.mjs';
import * as googleScrape from './google-flights-scrape.mjs';
import * as mock from './mock.mjs';
import { allHotelProviders } from '../hotel-providers/index.mjs';

export const allProviders = [serpapi, duffel, googleScrape, mock];

/**
 * PROVIDERS=serpapi,mock のように明示されていればそれを、なければ設定済みのものを使う。
 * PROVIDERS は航空券・宿の両方に共通で、名前は両方の一覧から照合する。
 */
export function selectProviders(env, candidates = allProviders) {
  if (env.PROVIDERS) {
    const wanted = env.PROVIDERS.split(',').map((s) => s.trim()).filter(Boolean);
    const known = [...allProviders, ...allHotelProviders].map((p) => p.name);
    const unknown = wanted.filter((n) => !known.includes(n));
    if (unknown.length) throw new Error(`Unknown provider(s): ${unknown.join(', ')}`);
    return candidates.filter((p) => wanted.includes(p.name));
  }
  return candidates.filter((p) => p.isEnabled(env));
}
