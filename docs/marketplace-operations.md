# Marketplace operations (stage 0)

Use this checklist when taking the marketplace from “code exists” to “operators can install without dev-only bodies”.

1. **Build a real Basic-Fit bundle** (when `basicfit-rutina` is available): `npm run seed:basicfit` — note the printed `sha256` and output path under `data/marketplace/dist/` (or your CI artifact).
2. **Host the `.bundle.json`** on a host you control (GitHub Releases raw URL, S3, CDN). Add that hostname to `MARKETPLACE_DOWNLOAD_HOSTS` (comma-separated, lowercase hostnames only).
3. **Update the catalog row** for `eu.basicfit.malaga-matrix` (or your package id): set `download.url` to the HTTPS URL, `integrity.sha256` to the hash of the **exact** bytes clients will download. Remove `artifactPath` when switching to remote URL (only one of `url` / `artifactPath` is allowed).
4. **Publisher allowlist (optional):** set `MARKETPLACE_PUBLISHER_ALLOWLIST` to comma-separated publisher ids; each catalog row’s `publisher` must match when the allowlist is non-empty.
5. **Point production at a stable catalog:** set `MARKETPLACE_CATALOG_URL` to an HTTPS URL for the catalog JSON (separate from the app repo is recommended).

**Shipped samples:** this repo includes small JSON under `data/marketplace/samples/` wired through `artifactPath` in [`data/marketplace/catalog.json`](../data/marketplace/catalog.json) so `POST /api/marketplace/install` works **without** `MARKETPLACE_DOWNLOAD_HOSTS` for those rows only (no remote fetch).

See also [`docs/marketplace.md`](marketplace.md) and [`docs/api.md`](api.md).
