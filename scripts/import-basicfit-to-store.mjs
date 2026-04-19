/**
 * Merge a BasicFit-style bundle into the JSON store (no HTTP server).
 *
 *   STORE_PATH=./data/store.json BASICFIT_RUTINA_ROOT=../basicfit-rutina node scripts/import-basicfit-to-store.mjs
 *
 * Or pass a pre-built bundle file:
 *   STORE_PATH=./data/store.json BUNDLE_PATH=./basicfit-malaga.bundle.json node scripts/import-basicfit-to-store.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonStore } from '../src/store/json-store.js';
import { normalizeBasicfitBundle } from '../src/core/normalize-gym-provider.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const storePath = process.env.STORE_PATH || path.join(root, 'data', 'store.json');
const bundlePath = process.env.BUNDLE_PATH;
const basicfitRoot = process.env.BASICFIT_RUTINA_ROOT || path.join(root, '..', 'basicfit-rutina');

let bundle;
if (bundlePath) {
  bundle = JSON.parse(await fs.readFile(path.resolve(bundlePath), 'utf8'));
} else {
  const gyms = JSON.parse(
    await fs.readFile(path.join(basicfitRoot, 'data', 'gyms.json'), 'utf8')
  );
  const equipment = JSON.parse(
    await fs.readFile(path.join(basicfitRoot, 'data', 'equipment.json'), 'utf8')
  );
  bundle = {
    id: 'gym_provider_basicfit_malaga',
    slug: 'basicfit-malaga',
    displayName: 'Basic-Fit Málaga',
    region: 'ES-MA',
    metadata: { importSource: 'basicfit-rutina' },
    gyms,
    equipment
  };
}

const normalized = normalizeBasicfitBundle(bundle);
if (!normalized.ok) {
  console.error(normalized.errors);
  process.exit(1);
}

const store = createJsonStore(storePath);
await store.upsertGymProvider(normalized.provider);
console.log('Upserted gym provider', normalized.provider.slug, 'into', store.resolvedPath);
