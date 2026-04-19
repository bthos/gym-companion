import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/api/server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledCatalogPath = path.join(repoRoot, 'data', 'marketplace', 'catalog.json');

async function request(server, opts) {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: opts.path,
        method: opts.method || 'GET',
        headers: opts.headers || {}
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            json = body;
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('marketplace catalog and dev install', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-mp-'));
  const storePath = path.join(dir, 'store.json');
  const catalogPath = path.join(dir, 'catalog.json');
  await fs.writeFile(
    catalogPath,
    JSON.stringify({
      schemaVersion: '1',
      packages: [
        {
          packageId: 'test.pkg',
          version: '1.0.0',
          vendor: 'basicfit',
          displayName: 'Test',
          download: { url: '', format: 'basicfit-bundle' },
          integrity: {}
        }
      ]
    }),
    'utf8'
  );

  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.MARKETPLACE_CATALOG_PATH;
    delete process.env.MARKETPLACE_ALLOW_DEV_BODY;
  });

  process.env.MARKETPLACE_CATALOG_PATH = catalogPath;
  process.env.MARKETPLACE_ALLOW_DEV_BODY = '1';
  delete process.env.GYM_COMPANION_API_KEY;

  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  const cat = await request(server, { path: '/api/marketplace/catalog' });
  assert.equal(cat.status, 200);
  assert.equal(cat.body.data.packages.length, 1);

  const bundle = {
    id: 'gp_mp_test',
    slug: 'basicfit-mp-test',
    displayName: 'MP Test',
    gyms: { metadata: {}, gyms: [{ id: 1, name: 'Club' }] },
    equipment: { metadata: {}, equipment: [{ id: 'e1', gyms: [1], names: { en: 'E' } }] }
  };
  const ins = await request(server, {
    path: '/api/marketplace/install',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ basicfitBundle: bundle })
  });
  assert.equal(ins.status, 201);
  assert.equal(ins.body.data.installation.packageId, 'dev:basicfit-mp-test');

  const upd = await request(server, { path: '/api/marketplace/updates' });
  assert.equal(upd.status, 200);
  assert.ok(Array.isArray(upd.body.data.updates));

  const del = await request(server, {
    path: '/api/marketplace/installations/' + encodeURIComponent('dev:basicfit-mp-test'),
    method: 'DELETE'
  });
  assert.equal(del.status, 200);
});

test('marketplace catalog install rejects wrong sha256 (M3)', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-mp3-'));
  const storePath = path.join(dir, 'store.json');
  const bundle = {
    id: 'gp_sha',
    slug: 'sha-test',
    displayName: 'SHA',
    gyms: { metadata: {}, gyms: [{ id: 1, name: 'A' }] },
    equipment: { metadata: {}, equipment: [{ id: 'x', gyms: [1], names: { en: 'X' } }] }
  };
  const payload = JSON.stringify(bundle);
  const wrongSha = '0'.repeat(64);

  const fileSrv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(payload);
  });
  await new Promise((r) => fileSrv.listen(0, '127.0.0.1', r));
  const port = fileSrv.address().port;
  const downloadUrl = `http://127.0.0.1:${port}/pkg.json`;

  const catalogPath = path.join(dir, 'catalog.json');
  await fs.writeFile(
    catalogPath,
    JSON.stringify({
      schemaVersion: '1',
      packages: [
        {
          packageId: 'eu.test.sha',
          version: '1.0.0',
          vendor: 'basicfit',
          displayName: 'SHA test',
          download: { url: downloadUrl, format: 'basicfit-bundle' },
          integrity: { sha256: wrongSha }
        }
      ]
    }),
    'utf8'
  );

  t.after(async () => {
    await new Promise((r) => fileSrv.close(r));
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.MARKETPLACE_CATALOG_PATH;
    delete process.env.MARKETPLACE_DOWNLOAD_HOSTS;
    delete process.env.GYM_COMPANION_API_KEY;
  });

  process.env.MARKETPLACE_CATALOG_PATH = catalogPath;
  process.env.MARKETPLACE_DOWNLOAD_HOSTS = '127.0.0.1';
  delete process.env.GYM_COMPANION_API_KEY;

  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  const ins = await request(server, {
    path: '/api/marketplace/install',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ packageId: 'eu.test.sha', version: '1.0.0' })
  });
  assert.equal(ins.status, 400);
  assert.equal(ins.body.error, 'INTEGRITY');

  const goodSha = crypto.createHash('sha256').update(payload).digest('hex');
  await fs.writeFile(
    catalogPath,
    JSON.stringify({
      schemaVersion: '1',
      packages: [
        {
          packageId: 'eu.test.sha',
          version: '1.0.0',
          vendor: 'basicfit',
          displayName: 'SHA test',
          download: { url: downloadUrl, format: 'basicfit-bundle' },
          integrity: { sha256: goodSha }
        }
      ]
    }),
    'utf8'
  );

  const ok = await request(server, {
    path: '/api/marketplace/install',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ packageId: 'eu.test.sha', version: '1.0.0' })
  });
  assert.equal(ok.status, 201);
});

