# Deployment

## What GitHub is for

Use **GitHub** for source control and CI (see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). GitHub **Pages** hosts only static sites — it cannot run this Node HTTP API or hold OAuth **client secrets**. GitHub **Actions** can run scheduled jobs (for example nightly Fit sync) but is not a substitute for an always-on API users call from an app.

## Hosting the API (free or low-cost tiers)

Pick a platform that can run a **Node process** (or container) with a public HTTPS URL for OAuth redirect callbacks.

| Platform | Notes |
|----------|--------|
| **Google Cloud Run** | Generous free tier; pairs naturally with Google OAuth. Build a small container or use a buildpack; set env vars in the service. Use HTTPS URL as `GOOGLE_OAUTH_REDIRECT_URI` (e.g. `https://YOUR_HOST/api/integrations/google-fit/oauth/callback`). |
| **Render** | Free web services may sleep on idle (cold starts). Set `STORE_PATH` to a persistent disk mount if you need the JSON file to survive restarts. |
| **Fly.io** | Free allowance changes over time; good for small VMs with persistent volumes. |
| **Railway** | Often trial credits; straightforward Node deploy. |
| **Vercel / Netlify serverless** | Possible for short requests; watch **execution time limits** for Fit sync and token refresh; you may need async job pattern. |

## Required environment variables

Set these in the host’s dashboard (not committed to git):

| Variable | Required | Description |
|----------|----------|-------------|
| `STORE_PATH` | Recommended | Absolute path to writable JSON file (attach a volume on PaaS). |
| `MARKETPLACE_CATALOG_URL` / `MARKETPLACE_CATALOG_PATH` | Optional | Catalog index for gym provider packages (see `docs/marketplace.md`). |
| `MARKETPLACE_DOWNLOAD_HOSTS` | For remote install | Example: `raw.githubusercontent.com`. Empty disables fetching packages by URL. |
| `MARKETPLACE_ALLOW_DEV_BODY` | Dev only | Allows `POST /api/marketplace/install` with `{ basicfitBundle }` without a hosted payload. |
| `GYM_COMPANION_API_KEY` | Optional | Locks down `/api/*` except health, OAuth callback, and Pipedream webhook. |
| `GYM_COMPANION_WEBHOOK_SECRET` | Optional | Enables `x-gym-signature` verification on Pipedream. |
| `GOOGLE_FIT_CLIENT_ID` | For Fit | OAuth client ID from Google Cloud Console. |
| `GOOGLE_FIT_CLIENT_SECRET` | For Fit | OAuth client secret. |
| `GOOGLE_OAUTH_REDIRECT_URI` | For Fit | Must exactly match a URI authorized in the Google client; should point to this service’s `/api/integrations/google-fit/oauth/callback`. |

## Google Cloud Console checklist

1. Create a project → **APIs & Services** → enable **Fitness API**.
2. **OAuth consent screen** (External or Internal as appropriate).
3. **Credentials** → OAuth 2.0 Client ID (Web application).
4. Authorized redirect URIs: your deployed callback URL.
5. Scopes: include Fitness read scopes used in code (`fitness.activity.read`, `fitness.body.read`).

Production apps showing sensitive scopes may need **Google verification** — budget time beyond engineering.

## Local run

```bash
npm install   # no dependencies required today
npm run dev
```

Default store: `./data/store.json` (ignored by git under `/data/`).

## CI

`npm test` runs on Node 22 in GitHub Actions; keep the test suite green before merging.
