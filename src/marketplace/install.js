import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { normalizeBasicfitBundle } from '../core/normalize-gym-provider.js';
import { validateCatalogManifest, isPublisherAllowed } from './manifest.js';
import { findPackageInCatalog, loadMarketplaceCatalog } from './catalog.js';
import { resolveMarketplaceArtifactPath } from './artifact-path.js';
import { assertFormatSupported, getVendorPipeline } from './vendors.js';
import { verifyPackageEd25519 } from './signing.js';

function parseAllowedHosts(env) {
  const raw = env.MARKETPLACE_DOWNLOAD_HOSTS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function parseManifestHosts(env) {
  const raw = env.MARKETPLACE_MANIFEST_HOSTS || env.MARKETPLACE_DOWNLOAD_HOSTS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function assertDownloadHostAllowed(urlString, env) {
  const hosts = parseAllowedHosts(env);
  if (hosts.size === 0) {
    const err = new Error(
      'MARKETPLACE_DOWNLOAD_HOSTS is not configured; refusing remote package fetch (SSRF guard)'
    );
    err.code = 'DOWNLOAD_HOSTS_NOT_CONFIGURED';
    throw err;
  }
  let host;
  try {
    host = new URL(urlString).hostname.toLowerCase();
  } catch {
    const err = new Error('invalid_download_url');
    err.code = 'BAD_URL';
    throw err;
  }
  if (!hosts.has(host)) {
    const err = new Error(`download host not allowed: ${host}`);
    err.code = 'HOST_NOT_ALLOWED';
    throw err;
  }
}

function assertManifestHostAllowed(urlString, env) {
  const hosts = parseManifestHosts(env);
  if (hosts.size === 0) {
    const err = new Error(
      'MARKETPLACE_MANIFEST_HOSTS or MARKETPLACE_DOWNLOAD_HOSTS is not configured; refusing manifest fetch'
    );
    err.code = 'MANIFEST_HOSTS_NOT_CONFIGURED';
    throw err;
  }
  let h;
  try {
    h = new URL(urlString).hostname.toLowerCase();
  } catch {
    const err = new Error('invalid_manifest_url');
    err.code = 'BAD_URL';
    throw err;
  }
  if (!hosts.has(h)) {
    const err = new Error(`manifest host not allowed: ${h}`);
    err.code = 'HOST_NOT_ALLOWED';
    throw err;
  }
}

function maxPackageBytes(env) {
  const n = Number(env.MARKETPLACE_MAX_PACKAGE_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 50_000_000;
}

function logMarketplace(kind, fields) {
  try {
    console.error(JSON.stringify({ ts: new Date().toISOString(), component: 'marketplace', kind, ...fields }));
  } catch {
    // ignore
  }
}

async function fetchWithLimits(url, env, label) {
  assertDownloadHostAllowed(url, env);
  const max = maxPackageBytes(env);
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'manual' });
  if (!res.ok) {
    const err = new Error(`${label}_download_failed_${res.status}`);
    err.code = 'DOWNLOAD';
    throw err;
  }
  const cl = res.headers.get('content-length');
  if (cl != null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > max) {
      const err = new Error('package_content_length_exceeds_limit');
      err.code = 'PACKAGE_TOO_LARGE';
      throw err;
    }
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) {
    const err = new Error('package_body_exceeds_limit');
    err.code = 'PACKAGE_TOO_LARGE';
    throw err;
  }
  return buf;
}

async function fetchManifestJson(url, env) {
  assertManifestHostAllowed(url, env);
  const max = Math.min(maxPackageBytes(env), 2_000_000);
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'manual' });
  if (!res.ok) {
    const err = new Error(`manifest_fetch_failed_${res.status}`);
    err.code = 'DOWNLOAD';
    throw err;
  }
  const cl = res.headers.get('content-length');
  if (cl != null) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > max) {
      const err = new Error('manifest_content_length_exceeds_limit');
      err.code = 'PACKAGE_TOO_LARGE';
      throw err;
    }
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) {
    const err = new Error('manifest_body_exceeds_limit');
    err.code = 'PACKAGE_TOO_LARGE';
    throw err;
  }
  let json;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    const err = new Error('manifest_not_json');
    err.code = 'PARSE';
    throw err;
  }
  return json;
}

