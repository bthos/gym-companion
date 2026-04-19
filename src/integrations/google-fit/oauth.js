const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.body.read'
].join(' ');

export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scopes = DEFAULT_SCOPES,
  accessType = 'offline',
  prompt = 'consent'
}) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: accessType,
    include_granted_scopes: 'true',
    state,
    prompt
  });
  return `${AUTH}?${params.toString()}`;
}

export async function exchangeCodeForTokens({
  clientId,
  clientSecret,
  redirectUri,
  code
}) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || 'token_exchange_failed');
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}

export async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token'
  });

  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || 'token_refresh_failed');
    err.status = res.status;
    err.details = json;
    throw err;
  }
  return json;
}
