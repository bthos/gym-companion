# API

Base URL is your deployed host (for example `https://api.example.com`) or `http://localhost:3000` in development.

## Authentication

- When `GYM_COMPANION_API_KEY` is set, most `/api/*` routes require either header `x-api-key: <key>` or `Authorization: Bearer <key>`.
- These paths stay **unauthenticated** so browser OAuth and inbound webhooks work:
  - `GET /health`
  - `GET /api/integrations/google-fit/oauth/callback`
  - `POST /api/webhooks/pipedream` (protected with `x-gym-signature` when `GYM_COMPANION_WEBHOOK_SECRET` is set)

## Idempotency

- `POST /api/routines/import` and `POST /api/webhooks/pipedream` honor `Idempotency-Key`. The first successful response is stored and replayed for the same key.

---

## Health

### `GET /health`

Returns `{ ok, service }`. No API key.

---

## Routines

### `GET /api/routines`

List stored routines.

### `GET /api/routines/:routineId`

Fetch one routine by id.

### `POST /api/routines`

Create a routine. Body matches the import schema (see below). Fails with `409` if `id` is already taken.

### `POST /api/routines/import`

Validate and upsert a routine (same id overwrites).

**Body (JSON)**

- `name` (string, required)
- `source` (string, optional)
- `status` (string, optional, default `active`)
- `id` (string, optional; generated if omitted)
- `days` (array, required, non-empty). Each day:
  - `id`, `label`, `order` (optional)
  - `exercises` (array). Each exercise:
    - `id`, `name`, `notes` (optional)
    - `prescription`: `{ sets, reps, loadKg?, restSec? }`

**Response:** `201` with `{ data, status: "imported" }`.

---

## Gym providers (operators)

A **gym provider** is a chain/operator with **sites** (clubs) and an optional **equipment catalog**. Catalogs can follow the shape used by the `basicfit-rutina` project (`data/gyms.json` + `data/equipment.json`: each equipment row lists numeric `gyms[]` ids of sites where that machine exists).

### `GET /api/gym-providers`

List all providers (summary arrays).

### `GET /api/gym-providers/:providerId`

Fetch one provider including `sites` and `equipmentCatalog` when stored.

### `POST /api/gym-providers`

Create a provider.

**Body:** `slug`, `displayName` (required); optional `id`, `brandKey`, `region`, `metadata`, `sites[]`, `equipmentCatalog`.

Each site: `name` required; optional `id`, `externalId` (number for catalog cross-reference), `address`, `hours`, `features`, `metadata`.

### `PATCH /api/gym-providers/:providerId`

Partial update: any of `slug`, `displayName`, `brandKey`, `region`, `metadata` (shallow merge with existing), `sites` (replace array if sent), `equipmentCatalog` (replace if sent).

### `POST /api/gym-providers/import/basicfit`

Upsert a provider from a **combined** BasicFit-style payload:

```json
{
  "id": "optional_stable_id",
  "slug": "optional_slug",
  "displayName": "Optional display name",
  "gyms": { "metadata": {}, "gyms": [ { "id": 1, "name": "...", "address": "..." } ] },
  "equipment": { "metadata": {}, "equipment": [ { "id": "g3-s10", "gyms": [1,2], "...": "..." } ] }
}
```

Aliases: `gymsDocument` / `equipmentDocument` instead of `gyms` / `equipment`. Response `201` `{ data, status: "imported" }`.

### `GET /api/gym-providers/:providerId/sites/:siteId/equipment`

Returns equipment rows whose `gyms` array includes the site’s **external** club id. The site must have `externalId` or an id of the form `basicfit_gym_<n>` so the server can resolve the numeric id.

---

## Workout sessions

### `POST /api/sessions`

Start a session.

**Body:** `{ "routineId": string, "dayId"?: string, "gymProviderId"?: string, "gymSiteId"?: string }`  
If `dayId` is omitted, the first day of the routine is used. When `gymSiteId` is set, `gymProviderId` is required and the site must belong to that provider.

**Response:** `201` with session `{ id, routineId, dayId, gymProviderId?, gymSiteId?, startedAt, finishedAt, performedSets }`.

### `PATCH /api/sessions/:sessionId`

Update session.

**Body (JSON)** — any combination of:

- `appendSet`: `{ exerciseId, reps?, loadKg?, setIndex?, notes? }`
- `finishedAt`: ISO string, or `status: "completed"` to set finish time to now.

**Response:** `200` with updated session.

---

## Pipedream webhook

### `POST /api/webhooks/pipedream`

Same routine validation as import. JSON body can be either a full routine object or `{ "routine": { ... } }`.

When `GYM_COMPANION_WEBHOOK_SECRET` is set, require header:

`x-gym-signature: sha256=<hex>` where `<hex>` is HMAC-SHA256 of the raw request body with the webhook secret as key.

---

## Google Fit integration

Google Fit is treated as an **aggregator**: the user consolidates workouts and some health metrics there; Gym Companion **reads** sessions via the Fitness API and stores normalized `externalActivities` in the local JSON store (MVP).

### `GET /api/integrations/google-fit/status`

Returns `{ connected, expiresAt, scope }` (tokens are never returned).

### `GET /api/integrations/google-fit/oauth/start`

Returns `{ url }` — open this URL in a browser to complete Google consent. Requires OAuth env vars:

