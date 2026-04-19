import { normalizeBasicfitBundle, normalizeGymProvider } from '../core/normalize-gym-provider.js';

/**
 * @typedef {{ ok: true, provider: object } | { ok: false, errors: string[] }} NormalizeResult
 */

/**
 * @typedef {{
 *   formats: string[],
 *   normalize: (json: object) => NormalizeResult
 * }} VendorPipeline
 */

/** @type {Record<string, VendorPipeline>} */
export const vendorPipelines = {
  basicfit: {
    formats: ['basicfit-bundle'],
    normalize(json) {
      return normalizeBasicfitBundle(json);
    }
  },
  sandbox: {
    formats: ['gym-provider-json'],
    normalize(json) {
      const body =
        json && typeof json === 'object' && json.provider && typeof json.provider === 'object'
          ? json.provider
          : json;
      return normalizeGymProvider(body);
    }
  }
};

export function getVendorPipeline(vendor) {
  const key = typeof vendor === 'string' ? vendor.trim() : '';
  return vendorPipelines[key] || null;
}

export function assertFormatSupported(pipeline, format) {
  if (!pipeline.formats.includes(format)) {
    const err = new Error(`unsupported_download_format:${format}`);
    err.code = 'FORMAT';
    throw err;
  }
}
