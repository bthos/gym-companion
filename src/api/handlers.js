import crypto, { timingSafeEqual } from 'node:crypto';
import { normalizeRoutineImport } from '../core/normalize-import.js';
import { normalizeGymProvider, normalizeBasicfitBundle } from '../core/normalize-gym-provider.js';
import { filterEquipmentForSite, resolveSiteExternalId } from '../core/site-equipment.js';
import { readRequestBody } from './read-body.js';
import { exchangeCodeForTokens, buildAuthorizeUrl } from '../integrations/google-fit/oauth.js';
import { syncGoogleFitSessions } from '../integrations/google-fit/sync.js';
import { loadMarketplaceCatalog } from '../marketplace/catalog.js';
import {
  installFromCatalogEntry,
  installFromDevBasicfitBundle,
  installFromManifestUrl,
  uninstallPackage,
  computeUpdateMatrix,
  getMarketplaceContext
} from '../marketplace/install.js';

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function expiresAtFromTokenResponse(tokenJson) {
  const sec = Number(tokenJson.expires_in);
  if (!Number.isFinite(sec)) return Date.now() + 3_600_000;
  return Date.now() + sec * 1000;
}

function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret) return true;
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const theirs = signatureHeader.slice(prefix.length);
  let theirBuf;
  try {
    theirBuf = Buffer.from(theirs, 'hex');
  } catch {
    return false;
  }
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const ours = hmac.digest();
  if (theirBuf.length !== ours.length) return false;
  return timingSafeEqual(theirBuf, ours);
}

function getApiKey(req) {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header) return header;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

export function isPublicWithoutApiKey(pathname) {
  if (pathname === '/health') return true;
  if (pathname === '/api/integrations/google-fit/oauth/callback') return true;
  if (pathname === '/api/webhooks/pipedream') return true;
  return false;
}

