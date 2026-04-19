import crypto from 'node:crypto';

/**
 * Optional Ed25519 detached signature over exact package bytes (same input as sha256).
 * Manifest fields (optional): integrity.ed25519Signature (base64), integrity.ed25519PublicKey (base64, 32-byte raw key).
 * When env MARKETPLACE_SIGNING_PUBLIC_KEY_BASE64 is set, it overrides manifest public key (single trusted publisher key).
 */
export function verifyPackageEd25519(buf, integrity, env) {
  const envKeyB64 = typeof env?.MARKETPLACE_SIGNING_PUBLIC_KEY_BASE64 === 'string'
    ? env.MARKETPLACE_SIGNING_PUBLIC_KEY_BASE64.trim()
    : '';
  const sigB64 =
    typeof integrity?.ed25519Signature === 'string' ? integrity.ed25519Signature.trim() : '';
  const manifestKeyB64 =
    typeof integrity?.ed25519PublicKey === 'string' ? integrity.ed25519PublicKey.trim() : '';
  if (!sigB64 && !envKeyB64) return { ok: true, skipped: true };
  if (!sigB64) {
    const err = new Error('ed25519_signature_required_when_signing_key_configured');
    err.code = 'SIGNATURE';
    throw err;
  }
  const pubKeyB64 = envKeyB64 || manifestKeyB64;
  if (!pubKeyB64) {
    const err = new Error('ed25519_public_key_missing');
    err.code = 'SIGNATURE';
    throw err;
  }
  let pubRaw;
  let sigRaw;
  try {
    pubRaw = Buffer.from(pubKeyB64, 'base64');
    sigRaw = Buffer.from(sigB64, 'base64');
  } catch {
    const err = new Error('invalid_base64_for_ed25519');
    err.code = 'SIGNATURE';
    throw err;
  }
  if (pubRaw.length !== 32) {
    const err = new Error('ed25519_public_key_must_be_32_bytes_base64');
    err.code = 'SIGNATURE';
    throw err;
  }
  if (sigRaw.length !== 64) {
    const err = new Error('ed25519_signature_must_be_64_bytes_base64');
    err.code = 'SIGNATURE';
    throw err;
  }
  const jwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    x: pubRaw.toString('base64url')
  };
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(null, buf, key, sigRaw);
  if (!ok) {
    const err = new Error('ed25519_signature_verification_failed');
    err.code = 'SIGNATURE';
    throw err;
  }
  return { ok: true, skipped: false };
}
