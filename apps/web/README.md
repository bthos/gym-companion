# Web app shell

Placeholder for the future gym-floor UI:
- today workout view
- routine browser
- session logger
- progress history

## Marketplace (static)

- [`marketplace.html`](marketplace.html) — minimal catalog / install / list / uninstall UI against the API.
- **Hosted on Render (example):** [Marketplace UI](https://gym-companion-marketplace-ui.onrender.com/marketplace.html) — static site from this folder; set **API base URL** to your API (e.g. `https://gym-companion-plv9.onrender.com`) and optional **API key**. The API must allow this origin via `MARKETPLACE_CORS_ORIGINS` (comma-separated), see [`docs/api.md`](../docs/api.md).
- Locally: run the API (`npm run dev`), then open the file in a browser or serve this folder with any static server.
