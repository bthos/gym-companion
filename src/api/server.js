import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createJsonStore } from '../store/json-store.js';
import { createHandlers } from './handlers.js';
import { buildRouter } from './router.js';

export function getEnv() {
  return {
    GYM_COMPANION_API_KEY: process.env.GYM_COMPANION_API_KEY || '',
    GYM_COMPANION_WEBHOOK_SECRET: process.env.GYM_COMPANION_WEBHOOK_SECRET || '',
    GOOGLE_FIT_CLIENT_ID: process.env.GOOGLE_FIT_CLIENT_ID || '',
    GOOGLE_FIT_CLIENT_SECRET: process.env.GOOGLE_FIT_CLIENT_SECRET || '',
    GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI || '',
    MARKETPLACE_CATALOG_URL: process.env.MARKETPLACE_CATALOG_URL || '',
    MARKETPLACE_CATALOG_PATH:
      process.env.MARKETPLACE_CATALOG_PATH ||
      path.join(process.cwd(), 'data', 'marketplace', 'catalog.json'),
    MARKETPLACE_DOWNLOAD_HOSTS: process.env.MARKETPLACE_DOWNLOAD_HOSTS || '',
    MARKETPLACE_MANIFEST_HOSTS: process.env.MARKETPLACE_MANIFEST_HOSTS || '',
    MARKETPLACE_PUBLISHER_ALLOWLIST: process.env.MARKETPLACE_PUBLISHER_ALLOWLIST || '',
    MARKETPLACE_ALLOW_DEV_BODY: process.env.MARKETPLACE_ALLOW_DEV_BODY || '',
    MARKETPLACE_MAX_PACKAGE_BYTES: process.env.MARKETPLACE_MAX_PACKAGE_BYTES || '',
    MARKETPLACE_WORKSPACE_SCOPING: process.env.MARKETPLACE_WORKSPACE_SCOPING || '',
    MARKETPLACE_SIGNING_PUBLIC_KEY_BASE64: process.env.MARKETPLACE_SIGNING_PUBLIC_KEY_BASE64 || '',
    MARKETPLACE_CORS_ORIGINS: process.env.MARKETPLACE_CORS_ORIGINS || ''
  };
}

function parseCorsAllowedOrigins(env) {
  const raw = env.MARKETPLACE_CORS_ORIGINS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/** @returns {Record<string, string> | null} */
function corsHeadersForRequest(req, env) {
  const origin = req.headers.origin;
  if (!origin || typeof origin !== 'string') return null;
  const allowed = parseCorsAllowedOrigins(env);
  if (!allowed.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, Idempotency-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

export function createApp(storePath) {
  const store = createJsonStore(storePath);
  const env = getEnv();
  const handlers = createHandlers({ store, env });
  const match = buildRouter(handlers);

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || 'localhost';
      const url = new URL(req.url || '/', `http://${host}`);
      const pathname = url.pathname;
      const cors = corsHeadersForRequest(req, env);
      if (cors && req.method === 'OPTIONS' && pathname.startsWith('/api')) {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (cors) {
        const origWriteHead = res.writeHead.bind(res);
        res.writeHead = (code, msgOrHeaders, maybeHeaders) => {
          if (typeof msgOrHeaders === 'string') {
            const headers = { ...cors, ...(maybeHeaders && typeof maybeHeaders === 'object' ? maybeHeaders : {}) };
            return origWriteHead(code, msgOrHeaders, headers);
          }
          const headers = { ...cors, ...(msgOrHeaders && typeof msgOrHeaders === 'object' ? msgOrHeaders : {}) };
          return origWriteHead(code, headers);
        };
      }
      const route = match(req.method || 'GET', pathname);
      if (!route) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      await route.handler(req, res, url, route.params || {});
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Internal error', message: err?.message }));
    }
  });

  return { server, store };
}

const defaultStorePath = path.join(process.cwd(), 'data', 'store.json');
const storePath = process.env.STORE_PATH || defaultStorePath;
const port = Number(process.env.PORT) || 3000;

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
const isMainModule = entryHref === import.meta.url;

if (isMainModule) {
  const { server } = createApp(storePath);
  server.listen(port, () => {
    console.log(`Gym Companion API listening on :${port}`);
  });
}
