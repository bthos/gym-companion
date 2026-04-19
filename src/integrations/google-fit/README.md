# Google Fit integration

Server-side OAuth and read-only sync of **Fitness API sessions** into the Gym Companion JSON store as `externalActivities`.

## Environment

- `GOOGLE_FIT_CLIENT_ID`
- `GOOGLE_FIT_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` — must match the authorized redirect in Google Cloud Console and hit this API’s `GET /api/integrations/google-fit/oauth/callback`.

Optional gate: `GYM_COMPANION_API_KEY` for `/api/integrations/google-fit/oauth/start` and `/sync`.

## Flow

1. `GET /api/integrations/google-fit/oauth/start` → open returned `url` in a browser.
2. User consents; Google redirects to `oauth/callback` with `code` and `state`.
3. `POST /api/integrations/google-fit/sync` pulls sessions for the time window and merges deduplicated rows.

## Code layout

- `oauth.js` — authorize URL builder, authorization code exchange, refresh token grant.
- `client.js` — `users/me/sessions` request helpers.
- `map-session.js` — Fitness session JSON → `externalActivities` record.
- `sync.js` — refresh access token if needed, call list sessions, persist via store.

## Security notes

- Tokens are stored in the shared JSON file in MVP deployments — **not** suitable for multi-tenant production without encryption and per-user partitioning.
- Never expose `GOOGLE_FIT_CLIENT_SECRET` in static frontends (e.g. GitHub Pages).
