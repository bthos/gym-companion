/**
 * Lightweight manifest validation (MVP; full schema in docs/schema/).
 */
const ARTIFACT_PATH_RE = /^data\/marketplace\/samples\/[A-Za-z0-9._-]+\.json$/;

export function validateCatalogManifest(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== 'object') {
    return { ok: false, errors: ['Package must be an object'] };
  }
  for (const k of ['packageId', 'version', 'vendor', 'displayName']) {
    if (typeof pkg[k] !== 'string' || !pkg[k].trim()) errors.push(`${k} is required`);
  }
  if (!pkg.download || typeof pkg.download !== 'object') errors.push('download is required');
  else {
    if (typeof pkg.download.url !== 'string') errors.push('download.url must be a string');
    if (typeof pkg.download.format !== 'string' || !pkg.download.format.trim()) {
      errors.push('download.format is required');
    }
    if (
      pkg.download.artifactPath != null &&
      typeof pkg.download.artifactPath !== 'string'
    ) {
      errors.push('download.artifactPath must be a string when set');
    }
  }
  const urlTrim = typeof pkg.download?.url === 'string' ? pkg.download.url.trim() : '';
  const artTrim =
    typeof pkg.download?.artifactPath === 'string' ? pkg.download.artifactPath.trim() : '';
  const hasUrl = Boolean(urlTrim);
  const hasArtifact = Boolean(artTrim);

  if (!hasUrl && !hasArtifact) {
    errors.push('Either download.url or download.artifactPath is required');
  }
  if (hasUrl && hasArtifact) {
    errors.push('Provide only one of download.url or download.artifactPath');
  }
  if (hasArtifact) {
    const norm = artTrim.replaceAll('\\', '/');
    if (!ARTIFACT_PATH_RE.test(norm)) {
      errors.push(
        'download.artifactPath must be a repo-relative POSIX path under data/marketplace/samples/ ending in .json'
      );
    }
  }

  const sha = pkg.integrity && typeof pkg.integrity === 'object' ? pkg.integrity.sha256 : null;
  if (hasUrl || hasArtifact) {
    if (!pkg.integrity || typeof pkg.integrity !== 'object') errors.push('integrity is required');
    else if (typeof sha !== 'string' || !/^[a-f0-9]{64}$/i.test(sha)) {
      errors.push('integrity.sha256 must be a 64-char hex when download.url or artifactPath is set');
    }
  } else if (sha != null && String(sha).trim()) {
    if (!/^[a-f0-9]{64}$/i.test(sha)) {
      errors.push('integrity.sha256 must be a 64-char hex when provided');
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest: pkg };
}

export function isPublisherAllowed(env, publisher) {
  const raw = env.MARKETPLACE_PUBLISHER_ALLOWLIST || '';
  if (!raw.trim()) return true;
  const allowed = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return publisher && allowed.has(publisher);
}
