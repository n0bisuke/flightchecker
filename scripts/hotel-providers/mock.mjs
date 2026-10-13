// API キー無しで動作確認するためのダミー宿泊料金。PROVIDERS=mock で明示したときのみ有効。
import { nightsBetween } from '../lib/util.mjs';

export const name = 'mock';

export function isEnabled() {
  return false;
}

export async function fetchStayQuotes(stay, { currency, now = new Date() }) {
  return mockStayQuotes(stay, currency, now);
}

export function mockStayQuotes(stay, currency, now) {
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const days = Math.max(0, (Date.parse(stay.checkIn) - now.getTime()) / 86_400_000);
  const seed = hash(`${stay.id}:${now.toISOString().slice(0, 13)}`);
  const hotels = ['駅前ビジネスホテルA', 'シティホテルB', 'ゲストハウスC', 'ホテルD 盛岡', 'ステーションホテルE'];
  return hotels.map((name, i) => {
    const perNight = Math.round((6000 + i * 1800) * (1 + Math.max(0, 60 - days) * 0.004) * (0.95 + ((seed >> i) % 11) / 100) / 100) * 100;
    return {
      name,
      total: perNight * nights,
      perNight,
      currency,
      rating: 3.5 + (i % 3) * 0.4,
      latitude: stay.latitude + i * 0.001,
      longitude: stay.longitude,
      url: null,
    };
  });
}

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
