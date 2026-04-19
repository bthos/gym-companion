import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyPackageEd25519 } from '../src/marketplace/signing.js';

test('verifyPackageEd25519 accepts valid detached signature', () => {
  const buf = Buffer.from('hello package');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const sig = crypto.sign(null, buf, privateKey);
  const jwk = publicKey.export({ format: 'jwk' });
  const rawPub = Buffer.from(jwk.x, 'base64url');
  const integrity = {
    ed25519Signature: sig.toString('base64'),
    ed25519PublicKey: rawPub.toString('base64')
  };
  const r = verifyPackageEd25519(buf, integrity, {});
  assert.equal(r.skipped, false);
});

test('verifyPackageEd25519 requires signature when env public key set', () => {
  const buf = Buffer.from('x');
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  const rawPub = Buffer.from(jwk.x, 'base64url');
  const env = { MARKETPLACE_SIGNING_PUBLIC_KEY_BASE64: rawPub.toString('base64') };
  assert.throws(() => verifyPackageEd25519(buf, { sha256: '0'.repeat(64) }, env), /ed25519_signature_required/);
});
