import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadMarketplaceCatalog(env) {
  if (env.MARKETPLACE_CATALOG_URL && env.MARKETPLACE_CATALOG_URL.trim()) {
    const res = await fetch(env.MARKETPLACE_CATALOG_URL, {
      signal: AbortSignal.timeout(15_000),
      redirect: 'manual'
    });
    if (!res.ok) {
      const err = new Error(`catalog_fetch_failed_${res.status}`);
      err.code = 'CATALOG_FETCH';
      throw err;
    }
    return res.json();
  }
  const rawPath = env.MARKETPLACE_CATALOG_PATH || '';
  const filePath = path.isAbsolute(rawPath)
    ? rawPath
    : path.join(process.cwd(), rawPath);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export function findPackageInCatalog(catalog, packageId, version) {
  const list = Array.isArray(catalog?.packages) ? catalog.packages : [];
  return list.find((p) => p.packageId === packageId && p.version === version) ?? null;
}