test('marketplace install rejects publisher not in allowlist (M5)', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-mp5-'));
  const storePath = path.join(dir, 'store.json');
  const catalogPath = path.join(dir, 'catalog.json');
  await fs.writeFile(
    catalogPath,
    JSON.stringify({
      schemaVersion: '1',
      packages: [
        {
          packageId: 'bad.pub',
          version: '1.0.0',
          vendor: 'sandbox',
          displayName: 'X',
          publisher: 'untrusted-publisher',
          download: {
            url: '',
            format: 'gym-provider-json',
            artifactPath: 'data/marketplace/samples/sandbox-gym-provider.json'
          },
          integrity: {
            sha256: '399041182bbf4bbf7c260797f7c00357ba0b3a27a136be9e95d285e38223a356'
          }
        }
      ]
    }),
    'utf8'
  );

  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.MARKETPLACE_CATALOG_PATH;
    delete process.env.MARKETPLACE_PUBLISHER_ALLOWLIST;
    delete process.env.GYM_COMPANION_API_KEY;
  });

  process.env.MARKETPLACE_CATALOG_PATH = catalogPath;
  process.env.MARKETPLACE_PUBLISHER_ALLOWLIST = 'only-this-one';
  delete process.env.GYM_COMPANION_API_KEY;

  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  const ins = await request(server, {
    path: '/api/marketplace/install',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ packageId: 'bad.pub', version: '1.0.0' })
  });
  assert.equal(ins.status, 403);
  assert.equal(ins.body.error, 'PUBLISHER');
});

test('marketplace install from bundled catalog artifactPath without remote download hosts', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-mp-art-'));
  const storePath = path.join(dir, 'store.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.MARKETPLACE_CATALOG_PATH;
    delete process.env.MARKETPLACE_DOWNLOAD_HOSTS;
    delete process.env.GYM_COMPANION_API_KEY;
  });

  process.env.MARKETPLACE_CATALOG_PATH = bundledCatalogPath;
  delete process.env.MARKETPLACE_DOWNLOAD_HOSTS;
  delete process.env.GYM_COMPANION_API_KEY;

  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  const ins = await request(server, {
    path: '/api/marketplace/install',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      packageId: 'eu.gym-companion.samples.sandbox-vendor',
      version: '1.0.0'
    })
  });
  assert.equal(ins.status, 201);
  assert.ok(ins.body.data?.installation?.providerId);

  const list = await request(server, { path: '/api/marketplace/installations' });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.data));
  assert.ok(list.body.data.some((r) => r.packageId === 'eu.gym-companion.samples.sandbox-vendor'));
});

test('marketplace uninstall blocks when sessions reference provider unless force', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-mp-un-'));
  const storePath = path.join(dir, 'store.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.MARKETPLACE_CATALOG_PATH;
    delete process.env.MARKETPLACE_DOWNLOAD_HOSTS;
    delete process.env.GYM_COMPANION_API_KEY;
  });

  process.env.MARKETPLACE_CATALOG_PATH = bundledCatalogPath;
  delete process.env.MARKETPLACE_DOWNLOAD_HOSTS;
  delete process.env.GYM_COMPANION_API_KEY;

  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  const ins = await request(server, {
    path: '/api/marketplace/install',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      packageId: 'eu.gym-companion.samples.sandbox-vendor',
      version: '1.0.0'
    })
  });
  assert.equal(ins.status, 201);
  const providerId = ins.body.data.installation.providerId;

  const imp = await request(server, {
    path: '/api/routines/import',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'MP uninstall test',
      source: 'test',
      days: [
        {
          label: 'D',
          exercises: [{ name: 'Squat', prescription: { sets: 1, reps: 1 } }]
        }
      ]
    })
  });
  assert.equal(imp.status, 201);
  const routineId = imp.body.data.id;
  const dayId = imp.body.data.days[0].id;

  const sess = await request(server, {
    path: '/api/sessions',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ routineId, dayId, gymProviderId: providerId })
  });
  assert.equal(sess.status, 201);

  const del = await request(server, {
    path:
      '/api/marketplace/installations/' +
      encodeURIComponent('eu.gym-companion.samples.sandbox-vendor'),
    method: 'DELETE'
  });
  assert.equal(del.status, 409);
  assert.equal(del.body.error, 'ACTIVE_SESSIONS');

  const delOk = await request(server, {
    path:
      '/api/marketplace/installations/' +
      encodeURIComponent('eu.gym-companion.samples.sandbox-vendor') +
      '?force=1',
    method: 'DELETE'
  });
  assert.equal(delOk.status, 200);
});

test('marketplace install by manifestUrl', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-mp-mu-'));
  const storePath = path.join(dir, 'store.json');
  const manifest = {
    packageId: 'eu.test.manifesturl',
    version: '1.0.0',
    vendor: 'sandbox',
    displayName: 'Manifest URL row',
    download: {
      url: '',
      format: 'gym-provider-json',
      artifactPath: 'data/marketplace/samples/sandbox-gym-provider.json'
    },
    integrity: {
      sha256: '399041182bbf4bbf7c260797f7c00357ba0b3a27a136be9e95d285e38223a356'
    }
  };
  const fileSrv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(manifest));
  });
  await new Promise((r) => fileSrv.listen(0, '127.0.0.1', r));
  const port = fileSrv.address().port;
  const manifestUrl = `http://127.0.0.1:${port}/pkg.json`;

  t.after(async () => {
    await new Promise((r) => fileSrv.close(r));
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.MARKETPLACE_DOWNLOAD_HOSTS;
    delete process.env.MARKETPLACE_MANIFEST_HOSTS;
    delete process.env.GYM_COMPANION_API_KEY;
  });

  process.env.MARKETPLACE_DOWNLOAD_HOSTS = '127.0.0.1';
  delete process.env.GYM_COMPANION_API_KEY;

  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  const ins = await request(server, {
    path: '/api/marketplace/install',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifestUrl })
  });
  assert.equal(ins.status, 201);
  assert.equal(ins.body.data.installation.packageId, 'eu.test.manifesturl');
});
