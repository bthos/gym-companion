import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import crypto, { createHmac } from 'node:crypto';
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
          resolve({ status: res.statusCode, headers: res.headers, body: json, raw: body });
        });
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('health and routine import flow', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-api-'));
  const storePath = path.join(dir, 'store.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const prevKey = process.env.GYM_COMPANION_API_KEY;
  delete process.env.GYM_COMPANION_API_KEY;
  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  const h = await request(server, { path: '/health' });
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);

  const routineBody = JSON.stringify({
    name: 'Test PPL',
    source: 'test',
    days: [
      {
        label: 'Push',
        exercises: [{ name: 'Press', prescription: { sets: 3, reps: 5 } }]
      }
    ]
  });

  const imp = await request(server, {
    path: '/api/routines/import',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: routineBody
  });
  assert.equal(imp.status, 201);
  assert.ok(imp.body.data?.id);

  const list = await request(server, { path: '/api/routines' });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);

  const one = await request(server, { path: `/api/routines/${imp.body.data.id}` });
  assert.equal(one.status, 200);
  assert.equal(one.body.data.name, 'Test PPL');

  if (prevKey === undefined) delete process.env.GYM_COMPANION_API_KEY;
  else process.env.GYM_COMPANION_API_KEY = prevKey;
});

test('API key enforced when configured', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-key-'));
  const storePath = path.join(dir, 'store.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  process.env.GYM_COMPANION_API_KEY = 'secret-test-key';
  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => {
    delete process.env.GYM_COMPANION_API_KEY;
    return new Promise((r) => server.close(r));
  });

  const denied = await request(server, { path: '/api/routines' });
  assert.equal(denied.status, 401);

  const ok = await request(server, {
    path: '/api/routines',
    headers: { 'x-api-key': 'secret-test-key' }
  });
  assert.equal(ok.status, 200);
});

test('pipedream webhook verifies signature when secret set', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-pd-'));
  const storePath = path.join(dir, 'store.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const prev = process.env.GYM_COMPANION_WEBHOOK_SECRET;
  const prevKey = process.env.GYM_COMPANION_API_KEY;
  delete process.env.GYM_COMPANION_API_KEY;
  process.env.GYM_COMPANION_WEBHOOK_SECRET = 'whsec';
  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => {
    process.env.GYM_COMPANION_WEBHOOK_SECRET = prev;
    process.env.GYM_COMPANION_API_KEY = prevKey;
    return new Promise((r) => server.close(r));
  });

  const raw = JSON.stringify({
    name: 'Webhook Routine',
    days: [{ label: 'D1', exercises: [{ name: 'Squat' }] }]
  });
  const mac = createHmac('sha256', 'whsec').update(raw).digest('hex');

  const bad = await request(server, {
    path: '/api/webhooks/pipedream',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw
  });
  assert.equal(bad.status, 401);

  const good = await request(server, {
    path: '/api/webhooks/pipedream',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-gym-signature': `sha256=${mac}`
    },
    body: raw
  });
  assert.equal(good.status, 201);
});

test('session create and patch', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-sess-'));
  const storePath = path.join(dir, 'store.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  delete process.env.GYM_COMPANION_API_KEY;
  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  const imp = await request(server, {
    path: '/api/routines/import',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'SessRoutine',
      days: [{ id: 'day1', label: 'A', exercises: [{ id: 'ex1', name: 'Lift' }] }]
    })
  });
  const routineId = imp.body.data.id;
  const dayId = imp.body.data.days[0].id;

  const sess = await request(server, {
    path: '/api/sessions',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ routineId, dayId })
  });
  assert.equal(sess.status, 201);
  const sid = sess.body.data.id;

  const patched = await request(server, {
    path: `/api/sessions/${sid}`,
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appendSet: { exerciseId: 'ex1', reps: 10, loadKg: 40 },
      status: 'completed'
    })
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.performedSets.length, 1);
  assert.ok(patched.body.data.finishedAt);
});

test('import idempotency returns cached response', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-idem-'));
  const storePath = path.join(dir, 'store.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  delete process.env.GYM_COMPANION_API_KEY;
  const { server } = createApp(storePath);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise((r) => server.close(r)));

  const key = crypto.randomUUID();
  const body = JSON.stringify({
    name: 'IdemRoutine',
    days: [{ label: 'D', exercises: [{ name: 'A' }] }]
  });
  const a = await request(server, {
    path: '/api/routines/import',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body
  });
  const b = await request(server, {
    path: '/api/routines/import',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({
      name: 'Different',
      days: [{ label: 'D', exercises: [{ name: 'B' }] }]
    })
  });
  assert.deepEqual(a.body, b.body);
});
