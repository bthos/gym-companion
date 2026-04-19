import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/api/server.js';

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

test('BasicFit bundle import and site equipment filter', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-gp-'));
  const storePath = path.join(dir, 'store.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  delete process.env.GYM_COMPANION_API_KEY;
  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  const bundle = {
    id: 'prov_basicfit_test',
    slug: 'basicfit-test',
    displayName: 'Basic-Fit Test',
    gyms: {
      metadata: { city: 'TestCity', totalGyms: 2 },
      gyms: [
        { id: 1, name: 'Club One', address: 'A St' },
        { id: 2, name: 'Club Two', address: 'B St' }
      ]
    },
    equipment: {
      metadata: { totalEquipment: 2 },
      equipment: [
        { id: 'eq-a', modelCode: 'A', gyms: [1], names: { en: 'A' } },
        { id: 'eq-b', modelCode: 'B', gyms: [2], names: { en: 'B' } }
      ]
    }
  };

  const imp = await request(server, {
    path: '/api/gym-providers/import/basicfit',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bundle)
  });
  assert.equal(imp.status, 201);
  assert.equal(imp.body.data.slug, 'basicfit-test');
  assert.equal(imp.body.data.sites.length, 2);

  const eq = await request(server, {
    path: '/api/gym-providers/prov_basicfit_test/sites/basicfit_gym_1/equipment'
  });
  assert.equal(eq.status, 200);
  assert.equal(eq.body.data.count, 1);
  assert.equal(eq.body.data.equipment[0].id, 'eq-a');

  const list = await request(server, { path: '/api/gym-providers' });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
});

test('session with gymProviderId and gymSiteId', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-gp2-'));
  const storePath = path.join(dir, 'store.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  delete process.env.GYM_COMPANION_API_KEY;
  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  await request(server, {
    path: '/api/gym-providers',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'gp1',
      slug: 'chain-a',
      displayName: 'Chain A',
      sites: [{ id: 's1', name: 'Downtown', externalId: 1 }]
    })
  });

  const r = await request(server, {
    path: '/api/routines/import',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'R',
      days: [{ label: 'D', exercises: [{ id: 'ex1', name: 'E' }] }]
    })
  });
  const routineId = r.body.data.id;
  const dayId = r.body.data.days[0].id;

  const bad = await request(server, {
    path: '/api/sessions',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ routineId, dayId, gymProviderId: 'missing', gymSiteId: 's1' })
  });
  assert.equal(bad.status, 400);

  const ok = await request(server, {
    path: '/api/sessions',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ routineId, dayId, gymProviderId: 'gp1', gymSiteId: 's1' })
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.gymProviderId, 'gp1');
  assert.equal(ok.body.data.gymSiteId, 's1');
});