export function createHandlers({ store, env }) {
  const apiKey = env.GYM_COMPANION_API_KEY || '';
  const webhookSecret = env.GYM_COMPANION_WEBHOOK_SECRET || '';

  async function requireApiKey(req, res, pathname) {
    if (!apiKey) return true;
    if (isPublicWithoutApiKey(pathname)) return true;
    const key = getApiKey(req);
    const kb = Buffer.from(key || '', 'utf8');
    const eb = Buffer.from(apiKey, 'utf8');
    if (kb.length === eb.length && kb.length > 0 && timingSafeEqual(kb, eb)) return true;
    json(res, 401, { error: 'Unauthorized', message: 'Invalid or missing API key' });
    return false;
  }

  return {
    async healthcheck(_req, res) {
      json(res, 200, { ok: true, service: 'gym-companion-api' });
    },

    async listRoutines(req, res, _url) {
      if (!(await requireApiKey(req, res, '/api/routines'))) return;
      const data = await store.listRoutines();
      json(res, 200, { data });
    },

    async getRoutine(req, res, _url, params) {
      if (!(await requireApiKey(req, res, `/api/routines/${params.routineId}`))) return;
      const routine = await store.getRoutine(params.routineId);
      if (!routine) {
        json(res, 404, { error: 'Not found' });
        return;
      }
      json(res, 200, { data: routine });
    },

    async createRoutine(req, res) {
      if (!(await requireApiKey(req, res, '/api/routines'))) return;
      let raw;
      try {
        raw = await readRequestBody(req);
      } catch (e) {
        if (e.code === 'PAYLOAD_TOO_LARGE') {
          json(res, 413, { error: 'Payload too large' });
          return;
        }
        throw e;
      }
      let body;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }
      const normalized = normalizeRoutineImport(body, { source: 'api' });
      if (!normalized.ok) {
        json(res, 400, { error: 'Validation failed', details: normalized.errors });
        return;
      }
      const existing = await store.getRoutine(normalized.routine.id);
      if (existing) {
        json(res, 409, { error: 'Conflict', message: 'Routine id already exists' });
        return;
      }
      await store.createRoutine(normalized.routine);
      json(res, 201, { data: normalized.routine });
    },

    async importRoutine(req, res) {
      if (!(await requireApiKey(req, res, '/api/routines/import'))) return;
      const idemKey = req.headers['idempotency-key'];
      if (idemKey) {
        const prev = await store.getIdempotency(String(idemKey));
        if (prev?.response) {
          json(res, prev.status ?? 200, prev.response);
          return;
        }
      }

      let raw;
      try {
        raw = await readRequestBody(req);
      } catch (e) {
        if (e.code === 'PAYLOAD_TOO_LARGE') {
          json(res, 413, { error: 'Payload too large' });
          return;
        }
        throw e;
      }
      let body;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }
      const normalized = normalizeRoutineImport(body, { source: body?.source || 'import' });
      if (!normalized.ok) {
        json(res, 400, { error: 'Validation failed', details: normalized.errors });
        return;
      }
      await store.upsertRoutine(normalized.routine);
      const response = { data: normalized.routine, status: 'imported' };
      const status = 201;
      if (idemKey) {
        await store.setIdempotency(String(idemKey), { response, status, createdAt: Date.now() });
      }
      json(res, status, response);
    },

    async createSession(req, res) {
      if (!(await requireApiKey(req, res, '/api/sessions'))) return;
      let raw;
      try {
        raw = await readRequestBody(req);
      } catch (e) {
        if (e.code === 'PAYLOAD_TOO_LARGE') {
          json(res, 413, { error: 'Payload too large' });
          return;
        }
        throw e;
      }
      let body;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }
      const routineId = typeof body?.routineId === 'string' ? body.routineId : null;
      const dayId = typeof body?.dayId === 'string' ? body.dayId : null;
      if (!routineId) {
        json(res, 400, { error: 'routineId is required' });
        return;
      }
      const routine = await store.getRoutine(routineId);
      if (!routine) {
        json(res, 404, { error: 'Routine not found' });
        return;
      }
      let resolvedDayId = dayId;
      if (!resolvedDayId && Array.isArray(routine.days) && routine.days.length) {
        resolvedDayId = routine.days[0].id;
      }
      if (!resolvedDayId) {
        json(res, 400, { error: 'dayId is required for this routine' });
        return;
      }
      const day = routine.days?.find((d) => d.id === resolvedDayId);
      if (!day) {
        json(res, 400, { error: 'dayId not found on routine' });
        return;
      }
      const gymProviderId =
        typeof body?.gymProviderId === 'string' && body.gymProviderId.trim()
          ? body.gymProviderId.trim()
          : null;
      const gymSiteId =
        typeof body?.gymSiteId === 'string' && body.gymSiteId.trim()
          ? body.gymSiteId.trim()
          : null;
      if (gymProviderId) {
        const provider = await store.getGymProvider(gymProviderId);
        if (!provider) {
          json(res, 400, { error: 'gymProviderId not found' });
          return;
        }
        if (gymSiteId) {
          const site = provider.sites?.find((s) => s.id === gymSiteId);
          if (!site) {
            json(res, 400, { error: 'gymSiteId not found on provider' });
            return;
          }
        }
      } else if (gymSiteId) {
        json(res, 400, { error: 'gymSiteId requires gymProviderId' });
        return;
      }

      const session = {
        id: crypto.randomUUID(),
        routineId,
        dayId: resolvedDayId,
        gymProviderId: gymProviderId || undefined,
        gymSiteId: gymSiteId || undefined,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        performedSets: []
      };
      await store.upsertSession(session);
      json(res, 201, { data: session });
    },

    async patchSession(req, res, _url, params) {
      if (!(await requireApiKey(req, res, `/api/sessions/${params.sessionId}`))) return;
      let raw;
      try {
        raw = await readRequestBody(req);
      } catch (e) {
        if (e.code === 'PAYLOAD_TOO_LARGE') {
          json(res, 413, { error: 'Payload too large' });
          return;
        }
        throw e;
      }
      let body;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }
      const session = await store.getSession(params.sessionId);
      if (!session) {
        json(res, 404, { error: 'Session not found' });
        return;
      }
      if (body?.appendSet) {
        const s = body.appendSet;
        const exerciseId = typeof s.exerciseId === 'string' ? s.exerciseId : null;
        if (!exerciseId) {
          json(res, 400, { error: 'appendSet.exerciseId is required' });
          return;
        }
        const entry = {
          exerciseId,
          setIndex: Number.isFinite(Number(s.setIndex)) ? Number(s.setIndex) : session.performedSets.length,
          reps: Number.isFinite(Number(s.reps)) ? Number(s.reps) : null,
          loadKg: s.loadKg == null ? null : Number(s.loadKg),
          notes: typeof s.notes === 'string' ? s.notes : '',
          loggedAt: new Date().toISOString()
        };
        session.performedSets.push(entry);
      }
      if (typeof body?.finishedAt === 'string') {
        session.finishedAt = body.finishedAt;
      } else if (body?.status === 'completed') {
        session.finishedAt = new Date().toISOString();
      }
      await store.upsertSession(session);
      json(res, 200, { data: session });
    },

    async listGymProviders(req, res, url) {
      if (!(await requireApiKey(req, res, '/api/gym-providers'))) return;
      let data = await store.listGymProviders();
      const scoping = ['1', 'true', 'yes'].includes(
        String(env.MARKETPLACE_WORKSPACE_SCOPING || '').toLowerCase()
      );
      if (scoping && url) {
        const ws = url.searchParams.get('workspaceId');
        if (ws) data = data.filter((p) => p.workspaceId === ws);
      }
      json(res, 200, { data });
    },

    async getGymProvider(req, res, _url, params) {
      if (!(await requireApiKey(req, res, `/api/gym-providers/${params.providerId}`))) return;
      const p = await store.getGymProvider(params.providerId);
      if (!p) {
        json(res, 404, { error: 'Not found' });
        return;
      }
      json(res, 200, { data: p });
    },

    async createGymProvider(req, res) {
      if (!(await requireApiKey(req, res, '/api/gym-providers'))) return;
      let raw;
      try {
        raw = await readRequestBody(req);
      } catch (e) {
        if (e.code === 'PAYLOAD_TOO_LARGE') {
          json(res, 413, { error: 'Payload too large' });
          return;
        }
        throw e;
      }
      let body;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }
      const normalized = normalizeGymProvider(body);
      if (!normalized.ok) {
        json(res, 400, { error: 'Validation failed', details: normalized.errors });
        return;
      }
      const bySlug = await store.getGymProviderBySlug(normalized.provider.slug);
      if (bySlug) {
        json(res, 409, { error: 'Conflict', message: 'slug already exists' });
        return;
      }
      const existing = await store.getGymProvider(normalized.provider.id);
      if (existing) {
        json(res, 409, { error: 'Conflict', message: 'id already exists' });
        return;
      }
      await store.createGymProvider(normalized.provider);
      json(res, 201, { data: normalized.provider });
    },

    async patchGymProvider(req, res, _url, params) {
      if (!(await requireApiKey(req, res, `/api/gym-providers/${params.providerId}`))) return;
      const cur = await store.getGymProvider(params.providerId);
      if (!cur) {
        json(res, 404, { error: 'Not found' });
        return;
      }
      let raw;
      try {
        raw = await readRequestBody(req);
      } catch (e) {
        if (e.code === 'PAYLOAD_TOO_LARGE') {
          json(res, 413, { error: 'Payload too large' });
          return;
        }
        throw e;
      }
      let body;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }
      if (!body || typeof body !== 'object') {
        json(res, 400, { error: 'Body must be an object' });
        return;
      }
      const patch = {};
      for (const k of ['displayName', 'brandKey', 'region', 'slug']) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      if (body.sites !== undefined) patch.sites = body.sites;
      if (body.equipmentCatalog !== undefined) patch.equipmentCatalog = body.equipmentCatalog;
      if (body.metadata !== undefined) patch.metadata = body.metadata;
      await store.patchGymProvider(params.providerId, patch);
      const next = await store.getGymProvider(params.providerId);
      json(res, 200, { data: next });
    },

    async importBasicfitGymProvider(req, res) {
      if (!(await requireApiKey(req, res, '/api/gym-providers/import/basicfit'))) return;
      let raw;
      try {
        raw = await readRequestBody(req);
      } catch (e) {
        if (e.code === 'PAYLOAD_TOO_LARGE') {
          json(res, 413, { error: 'Payload too large' });
          return;
        }
        throw e;
      }
      let body;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }
      const normalized = normalizeBasicfitBundle(body);
      if (!normalized.ok) {
        json(res, 400, { error: 'Validation failed', details: normalized.errors });
        return;
      }
      const bySlug = await store.getGymProviderBySlug(normalized.provider.slug);
      if (bySlug && bySlug.id !== normalized.provider.id) {
        json(res, 409, { error: 'Conflict', message: 'slug already used by another provider' });
        return;
      }
      await store.upsertGymProvider(normalized.provider);
      json(res, 201, { data: normalized.provider, status: 'imported' });
    },

    async getSiteEquipment(req, res, _url, params) {
      if (
        !(await requireApiKey(
          req,
          res,
          `/api/gym-providers/${params.providerId}/sites/${params.siteId}/equipment`
        ))
      ) {
        return;
      }
      const provider = await store.getGymProvider(params.providerId);
      if (!provider) {
        json(res, 404, { error: 'Provider not found' });
        return;
      }
      const site = provider.sites?.find((s) => s.id === params.siteId);
      if (!site) {
        json(res, 404, { error: 'Site not found' });
        return;
      }
      const ext = resolveSiteExternalId(site);
      if (ext == null) {
        json(res, 400, {
          error: 'Site has no externalId; cannot match catalog gyms[] ids'
        });
        return;
      }
      const items = filterEquipmentForSite(provider.equipmentCatalog, ext);
      json(res, 200, {
        data: {
          providerId: provider.id,
          siteId: site.id,
          siteExternalId: ext,
          count: items.length,
          equipment: items
        }
      });
    },

    async pipedreamWebhook(req, res) {
      const idemKey = req.headers['idempotency-key'];
      if (idemKey) {
        const prev = await store.getIdempotency(String(idemKey));
        if (prev?.response) {
          json(res, prev.status ?? 200, prev.response);
          return;
        }
      }

      let raw;
      try {
        raw = await readRequestBody(req);
      } catch (e) {
        if (e.code === 'PAYLOAD_TOO_LARGE') {
          json(res, 413, { error: 'Payload too large' });
          return;
        }
        throw e;
      }
      const sig = req.headers['x-gym-signature'];
      if (!verifyWebhookSignature(raw, sig, webhookSecret)) {
        json(res, 401, { error: 'Invalid webhook signature' });
        return;
      }

      let body;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }
      const payload = body?.routine ?? body;
      const normalized = normalizeRoutineImport(payload, { source: body?.source || 'pipedream' });
      if (!normalized.ok) {
        json(res, 400, { error: 'Validation failed', details: normalized.errors });
        return;
      }
      await store.upsertRoutine(normalized.routine);
      const response = { data: normalized.routine, status: 'imported' };
      const status = 201;
      if (idemKey) {
        await store.setIdempotency(String(idemKey), { response, status, createdAt: Date.now() });
      }
      json(res, status, response);
    },

    async googleFitStatus(req, res) {
      if (!(await requireApiKey(req, res, '/api/integrations/google-fit/status'))) return;
      const st = await store.getGoogleFitState();
      json(res, 200, {
        connected: Boolean(st?.refreshToken || st?.accessToken),
        expiresAt: st?.expiresAt ?? null,
        scope: st?.scope ?? null
      });
    },

    async googleFitOauthStart(req, res) {
      if (!(await requireApiKey(req, res, '/api/integrations/google-fit/oauth/start'))) return;
      const clientId = env.GOOGLE_FIT_CLIENT_ID;
      const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;
      if (!clientId || !redirectUri) {
        json(res, 503, {
          error: 'Google Fit OAuth is not configured',
          missing: [
            !clientId ? 'GOOGLE_FIT_CLIENT_ID' : null,
            !redirectUri ? 'GOOGLE_OAUTH_REDIRECT_URI' : null
          ].filter(Boolean)
        });
        return;
      }
      const state = crypto.randomUUID();
      await store.setOauthPending({ state, createdAt: Date.now() });
      const url = buildAuthorizeUrl({ clientId, redirectUri, state });
      json(res, 200, { url });
    },

    async googleFitOauthCallback(req, res, url) {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const errParam = url.searchParams.get('error');
      if (errParam) {
        json(res, 400, { error: 'OAuth error', details: errParam });
        return;
      }
      if (!code || !state) {
        json(res, 400, { error: 'Missing code or state' });
        return;
      }
      const pending = await store.getOauthPending();
      const maxAge = 900_000;
      if (!pending?.state || pending.state !== state) {
        json(res, 400, { error: 'Invalid OAuth state' });
        return;
      }
      if (Date.now() - (pending.createdAt || 0) > maxAge) {
        await store.clearOauthPending();
        json(res, 400, { error: 'OAuth state expired' });
        return;
      }

      const clientId = env.GOOGLE_FIT_CLIENT_ID;
      const clientSecret = env.GOOGLE_FIT_CLIENT_SECRET;
      const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;
      if (!clientId || !clientSecret || !redirectUri) {
        json(res, 503, { error: 'Google Fit OAuth is not fully configured' });
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens({
          clientId,
          clientSecret,
          redirectUri,
          code
        });
        await store.setGoogleFitState({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt: expiresAtFromTokenResponse(tokens),
          scope: tokens.scope || null
        });
        await store.clearOauthPending();
        json(res, 200, { ok: true, connected: true });
      } catch (e) {
        json(res, 400, {
          error: 'Token exchange failed',
          message: e.message,
          details: e.details
        });
      }
    },

    async googleFitSync(req, res) {
      if (!(await requireApiKey(req, res, '/api/integrations/google-fit/sync'))) return;
      let body = {};
      try {
        const raw = await readRequestBody(req);
        if (raw) body = JSON.parse(raw);
      } catch (e) {
        if (e instanceof SyntaxError) {
          json(res, 400, { error: 'Invalid JSON' });
          return;
        }
        if (e.code === 'PAYLOAD_TOO_LARGE') {
          json(res, 413, { error: 'Payload too large' });
          return;
        }
        throw e;
      }
      const startMs = body.startTimeMillis != null ? Number(body.startTimeMillis) : undefined;
      const endMs = body.endTimeMillis != null ? Number(body.endTimeMillis) : undefined;
      try {
        const result = await syncGoogleFitSessions(
          store,
          {
            clientId: env.GOOGLE_FIT_CLIENT_ID,
            clientSecret: env.GOOGLE_FIT_CLIENT_SECRET
          },
          { startMs, endMs }
        );
        json(res, 200, { ok: true, ...result });
      } catch (e) {
        if (e.code === 'NOT_CONNECTED') {
          json(res, 400, { error: 'Google Fit is not connected' });
          return;
        }
        if (e.code === 'NOT_CONFIGURED') {
          json(res, 503, { error: 'Google Fit client credentials are not configured' });
          return;
        }
        json(res, 502, { error: 'Sync failed', message: e.message });
      }
    },

    async marketplaceCatalog(req, res) {
      if (!(await requireApiKey(req, res, '/api/marketplace/catalog'))) return;
      try {
        const catalog = await loadMarketplaceCatalog(env);
        json(res, 200, { data: catalog });
      } catch (e) {
        const code = e?.code === 'ENOENT' ? 404 : 502;
        json(res, code, { error: 'catalog_unavailable', message: e?.message });
      }
    },

    async marketplaceInstallations(req, res, url) {
      if (!(await requireApiKey(req, res, '/api/marketplace/installations'))) return;
      const rows = await store.listInstalledPackages();
      const scoping = ['1', 'true', 'yes'].includes(
        String(env.MARKETPLACE_WORKSPACE_SCOPING || '').toLowerCase()
      );
      let data = rows;
      if (scoping && url) {
        const ws = url.searchParams.get('workspaceId');
        if (ws) data = rows.filter((r) => r.workspaceId === ws);
      }
      json(res, 200, { data });
    },

    async marketplaceUpdates(req, res) {
      if (!(await requireApiKey(req, res, '/api/marketplace/updates'))) return;
      try {
        const data = await computeUpdateMatrix(env, store);
        json(res, 200, { data });
      } catch (e) {
        json(res, 502, { error: 'updates_unavailable', message: e?.message });
      }
    },

    async marketplaceInstall(req, res) {
      if (!(await requireApiKey(req, res, '/api/marketplace/install'))) return;
      let raw;
      try {
        raw = await readRequestBody(req);
      } catch (e) {
        if (e.code === 'PAYLOAD_TOO_LARGE') {
          json(res, 413, { error: 'Payload too large' });
          return;
        }
        throw e;
      }
      let body;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }
      const allowDev = ['1', 'true', 'yes'].includes(
        String(env.MARKETPLACE_ALLOW_DEV_BODY || '').toLowerCase()
      );
      const ctx = getMarketplaceContext(req, env);
      try {
        if (allowDev && body?.basicfitBundle && typeof body.basicfitBundle === 'object') {
          const result = await installFromDevBasicfitBundle(store, body.basicfitBundle, ctx);
          json(res, 201, { data: result, status: 'installed' });
          return;
        }
        const manifestUrl =
          typeof body?.manifestUrl === 'string' ? body.manifestUrl.trim() : '';
        if (manifestUrl) {
          const result = await installFromManifestUrl(store, env, manifestUrl, ctx);
          json(res, 201, { data: result, status: 'installed' });
          return;
        }
        const packageId = typeof body?.packageId === 'string' ? body.packageId.trim() : '';
        const version = typeof body?.version === 'string' ? body.version.trim() : '';
        if (!packageId || !version) {
          json(res, 400, {
            error: 'packageId_and_version_required',
            hint: allowDev
              ? 'Or set MARKETPLACE_ALLOW_DEV_BODY=1 and send { basicfitBundle } for local testing.'
              : 'Set MARKETPLACE_ALLOW_DEV_BODY=1 for { basicfitBundle } installs in dev/test.'
          });
          return;
        }
        const result = await installFromCatalogEntry(store, env, packageId, version, ctx);
        json(res, 201, { data: result, status: 'installed' });
      } catch (e) {
        const map = {
          NOT_FOUND: 404,
          MANIFEST: 400,
          VALIDATION: 400,
          PUBLISHER: 403,
          NO_SOURCE: 422,
          DOWNLOAD_HOSTS_NOT_CONFIGURED: 503,
          MANIFEST_HOSTS_NOT_CONFIGURED: 503,
          HOST_NOT_ALLOWED: 403,
          BAD_URL: 400,
          DOWNLOAD: 502,
          INTEGRITY: 400,
          PARSE: 400,
          VENDOR: 400,
          FORMAT: 400,
          PACKAGE_TOO_LARGE: 413,
          ARTIFACT: 400,
          SIGNATURE: 400
        };
        const status = map[e.code] || 400;
        json(res, status, {
          error: e.code || 'install_failed',
          message: e.message,
          details: e.details
        });
      }
    },

    async marketplaceUninstall(req, res, url, params) {
      const packageId = decodeURIComponent(params.packageId);
      if (!(await requireApiKey(req, res, `/api/marketplace/installations/${packageId}`))) {
        return;
      }
      const force = ['1', 'true', 'yes'].includes(
        String(url?.searchParams.get('force') || '').toLowerCase()
      );
      try {
        const result = await uninstallPackage(store, packageId, { force });
        json(res, 200, { data: result });
      } catch (e) {
        if (e.code === 'NOT_FOUND') {
          json(res, 404, { error: 'Not found' });
          return;
        }
        if (e.code === 'ACTIVE_SESSIONS') {
          json(res, 409, {
            error: e.code,
            message: e.message,
            details: e.details,
            hint: 'Retry with ?force=1 to remove the provider despite active sessions (sessions keep gymProviderId pointing at a deleted provider).'
          });
          return;
        }
        json(res, 400, { error: e.code || 'uninstall_failed', message: e.message });
      }
    }
  };
}
