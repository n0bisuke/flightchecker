// site/ と data/ をまとめて GitHub Pages 用の _site/ を作る。
// DATA_DIR を指定すると別のデータディレクトリ（デモ用など）を使う。
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = join(ROOT, '_site');
const dataDir = resolve(ROOT, process.env.DATA_DIR ?? 'data');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(ROOT, 'site'), out, { recursive: true });
await cp(dataDir, join(out, 'data'), { recursive: true });
console.log(`built ${out} (data: ${dataDir})`);
