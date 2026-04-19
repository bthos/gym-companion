import { listFitnessSessions, toNanos } from './client.js';
import { refreshAccessToken } from './oauth.js';
import { mapFitnessSessionsResponse } from './map-session.js';

function expiresAtFromTokenResponse(json) {
  const sec = Number(json.expires_in);
  if (!Number.isFinite(sec)) return Date.now() + 3_600_000;
  return Date.now() + sec * 1000;
}

async function ensureAccessToken(store, env) {
  const state = await store.getGoogleFitState();
  if (!state?.refreshToken && !state?.accessToken) {
    const err = new Error('google_fit_not_connected');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const { clientId, clientSecret } = env;
  if (!clientId || !clientSecret) {
    const err = new Error('google_fit_oauth_not_configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  if (state.accessToken && state.expiresAt && Date.now() < state.expiresAt - 30_000) {
    return state.accessToken;
  }

  if (!state.refreshToken) {
    const err = new Error('google_fit_missing_refresh');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const refreshed = await refreshAccessToken({
    clientId,
    clientSecret,
    refreshToken: state.refreshToken
  });

  const next = {
    ...state,
    accessToken: refreshed.access_token,
    expiresAt: expiresAtFromTokenResponse(refreshed),
    scope: refreshed.scope || state.scope
  };
  if (refreshed.refresh_token) next.refreshToken = refreshed.refresh_token;
  await store.setGoogleFitState(next);
  return next.accessToken;
}

/**
 * Pull sessions from Google Fit for a time window and merge into store.
 * @param {*} store - JSON store instance from createJsonStore
 * @param {object} env
 * @param {{ startMs?: number, endMs?: number }} range
 */
export async function syncGoogleFitSessions(store, env, range = {}) {
  const endMs = range.endMs ?? Date.now();
  const startMs = range.startMs ?? endMs - 7 * 86_400_000;

  const accessToken = await ensureAccessToken(store, env);
  const startNanos = toNanos(startMs);
  const endNanos = toNanos(endMs);

  const payload = await listFitnessSessions({
    accessToken,
    startTimeNanos: startNanos.toString(),
    endTimeNanos: endNanos.toString()
  });

  const events = mapFitnessSessionsResponse(payload);
  await store.mergeExternalActivities(events);
  return { imported: events.length, window: { startMs, endMs } };
}
