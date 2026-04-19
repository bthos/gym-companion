# Marketplace commerce (future / M6)

Paid marketplace packages, seat-based licenses, and partner revenue share are **not implemented** in this repository. When the product needs them, consider:

- **Entitlements:** map `packageId` + `workspaceId` (or user) to license state in a durable store, not only in `installedPackages`.
- **Payments:** Stripe (or similar) Checkout for one-off or subscription; webhook verifies payment before unlocking install or before renewing catalog access.
- **Catalog gating:** separate **commercial** catalog index URL from community catalog; signed manifests so the index cannot be swapped without detection.
- **Partner webhooks:** async notifications on purchase, cancellation, and chargeback with idempotent handlers (same patterns as `POST /api/webhooks/pipedream`).

Until then, all packages are treated as freely installable once they pass integrity, host allowlists, and optional publisher / signature checks.
