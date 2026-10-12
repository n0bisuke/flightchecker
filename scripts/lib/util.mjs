import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

/** 出発日（現地日付）までの日数。出発日当日は 0。 */
export function daysUntil(dateStr, now = new Date()) {
  const depart = Date.parse(`${dateStr}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((depart - today) / 86_400_000);
}

export function toInt(value) {
  if (typeof value === 'number') return Math.round(value);
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** 空港コードを配列で返す（"HND" / ["HND","NRT"] どちらの書き方も可）。 */
export function codes(value) {
  return Array.isArray(value) ? value : [value];
}

/** 路線の出発候補日一覧。departDateFrom〜departDateTo の範囲、または単一の departDate。 */
export function routeDates(route) {
  const from = route.departDateFrom ?? route.departDate;
  const to = route.departDateTo ?? from;
  const dates = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}