/**
 * @param {import('../store/json-store.js').createJsonStore} store
 * @param {object} bundle
 * @param {{ workspaceId?: string|null, userId?: string|null }} ctx
 */
export async function installFromDevBasicfitBundle(store, bundle, ctx = {}) {
  const normalized = normalizeBasicfitBundle(bundle);
  if (!normalized.ok) {
    const err = new Error('validation_failed');
    err.code = 'VALIDATION';
    err.details = normalized.errors;
    throw err;
  }
  const provider = { ...normalized.provider };
  if (ctx.workspaceId) provider.workspaceId = ctx.workspaceId;
  await store.upsertGymProvider(provider);
  const inst = {
    packageId: `dev:${normalized.provider.slug}`,
    version: 'dev',
    vendor: 'basicfit',
    providerId: normalized.provider.id,
    installedAt: new Date().toISOString(),
    publisher: 'dev-inline',
    integritySha256: null,
    userId: ctx.userId ?? null,
    workspaceId: ctx.workspaceId ?? null
  };
  await store.upsertInstalledPackage(inst);
  return { provider, installation: inst };
}

async function loadPackageBufferForManifest(pkg, env) {
  const url = pkg.download?.url?.trim();
  const artifactPath =
    typeof pkg.download?.artifactPath === 'string' ? pkg.download.artifactPath.trim() : '';
  if (url) {
    return fetchWithLimits(url, env, 'package');
  }
  if (artifactPath) {
    const abs = await resolveMarketplaceArtifactPath(artifactPath);
    const buf = await fs.readFile(abs);
    const max = maxPackageBytes(env);
    if (buf.length > max) {
      const err = new Error('local_package_body_exceeds_limit');
      err.code = 'PACKAGE_TOO_LARGE';
      throw err;
    }
    return buf;
  }
  const err = new Error('catalog_entry_has_no_download_url_or_artifactPath');
  err.code = 'NO_SOURCE';
  throw err;
}

/**
 * @param {import('../store/json-store.js').createJsonStore} store
 * @param {object} env
 * @param {object} pkg validated catalog row
 * @param {{ workspaceId?: string|null, userId?: string|null }} ctx
 */
export async function installFromResolvedManifestRow(store, env, pkg, ctx = {}) {
  const buf = await loadPackageBufferForManifest(pkg, env);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (!pkg.integrity || typeof pkg.integrity.sha256 !== 'string') {
    const err = new Error('integrity_sha256_required');
    err.code = 'MANIFEST';
    throw err;
  }
  if (hash.toLowerCase() !== String(pkg.integrity.sha256).toLowerCase()) {
    logMarketplace('install_integrity_mismatch', { packageId: pkg.packageId, version: pkg.version });
    const err = new Error('integrity_sha256_mismatch');
    err.code = 'INTEGRITY';
    throw err;
  }
  try {
    verifyPackageEd25519(buf, pkg.integrity, env);
  } catch (e) {
    logMarketplace('install_signature_failed', {
      packageId: pkg.packageId,
      version: pkg.version,
      message: e.message
    });
    throw e;
  }

  let json;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    const err = new Error('package_not_json');
    err.code = 'PARSE';
    throw err;
  }

  const pipeline = getVendorPipeline(pkg.vendor);
  if (!pipeline) {
    const err = new Error(`unsupported_vendor:${pkg.vendor}`);
    err.code = 'VENDOR';
    throw err;
  }
  assertFormatSupported(pipeline, pkg.download.format);
  const normalized = pipeline.normalize(json);
  if (!normalized.ok) {
    logMarketplace('install_validation_failed', {
      packageId: pkg.packageId,
      version: pkg.version,
      details: normalized.errors
    });
    const err = new Error('bundle_validation_failed');
    err.code = 'VALIDATION';
    err.details = normalized.errors;
    throw err;
  }

  const provider = { ...normalized.provider };
  if (ctx.workspaceId) provider.workspaceId = ctx.workspaceId;
  await store.upsertGymProvider(provider);
  const inst = {
    packageId: pkg.packageId,
    version: pkg.version,
    vendor: pkg.vendor,
    providerId: normalized.provider.id,
    installedAt: new Date().toISOString(),
    publisher: pkg.publisher || null,
    integritySha256: hash,
    userId: ctx.userId ?? null,
    workspaceId: ctx.workspaceId ?? null
  };
  await store.upsertInstalledPackage(inst);
  return { provider, installation: inst };
}

