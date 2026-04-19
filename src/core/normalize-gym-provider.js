import crypto from 'node:crypto';

function slugId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
}

function normalizeSite(raw, idx) {
  const name =
    typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
  if (!name) return { ok: false, error: `sites[${idx}].name is required` };
  const id =
    typeof raw?.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : typeof raw?.externalId === 'number'
        ? `site_${raw.externalId}`
        : slugId('site');
  const externalId =
    typeof raw?.externalId === 'number' && Number.isFinite(raw.externalId)
      ? raw.externalId
      : typeof raw?.externalId === 'string' && /^\d+$/.test(raw.externalId)
        ? Number(raw.externalId)
        : null;
  return {
    ok: true,
    site: {
      id,
      name,
      address: typeof raw?.address === 'string' ? raw.address : '',
      externalId,
      hours: raw?.hours && typeof raw.hours === 'object' ? raw.hours : undefined,
      features: Array.isArray(raw?.features) ? raw.features : undefined,
      metadata: raw?.metadata && typeof raw.metadata === 'object' ? raw.metadata : undefined
    }
  };
}

/**
 * Generic gym provider from API body.
 */
export function normalizeGymProvider(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['Body must be a JSON object'] };
  }
  const slug =
    typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : null;
  if (!slug) errors.push('slug is required');
  const displayName =
    typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim()
      : null;
  if (!displayName) errors.push('displayName is required');
  const sitesIn = Array.isArray(body.sites) ? body.sites : [];
  if (errors.length) return { ok: false, errors };

  const sites = [];
  for (let i = 0; i < sitesIn.length; i++) {
    const s = normalizeSite(sitesIn[i], i);
    if (!s.ok) errors.push(s.error);
    else sites.push(s.site);
  }
  if (errors.length) return { ok: false, errors };

  const id =
    typeof body.id === 'string' && body.id.trim() ? body.id.trim() : slugId('gym_provider');

  const equipmentCatalog =
    body.equipmentCatalog != null && typeof body.equipmentCatalog === 'object'
      ? body.equipmentCatalog
      : undefined;

  const provider = {
    id,
    slug,
    displayName,
    brandKey: typeof body.brandKey === 'string' ? body.brandKey : undefined,
    region: typeof body.region === 'string' ? body.region : undefined,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    sites,
    equipmentCatalog,
    createdAt: new Date().toISOString()
  };

  return { ok: true, provider };
}

/**
 * Build a provider from BasicFit-style `gyms.json` + `equipment.json` payloads.
 * @param {{ gyms?: object, equipment?: object }} bundle
 */
export function normalizeBasicfitBundle(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object') {
    return { ok: false, errors: ['Body must be a JSON object'] };
  }
  const gymsDoc = bundle.gyms ?? bundle.gymsDocument;
  const equipmentDoc = bundle.equipment ?? bundle.equipmentDocument;
  if (!gymsDoc || typeof gymsDoc !== 'object') errors.push('gyms document is required (key: gyms)');
  if (!equipmentDoc || typeof equipmentDoc !== 'object') {
    errors.push('equipment document is required (key: equipment)');
  }
  if (errors.length) return { ok: false, errors };

  const gymsList = Array.isArray(gymsDoc.gyms) ? gymsDoc.gyms : null;
  const equipmentList = Array.isArray(equipmentDoc.equipment) ? equipmentDoc.equipment : null;
  if (!gymsList?.length) errors.push('gyms.gyms must be a non-empty array');
  if (!equipmentList?.length) errors.push('equipment.equipment must be a non-empty array');
  if (errors.length) return { ok: false, errors };

  const sites = [];
  for (let i = 0; i < gymsList.length; i++) {
    const g = gymsList[i];
    const ext =
      typeof g?.id === 'number'
        ? g.id
        : typeof g?.id === 'string' && /^\d+$/.test(g.id)
          ? Number(g.id)
          : null;
    const name = typeof g?.name === 'string' ? g.name.trim() : '';
    if (!name) {
      errors.push(`gyms[${i}].name is required`);
      continue;
    }
    sites.push({
      id: ext != null ? `basicfit_gym_${ext}` : slugId('site'),
      name,
      address: typeof g?.address === 'string' ? g.address : '',
      externalId: ext,
      hours: g?.hours && typeof g.hours === 'object' ? g.hours : undefined,
      features: Array.isArray(g?.features) ? g.features : undefined,
      metadata: { neighborhood: g?.neighborhood, note: g?.note }
    });
  }
  if (errors.length) return { ok: false, errors };

  const slug =
    typeof bundle.slug === 'string' && bundle.slug.trim()
      ? bundle.slug.trim()
      : 'basicfit-malaga';
  const displayName =
    typeof bundle.displayName === 'string' && bundle.displayName.trim()
      ? bundle.displayName.trim()
      : gymsDoc.metadata?.city
        ? `Basic-Fit ${gymsDoc.metadata.city}`
        : 'Basic-Fit import';

  const id =
    typeof bundle.id === 'string' && bundle.id.trim()
      ? bundle.id.trim()
      : slugId('gym_provider');

  const provider = {
    id,
    slug,
    displayName,
    brandKey: 'basicfit',
    region: typeof bundle.region === 'string' ? bundle.region : 'ES-MA',
    metadata: {
      ...(typeof bundle.metadata === 'object' ? bundle.metadata : {}),
      importKind: 'basicfit',
      gymsMetadata: gymsDoc.metadata,
      equipmentMetadata: equipmentDoc.metadata
    },
    sites,
    equipmentCatalog: {
      metadata: equipmentDoc.metadata,
      equipment: equipmentList
    },
    createdAt: new Date().toISOString()
  };

  return { ok: true, provider };
}
