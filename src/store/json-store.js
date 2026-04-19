import fs from 'node:fs/promises';
import path from 'node:path';

const defaultShape = () => ({
  routines: [],
  gymProviders: [],
  installedPackages: [],
  sessions: [],
  idempotency: {},
  oauthPending: null,
  integrationState: {
    googleFit: null
  },
  externalActivities: []
});

export function createJsonStore(filePath) {
  const resolved = path.resolve(filePath);
  let cache = null;
  let writeChain = Promise.resolve();

  async function readDisk() {
    try {
      const raw = await fs.readFile(resolved, 'utf8');
      const parsed = JSON.parse(raw);
      const base = defaultShape();
      return {
        ...base,
        ...parsed,
        routines: Array.isArray(parsed.routines) ? parsed.routines : [],
        gymProviders: Array.isArray(parsed.gymProviders) ? parsed.gymProviders : [],
        installedPackages: Array.isArray(parsed.installedPackages)
          ? parsed.installedPackages
          : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        idempotency:
          parsed.idempotency && typeof parsed.idempotency === 'object'
            ? parsed.idempotency
            : {},
        integrationState: {
          ...base.integrationState,
          ...(parsed.integrationState && typeof parsed.integrationState === 'object'
            ? parsed.integrationState
            : {}),
          googleFit:
            parsed.integrationState?.googleFit === undefined
              ? null
              : parsed.integrationState.googleFit
        },
        externalActivities: Array.isArray(parsed.externalActivities)
          ? parsed.externalActivities
          : [],
        oauthPending:
          parsed.oauthPending && typeof parsed.oauthPending === 'object'
            ? parsed.oauthPending
            : null
      };
    } catch (err) {
      if (err && err.code === 'ENOENT') return defaultShape();
      throw err;
    }
  }

  async function load() {
    if (!cache) cache = await readDisk();
    return cache;
  }

  async function persist() {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const tmp = `${resolved}.${process.pid}.tmp`;
    const payload = JSON.stringify(cache, null, 2);
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, resolved);
  }

  function mutate(fn) {
    writeChain = writeChain.then(async () => {
      await load();
      cache = fn(structuredClone(cache));
      await persist();
      return cache;
    });
    return writeChain;
  }

  return {
    resolvedPath: resolved,
    load,
    async getRoutine(id) {
      const db = await load();
      return db.routines.find((r) => r.id === id) ?? null;
    },
    async listRoutines() {
      const db = await load();
      return [...db.routines];
    },
    async upsertRoutine(routine) {
      await mutate((db) => {
        const idx = db.routines.findIndex((r) => r.id === routine.id);
        if (idx === -1) db.routines.push(routine);
        else db.routines[idx] = routine;
        return db;
      });
    },
    async createRoutine(routine) {
      await mutate((db) => {
        db.routines.push(routine);
        return db;
      });
    },
    async listGymProviders() {
      const db = await load();
      return [...db.gymProviders];
    },
    async getGymProvider(id) {
      const db = await load();
      return db.gymProviders.find((p) => p.id === id) ?? null;
    },
    async getGymProviderBySlug(slug) {
      const db = await load();
      return db.gymProviders.find((p) => p.slug === slug) ?? null;
    },
    async createGymProvider(provider) {
      await mutate((db) => {
        db.gymProviders.push(provider);
        return db;
      });
    },
    async upsertGymProvider(provider) {
      await mutate((db) => {
        const idx = db.gymProviders.findIndex((p) => p.id === provider.id);
        if (idx === -1) db.gymProviders.push(provider);
        else db.gymProviders[idx] = provider;
        return db;
      });
    },
    async patchGymProvider(id, patch) {
      await mutate((db) => {
        const idx = db.gymProviders.findIndex((p) => p.id === id);
        if (idx === -1) return db;
        const cur = db.gymProviders[idx];
        const next = { ...cur, ...patch, id: cur.id };
        if (patch.sites) next.sites = patch.sites;
        if (patch.equipmentCatalog !== undefined) next.equipmentCatalog = patch.equipmentCatalog;
        if (patch.metadata && typeof patch.metadata === 'object') {
          next.metadata = { ...(cur.metadata || {}), ...patch.metadata };
        }
        db.gymProviders[idx] = next;
        return db;
      });
    },
    async deleteGymProvider(id) {
      await mutate((db) => {
        db.gymProviders = db.gymProviders.filter((p) => p.id !== id);
        return db;
      });
    },
    async listInstalledPackages() {
      const db = await load();
      return [...(db.installedPackages || [])];
    },
    async upsertInstalledPackage(record) {
      await mutate((db) => {
        if (!Array.isArray(db.installedPackages)) db.installedPackages = [];
        const idx = db.installedPackages.findIndex((r) => r.packageId === record.packageId);
        if (idx === -1) db.installedPackages.push(record);
        else db.installedPackages[idx] = record;
        return db;
      });
    },
    async removeInstalledPackage(packageId) {
      await mutate((db) => {
        db.installedPackages = (db.installedPackages || []).filter(
          (r) => r.packageId !== packageId
        );
        return db;
      });
    },
    async getInstalledPackage(packageId) {
      const db = await load();
      return (db.installedPackages || []).find((r) => r.packageId === packageId) ?? null;
    },
    async getSession(id) {
      const db = await load();
      return db.sessions.find((s) => s.id === id) ?? null;
    },
    async listSessions() {
      const db = await load();
      return [...db.sessions];
    },
    async countSessionsWithGymProvider(gymProviderId) {
      if (!gymProviderId) return 0;
      const db = await load();
      return db.sessions.filter((s) => s.gymProviderId === gymProviderId).length;
    },
    async upsertSession(session) {
      await mutate((db) => {
        const idx = db.sessions.findIndex((s) => s.id === session.id);
        if (idx === -1) db.sessions.push(session);
        else db.sessions[idx] = session;
        return db;
      });
    },
    async getIdempotency(key) {
      if (!key) return null;
      const db = await load();
      return db.idempotency[key] ?? null;
    },
    async setIdempotency(key, record) {
      if (!key) return;
      await mutate((db) => {
        db.idempotency[key] = record;
        return db;
      });
    },
    async getGoogleFitState() {
      const db = await load();
      return db.integrationState.googleFit;
    },
    async setGoogleFitState(state) {
      await mutate((db) => {
        db.integrationState.googleFit = state;
        return db;
      });
    },
    async mergeExternalActivities(events) {
      await mutate((db) => {
        const seen = new Set(db.externalActivities.map((e) => e.externalId));
        for (const ev of events) {
          if (!ev.externalId || seen.has(ev.externalId)) continue;
          db.externalActivities.push(ev);
          seen.add(ev.externalId);
        }
        return db;
      });
    },
    async listExternalActivities(limit = 100) {
      const db = await load();
      return db.externalActivities.slice(-limit);
    },
    async getOauthPending() {
      const db = await load();
      return db.oauthPending;
    },
    async setOauthPending(record) {
      await mutate((db) => {
        db.oauthPending = record;
        return db;
      });
    },
    async clearOauthPending() {
      await mutate((db) => {
        db.oauthPending = null;
        return db;
      });
    }
  };
}
