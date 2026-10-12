// Playwright で Google Flights の検索結果ページを開き、表示された運賃を読み取る。
// 必要な環境変数: ENABLE_SCRAPER=1（playwright と chromium のインストールが必要）
// ※ ページ構造の変更で動かなくなることがある。利用規約にも留意して低頻度で使うこと。

import { toInt, codes } from '../lib/util.mjs';

export const name = 'google-scrape';

export function isEnabled(env) {
  return env.ENABLE_SCRAPER === '1';
}

export function buildSearchUrl(route, departDate, currency) {
  // 複数空港の路線は都市名（originName / destinationName）で検索する
  const from = route.originName ?? codes(route.origin).join(',');
  const to = route.destinationName ?? codes(route.destination).join(',');
  const q = route.returnDate
    ? `Flights from ${from} to ${to} on ${departDate} through ${route.returnDate}`
    : `Flights from ${from} to ${to} on ${departDate} one way`;
  const params = new URLSearchParams({ q, curr: currency, hl: 'en', gl: 'jp' });
  return `https://www.google.com/travel/flights?${params}`;
}

export async function fetchQuotes(route, { departDate, currency, browser }) {
  if (!browser) throw new Error('browser is not available (playwright not installed?)');
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();
  try {
    await page.goto(buildSearchUrl(route, departDate, currency), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // EU 等で同意画面が出た場合
    const consent = page.getByRole('button', { name: /accept all|reject all/i }).first();
    if (await consent.isVisible().catch(() => false)) await consent.click();

    await page.waitForSelector('li:has-text("¥"), li:has-text("JP¥")', { timeout: 45_000 });
    const texts = await page.$$eval('li', (els) => els.map((el) => el.innerText));
    return { quotes: parseResultTexts(texts, currency), insights: null };
  } finally {
    await context.close();
  }
}

/** 検索結果の <li> の innerText 群から運賃を抽出する（テスト可能な純粋関数）。 */
export function parseResultTexts(texts, currency) {
  const quotes = [];
  for (const text of texts) {
    const priceMatch = /(?:JP)?¥\s?([\d,]+)/.exec(text);
    const timeMatch = /\d{1,2}:\d{2}\s?[AP]M/.exec(text);
    if (!priceMatch || !timeMatch) continue;
    const price = toInt(priceMatch[1]);
    if (!price) continue;

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => /\d{1,2}:\d{2}\s?[AP]M/.test(l));
    const airline = lines
      .slice(timeIdx + 1)
      .find((l) => !/\d/.test(l) && !/^[–-]$/.test(l) && !/nonstop|stop|separate|operated/i.test(l));

    const dur = /(\d+)\s*hr(?:\s*(\d+)\s*min)?/.exec(text);
    const stops = /nonstop/i.test(text) ? 0 : Number(/(\d+)\s*stops?/i.exec(text)?.[1] ?? NaN);

    quotes.push({
      price,
      currency,
      airline: airline ?? null,
      stops: Number.isNaN(stops) ? null : stops,
      durationMin: dur ? Number(dur[1]) * 60 + Number(dur[2] ?? 0) : null,
      departTime: timeMatch[0],
    });
  }
  return quotes;
}
