import { realpath } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_PREFIX = `data${path.sep}marketplace${path.sep}samples${path.sep}`;

/**
 * Resolve a catalog `artifactPath` (repo-relative POSIX or native) under the allowed samples dir.
 * @param {string} artifactPath
 * @param {string} cwd process.cwd() or repo root
 * @returns {Promise<string>} absolute path
 */
export async function resolveMarketplaceArtifactPath(artifactPath, cwd = process.cwd()) {
  if (typeof artifactPath !== 'string' || !artifactPath.trim()) {
    const err = new Error('artifactPath_required');
    err.code = 'ARTIFACT';
    throw err;
  }
  const normalized = artifactPath.trim().replaceAll('/', path.sep);
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    const err = new Error('artifactPath_traversal_or_absolute');
    err.code = 'ARTIFACT';
    throw err;
  }
  const abs = path.resolve(cwd, normalized);
  let real;
  try {
    real = await realpath(abs);
  } catch {
    const err = new Error('artifact_file_not_found');
    err.code = 'ARTIFACT';
    throw err;
  }
  const rel = path.relative(path.resolve(cwd), real);
  if (!rel || rel.startsWith('..') || !rel.toLowerCase().startsWith(ALLOWED_PREFIX.toLowerCase())) {
    const err = new Error('artifactPath_not_under_allowed_prefix');
    err.code = 'ARTIFACT';
    throw err;
  }
  return real;
}