- `GOOGLE_FIT_CLIENT_ID`
- `GOOGLE_OAUTH_REDIRECT_URI` (must match Google Cloud console)
- `GOOGLE_FIT_CLIENT_SECRET` (used at callback and token refresh)

Recommended OAuth scopes (configured in code): `fitness.activity.read`, `fitness.body.read`.

### `GET /api/integrations/google-fit/oauth/callback`

Browser redirect target. Query: `code`, `state`. Exchanges the code, stores refresh/access tokens, clears pending OAuth state.

### `POST /api/integrations/google-fit/sync`

Triggers a pull of **Fitness sessions** for a time window and merges new items into `externalActivities` (deduplicated by `externalId`).

**Body (optional JSON):**

- `startTimeMillis`, `endTimeMillis` — epoch ms; default window: last 7 days ending now.

**Response:** `200` `{ ok: true, imported, window }`.

Errors: `400` if not connected, `503` if client credentials missing, `502` on upstream Google errors.

---

## Marketplace

Discovery and installation of **gym provider packages** (see [`docs/marketplace.md`](marketplace.md)).

### `GET /api/marketplace/catalog`

Returns the catalog JSON (local file or remote URL from env).

### `GET /api/marketplace/installations`

Returns `{ data: installedPackages[] }` from the store (for UI and operations). When `MARKETPLACE_WORKSPACE_SCOPING=1`, optional query `?workspaceId=` filters rows by installation `workspaceId`.

### `GET /api/marketplace/updates`

Returns `{ catalogSchemaVersion, updates[] }` comparing `installedPackages` in the store to catalog entries (`update_available`, `up_to_date`, `orphaned_install`).

### `POST /api/marketplace/install`

- **Catalog install:** `{ "packageId": string, "version": string }` — resolves the row from the catalog, then loads the payload from `download.url` **or** shipped-sample `download.artifactPath` under `data/marketplace/samples/`. Remote `url` requires `MARKETPLACE_DOWNLOAD_HOSTS` and matching `integrity.sha256`. Max response size is capped by `MARKETPLACE_MAX_PACKAGE_BYTES` (default 50MB).
- **Manifest URL:** `{ "manifestUrl": string }` — fetches a single package manifest JSON from an allowed host (`MARKETPLACE_MANIFEST_HOSTS` if set, otherwise the same list as `MARKETPLACE_DOWNLOAD_HOSTS`), then installs like a catalog row (including `artifactPath` or remote `url`).
- **Dev inline:** with `MARKETPLACE_ALLOW_DEV_BODY=1`, `{ "basicfitBundle": { ... } }` same shape as `POST /api/gym-providers/import/basicfit`.

Optional header when `MARKETPLACE_WORKSPACE_SCOPING=1`: `X-Workspace-Id` — stored on the installation (and on the gym provider) for multi-workspace filtering.

### `DELETE /api/marketplace/installations/:packageId`

Removes the installation record and deletes the linked gym provider. URL-encode `packageId` if it contains reserved characters (e.g. `dev%3Abasicfit-malaga`).

If any session still references the provider’s `gymProviderId`, the API returns **409** `ACTIVE_SESSIONS` unless you pass query `?force=1` (sessions are not rewritten; they may point at a removed provider until edited).

---

## Environment variables (summary)

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `3000`) |
| `STORE_PATH` | JSON store file (default `./data/store.json`) |
| `MARKETPLACE_CATALOG_URL` | Optional HTTPS URL for catalog JSON (overrides file path) |
| `MARKETPLACE_CATALOG_PATH` | Catalog file path (default `./data/marketplace/catalog.json`) |
| `MARKETPLACE_DOWNLOAD_HOSTS` | Comma-separated hostnames allowed for package `download.url` (SSRF guard; required for remote URL installs) |
| `MARKETPLACE_MANIFEST_HOSTS` | Optional separate allowlist for `manifestUrl` fetch; defaults to `MARKETPLACE_DOWNLOAD_HOSTS` |
| `MARKETPLACE_MAX_PACKAGE_BYTES` | Max downloaded/read package bytes (default `50000000`) |
| `MARKETPLACE_PUBLISHER_ALLOWLIST` | Optional comma-separated `publisher` ids; if set, unknown publishers rejected |
| `MARKETPLACE_ALLOW_DEV_BODY` | Set to `1` / `true` to allow `{ basicfitBundle }` installs without remote fetch |
| `MARKETPLACE_WORKSPACE_SCOPING` | Set to `1` / `true` to enable `X-Workspace-Id` on installs and `?workspaceId=` filtering on listings |
| `MARKETPLACE_SIGNING_PUBLIC_KEY_BASE64` | Optional 32-byte Ed25519 public key (base64); when set, packages must include `integrity.ed25519Signature` (see [`docs/marketplace.md`](marketplace.md)) |
| `GYM_COMPANION_API_KEY` | Optional API key gate |
| `GYM_COMPANION_WEBHOOK_SECRET` | Optional HMAC secret for Pipedream |
| `GOOGLE_FIT_CLIENT_ID` / `GOOGLE_FIT_CLIENT_SECRET` | Google OAuth client |
| `GOOGLE_OAUTH_REDIRECT_URI` | Registered redirect; must hit `/api/integrations/google-fit/oauth/callback` on this API host |