export async function installFromCatalogEntry(store, env, packageId, version, ctx = {}) {
  const catalog = await loadMarketplaceCatalog(env);
  const pkg = findPackageInCatalog(catalog, packageId, version);
  if (!pkg) {
    const err = new Error('package_not_found_in_catalog');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const v = validateCatalogManifest(pkg);
  if (!v.ok) {
    const err = new Error('invalid_manifest');
    err.code = 'MANIFEST';
    err.details = v.errors;
    throw err;
  }
  if (pkg.publisher && !isPublisherAllowed(env, pkg.publisher)) {
    const err = new Error('publisher_not_allowlisted');
    err.code = 'PUBLISHER';
    throw err;
  }
  try {
    return await installFromResolvedManifestRow(store, env, pkg, ctx);
  } catch (e) {
    logMarketplace('install_failed', {
      packageId,
      version,
      code: e.code,
      message: e.message
    });
    throw e;
  }
}

export async function installFromManifestUrl(store, env, manifestUrl, ctx = {}) {
  const row = await fetchManifestJson(String(manifestUrl).trim(), env);
  const v = validateCatalogManifest(row);
  if (!v.ok) {
    const err = new Error('invalid_manifest');
    err.code = 'MANIFEST';
    err.details = v.errors;
    throw err;
  }
  if (row.publisher && !isPublisherAllowed(env, row.publisher)) {
    const err = new Error('publisher_not_allowlisted');
    err.code = 'PUBLISHER';
    throw err;
  }
  try {
    return await installFromResolvedManifestRow(store, env, row, ctx);
  } catch (e) {
    logMarketplace('install_manifest_url_failed', { manifestUrl, code: e.code, message: e.message });
    throw e;
  }
}

export async function uninstallPackage(store, packageId, options = {}) {
  const force = Boolean(options.force);
  const inst = await store.getInstalledPackage(packageId);
  if (!inst) {
    const err = new Error('installation_not_found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (inst.providerId) {
    const count = await store.countSessionsWithGymProvider(inst.providerId);
    if (count > 0 && !force) {
      const err = new Error('active_sessions_refer_to_provider');
      err.code = 'ACTIVE_SESSIONS';
      err.details = { sessionCount: count };
      throw err;
    }
  }
  if (inst.providerId) await store.deleteGymProvider(inst.providerId);
  await store.removeInstalledPackage(packageId);
  return { removed: true, packageId };
}

function versionCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export async function computeUpdateMatrix(env, store) {
  const catalog = await loadMarketplaceCatalog(env);
  const packages = Array.isArray(catalog?.packages) ? catalog.packages : [];
  const installed = await store.listInstalledPackages();

  const latestByPackageId = new Map();
  for (const p of packages) {
    const id = p.packageId;
    const prev = latestByPackageId.get(id);
    if (!prev || versionCompare(p.version, prev.version) > 0) latestByPackageId.set(id, p);
  }

  const updates = [];
  for (const row of installed) {
    if (String(row.packageId).startsWith('dev:')) continue;
    const latest = latestByPackageId.get(row.packageId);
    if (!latest) {
      updates.push({
        packageId: row.packageId,
        status: 'orphaned_install',
        installedVersion: row.version
      });
    } else if (row.version !== latest.version) {
      updates.push({
        packageId: row.packageId,
        status: 'update_available',
        installedVersion: row.version,
        latestCatalogVersion: latest.version
      });
    } else {
      updates.push({
        packageId: row.packageId,
        status: 'up_to_date',
        installedVersion: row.version
      });
    }
  }
  return { catalogSchemaVersion: catalog.schemaVersion, updates };
}

export function getMarketplaceContext(req, env) {
  const scoping = ['1', 'true', 'yes'].includes(String(env.MARKETPLACE_WORKSPACE_SCOPING || '').toLowerCase());
  const raw = req.headers['x-workspace-id'];
  const workspaceId =
    scoping && typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  return { workspaceId, userId: null, scoping };
}
