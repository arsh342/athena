/**
 * Regenerates core/src/deps/data/popular-<ecosystem>.json (top packages by downloads) from public sources.
 * Run: node --import tsx scripts/refresh-popular.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'core', 'src', 'deps', 'data');
mkdirSync(OUT, { recursive: true });
const get = async <T>(url: string): Promise<T> => {
  const r = await fetch(url, { headers: { 'user-agent': 'athena-cli refresh-popular' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
};
const save = (name: string, list: string[]) => {
  const unique = [...new Set(list)].slice(0, 5000);
  writeFileSync(join(OUT, `popular-${name}.json`), JSON.stringify(unique));
  console.log(name, unique.length);
};

const pypi = await get<{ rows: Array<{ project: string }> }>('https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json');
save('pypi', pypi.rows.map((r) => r.project.toLowerCase().replace(/[-_.]+/g, '-')));

const crates: string[] = [];
for (let page = 1; page <= 50; page += 1) {
  const r = await get<{ crates: Array<{ id: string }> }>(`https://crates.io/api/v1/crates?sort=downloads&per_page=100&page=${page}`);
  crates.push(...r.crates.map((c) => c.id));
  await new Promise((x) => setTimeout(x, 1100));
}
save('crates', crates);

const packagist: string[] = [];
for (let page = 1; page <= 50; page += 1) {
  const r = await get<{ packages: Array<{ name: string }> }>(`https://packagist.org/explore/popular.json?per_page=100&page=${page}`);
  packagist.push(...r.packages.map((p) => p.name));
}
save('packagist', packagist);

const nuget: string[] = [];
for (let skip = 0; skip < 5000; skip += 1000) {
  const r = await get<{ data: Array<{ id: string }> }>(`https://azuresearch-usnc.nuget.org/query?take=1000&skip=${skip}&prerelease=false`);
  nuget.push(...r.data.map((p) => p.id));
}
save('nuget', nuget);

// npm has no download-ranked listing. Write core/src/deps/data/popular-npm.json from the `npm-high-impact` package
// (`npm pack npm-high-impact`, then read the string arrays in lib/top-download.js, lib/top-dependent.js and lib/top.js as text,
// deduplicate, keep 5000) — do not execute the package.
