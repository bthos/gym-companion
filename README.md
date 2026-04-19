# Gym Companion

AI-assisted gym routine companion with an API-first architecture designed for integration with Perplexity through Pipedream.

## Vision

Create routines with Perplexity or other AI tools, sync them into the app, and use them during gym sessions. The platform is designed to grow into wearable integrations such as Amazfit Bip 6.

## Planned capabilities

- AI-generated workout routine ingestion
- Routine builder and editor
- Workout session execution flow
- Exercise logging and progression tracking
- REST API for external AI and automation tools
- Pipedream-friendly webhook and API endpoints
- Google Fit read path as a consolidated source for external workouts (see `docs/architecture.md`)
- Future smartwatch sync and workout telemetry support

## Gym providers and marketplace

**Basic-Fit** (or any operator) is **not** auto-imported on server start. Use one of:

- **Marketplace:** `[data/marketplace/catalog.json](data/marketplace/catalog.json)` lists packages; `POST /api/marketplace/install` installs from a hosted URL when `MARKETPLACE_DOWNLOAD_HOSTS` and checksums are configured (see `[docs/marketplace.md](docs/marketplace.md)`).
- **HTTP import:** `POST /api/gym-providers/import/basicfit` with the combined gyms + equipment JSON.
- **CLI:** `npm run import:basicfit` (from `basicfit-rutina` or `BUNDLE_PATH`), or `npm run seed:basicfit` to build `data/marketplace/dist/basicfit-malaga.bundle.json` for hosting.

## Repository layout

- `apps/web` — future frontend app
- `src/api` — HTTP server, router, and handlers
- `src/marketplace` — catalog load, install pipeline, updates
- `src/store` — JSON file persistence (MVP)
- `data/marketplace/` — default catalog index (`store.json` stays local, see `.gitignore`)
- `src/core` — domain helpers (routine normalization, gym provider model)
- `src/integrations/google-fit` — OAuth + Fitness API session sync
- `src/integrations/pipedream` — webhook contracts and integration helpers
- `src/integrations/wearables/amazfit` — future Amazfit adapter layer
- `.artifacts/BRIEF.md` — implementation brief
- `docs/` — architecture, API, and deployment notes