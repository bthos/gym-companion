/**
 * Build a BasicFit bundle JSON for hosting (CDN / release asset), not committed by default.
 *
 *   BASICFIT_RUTINA_ROOT=d:/Repo/basicfit-rutina node scripts/build-basicfit-seed.mjs
 *
 * Output: data/marketplace/dist/basicfit-malaga.bundle.json (override with BUNDLE_OUT=path).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultBasicfit = path.join(repoRoot, '..', 'basicfit-rutina');
const basicfitRoot = process.env.BASICFIT_RUTINA_ROOT || defaultBasicfit;

const gymsPath = path.join(basicfitRoot, 'data', 'gyms.json');
const equipmentPath = path.join(basicfitRoot, 'data', 'equipment.json');
const outPath =
  process.env.BUNDLE_OUT ||
  path.join(repoRoot, 'data', 'marketplace', 'dist', 'basicfit-malaga.bundle.json');

const gyms = JSON.parse(await fs.readFile(gymsPath, 'utf8'));
const equipment = JSON.parse(await fs.readFile(equipmentPath, 'utf8'));

const bundle = {
  id: 'gym_provider_basicfit_malaga',
  slug: 'basicfit-malaga',
  displayName: 'Basic-Fit Málaga',
  region: 'ES-MA',
  metadata: {
    seedSource: 'basicfit-rutina',
    generatedAt: new Date().toISOString()
  },
  gyms,
  equipment
};

await fs.mkdir(path.dirname(outPath), { recursive: true });
const payload = JSON.stringify(bundle);
await fs.writeFile(outPath, payload, 'utf8');
const sha = crypto.createHash('sha256').update(payload).digest('hex');
const stat = await fs.stat(outPath);
console.log('Wrote', outPath, `(${Math.round(stat.size / 1024)} KB)`);
console.log('sha256:', sha);
console.log('Set catalog download.url to this file\'s hosted URL and integrity.sha256 to the value above.');
