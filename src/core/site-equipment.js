/**
 * Resolve external gym id (e.g. BasicFit numeric club id) from a site record.
 */
export function resolveSiteExternalId(site) {
  if (!site || typeof site !== 'object') return null;
  if (typeof site.externalId === 'number' && Number.isFinite(site.externalId)) {
    return site.externalId;
  }
  if (typeof site.id === 'string') {
    const m = site.id.match(/^basicfit_gym_(\d+)$/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Filter catalog equipment available at a site (expects `equipment[].gyms` number[]).
 */
export function filterEquipmentForSite(equipmentCatalog, siteExternalId) {
  if (siteExternalId == null || !Number.isFinite(siteExternalId)) return [];
  if (!equipmentCatalog?.equipment || !Array.isArray(equipmentCatalog.equipment)) return [];
  return equipmentCatalog.equipment.filter((item) => {
    const gyms = item?.gyms;
    if (!Array.isArray(gyms)) return false;
    return gyms.includes(siteExternalId);
  });
}
