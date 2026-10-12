// API キー無しで動作確認するためのダミー価格。PROVIDERS=mock で明示したときのみ有効。

export const name = 'mock';

export function isEnabled() {
  return false;
}

export async function fetchQuotes(route, { departDate, currency, now = new Date() }) {
  return { quotes: mockQuotes(route, departDate, currency, now), insights: null };
}

export function mockQuotes(route, departDate, currency, now) {
  const days = Math.max(0, (Date.parse(departDate) - now.getTime()) / 86_400_000);
  const seed = hash(`${route.id}:${departDate}:${now.toISOString().slice(0, 13)}`);
  const base = 12000 + (hash(route.id) % 20000) + (hash(departDate) % 3000);
  // 出発が近づくほど上がり、60日前前後が底になる、という緩いカーブ + ノイズ
  const curve = 1 + Math.max(0, 30 - days) * 0.025 + Math.max(0, days - 60) * 0.002;
  return ['JAL', 'ANA', 'Peach', 'Skymark'].map((airline, i) => ({
    price: Math.round((base * curve * (1 + i * 0.06) * (0.96 + ((seed >> i) % 9) / 100)) / 10) * 10,
    currency,
    airline,
    stops: 0,
    durationMin: 150 + i * 5,
    departTime: null,
  }));
}

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
