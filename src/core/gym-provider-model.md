# Gym provider model

A **gym provider** is a chain or operator (e.g. Basic-Fit) that owns **sites** (physical clubs) and optionally an **equipment catalog** describing what is available where.

## Entities

- **GymProvider** — `id`, `slug`, `displayName`, `brandKey?`, `region?`, `metadata?`, `sites[]`, `equipmentCatalog?`, `createdAt`
- **GymSite** — `id`, `name`, `address?`, `externalId?` (numeric id from source systems), `hours?`, `features?`, `metadata?`
- **EquipmentCatalog** — opaque JSON aligned with external catalogs (e.g. `basicfit-rutina` repo `data/equipment.json`: `metadata` + `equipment[]` with per-item `gyms: number[]`).

## Session link

`WorkoutSession` may include optional `gymProviderId` and `gymSiteId` to record where the workout was performed relative to the provider’s sites.
