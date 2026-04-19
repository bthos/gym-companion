# Marketplace (gym provider packages)

Gym **operators** (chains, catalogs of sites and equipment) are distributed as **packages** with a small **manifest** and a larger **payload**. This document describes the MVP pipeline in this repo and follow-on stages (M4–M6).

## Concepts

- **Catalog** — index of package manifests (`schemaVersion`, `packages[]`). Served locally as `[data/marketplace/catalog.json](../data/marketplace/catalog.json)` or remotely via `MARKETPLACE_CATALOG_URL`.
- **Manifest** — one catalog row: `packageId`, `version`, `vendor`, `displayName`, optional `publisher`, `regions`, `capabilities`, `download` (`url` **or** optional legacy `artifactPath`, `format`), `integrity` (`sha256` required when a payload source is set). Optional Ed25519 fields: `integrity.ed25519Signature`, `integrity.ed25519PublicKey` (see **Trust** below). Default sample packages use **`download.url`** on **`raw.githubusercontent.com`** so payloads are versioned in Git, not read from the API server disk.
- **Installation** — record in the JSON store (`installedPackages`) linking `packageId` to `providerId` after a successful install. Reserved fields: `userId`, `workspaceId` (used when `MARKETPLACE_WORKSPACE_SCOPING=1` and `X-Workspace-Id` is sent).

## Staging vs production catalog

Run **two catalog URLs** (or two static files) in different environments:


| Environment | Typical `MARKETPLACE_CATALOG_URL` / file                   | Purpose                                                           |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Staging     | `https://cdn.example.com/marketplace/catalog-staging.json` | Bleeding-edge package rows, test publishers                       |
| Production  | `https://cdn.example.com/marketplace/catalog.json`         | Stable rows, stricter `MARKETPLACE_PUBLISHER_ALLOWLIST` / signing |


Operators set `MARKETPLACE_CATALOG_URL` (or `MARKETPLACE_CATALOG_PATH`) per deployment. The default catalog’s sample rows use **`download.url`** pointing at **`raw.githubusercontent.com/.../data/marketplace/samples/...`**; configure `MARKETPLACE_DOWNLOAD_HOSTS` accordingly (see **Risks**).

## API (MVP)


| Method | Path                                        | Purpose                                                                          |
| ------ | ------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/marketplace/catalog`                  | Return the resolved catalog JSON                                                 |
| GET    | `/api/marketplace/installations`            | List `installedPackages` (optional `?workspaceId=` when workspace scoping is on) |
| GET    | `/api/marketplace/updates`                  | Compare installed versions to catalog                                            |
| POST   | `/api/marketplace/install`                  | Install from catalog, `manifestUrl`, or dev body                                 |
| DELETE | `/api/marketplace/installations/:packageId` | Remove installation and provider (see **Uninstall policy**)                      |


Full request/response notes: `[docs/api.md](api.md)`.

### Install modes

1. **Catalog:** `{ "packageId", "version" }` — row must include either non-empty `download.url` (remote, needs `MARKETPLACE_DOWNLOAD_HOSTS` + `integrity.sha256`) **or** legacy `download.artifactPath` under `data/marketplace/samples/` + `integrity.sha256` (server-local only).
2. **Manifest URL:** `{ "manifestUrl" }` — fetch one manifest JSON from an allowed host (`MARKETPLACE_MANIFEST_HOSTS` or `MARKETPLACE_DOWNLOAD_HOSTS`), then same pipeline as a catalog row.
3. **Dev/test:** `MARKETPLACE_ALLOW_DEV_BODY=1` and `{ "basicfitBundle": { ... } }` (same shape as `POST /api/gym-providers/import/basicfit`). Installation id `dev:<slug>`.

Remote fetches enforce **max size** via `MARKETPLACE_MAX_PACKAGE_BYTES` (default 50MB).

### Publisher allowlist

If `MARKETPLACE_PUBLISHER_ALLOWLIST` is set (comma-separated publisher ids), catalog rows with a `publisher` field must match; otherwise install returns 403.

## Uninstall policy

- **Default:** `DELETE /api/marketplace/installations/:packageId` fails with **409** `ACTIVE_SESSIONS` if any `WorkoutSession` still has `gymProviderId` equal to the provider being removed. This avoids silently breaking in-progress history.
- **Force:** `DELETE ...?force=1` removes the provider and installation anyway. Sessions are **not** rewritten; they may keep a `gymProviderId` that no longer resolves until clients migrate data.

## Vendor registry

Install pipelines are keyed by catalog `vendor` and `download.format` (see `[src/marketplace/vendors.js](../src/marketplace/vendors.js)`):

- `basicfit` + `basicfit-bundle` — Basic-Fit matrix JSON bundle.
- `sandbox` + `gym-provider-json` — minimal second pipeline for tests (`{ "provider": { ... } }` or a bare provider object).

## M4 — Multi-tenancy (workspace)

Set `MARKETPLACE_WORKSPACE_SCOPING=1` (or `true`). Clients send `X-Workspace-Id` on marketplace installs; the installation row (and gym provider) store `workspaceId`. Listings honor optional `?workspaceId=` on `GET /api/gym-providers` and `GET /api/marketplace/installations`. User-level auth is still future work; `userId` remains reserved.

## M5 — Trust (signatures)

- **SHA-256** of package bytes is always checked when `integrity.sha256` is set.
- **Ed25519 (optional):** manifest may include `integrity.ed25519Signature` (base64, 64 bytes) and optionally `integrity.ed25519PublicKey` (base64, 32 bytes). If `MARKETPLACE_SIGNING_PUBLIC_KEY_BASE64` is set in the environment, that key is used instead of the manifest key, and a signature becomes **mandatory** for installs (fails closed).

## M6 — Commerce

See `[docs/marketplace-commerce.md](marketplace-commerce.md)` — not implemented; placeholder for licenses and payments.

## Operational checklist

See `[docs/marketplace-operations.md](marketplace-operations.md)`.

## Offline / CLI import

Without marketplace fetch, use:

- `npm run import:basicfit` — writes into `STORE_PATH` from `BASICFIT_RUTINA_ROOT` or `BUNDLE_PATH` (see `[scripts/import-basicfit-to-store.mjs](../scripts/import-basicfit-to-store.mjs)`).
- `POST /api/gym-providers/import/basicfit` — same normalization over HTTP.

## Schemas

- `[docs/schema/marketplace-package-manifest.schema.json](schema/marketplace-package-manifest.schema.json)`
- `[docs/schema/marketplace-catalog.schema.json](schema/marketplace-catalog.schema.json)`

## Risks

- **SSRF:** mitigated by `MARKETPLACE_DOWNLOAD_HOSTS` / `MARKETPLACE_MANIFEST_HOSTS`. Default sample URLs use **`raw.githubusercontent.com`** — add that host in production. Legacy `artifactPath` is restricted to `data/marketplace/samples/` without `..`, resolved with `realpath` under that prefix. Catalog and package HTTP fetches use `redirect: 'manual'` so a first-hop allowed host cannot pivot via redirects to an internal URL.
- `**MARKETPLACE_CATALOG_URL`:** treat as **operator-controlled** (HTTPS URL to your catalog). There is no separate catalog-host allowlist; compromised catalog URLs can point installs at arbitrary allowed download hosts.
- **Version ordering:** updates use string `localeCompare` with `{ numeric: true }`; consider a semver library if versions become complex.

