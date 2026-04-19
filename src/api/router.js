function entry(method, pattern, handler, paramNames = []) {
  return { method, pattern, handler, paramNames };
}

export function buildRouter(handlers) {
  const table = [
    entry('GET', /^\/health$/, handlers.healthcheck),
    entry('GET', /^\/api\/marketplace\/catalog$/, handlers.marketplaceCatalog),
    entry('GET', /^\/api\/marketplace\/installations$/, handlers.marketplaceInstallations),
    entry('GET', /^\/api\/marketplace\/updates$/, handlers.marketplaceUpdates),
    entry('POST', /^\/api\/marketplace\/install$/, handlers.marketplaceInstall),
    entry(
      'DELETE',
      /^\/api\/marketplace\/installations\/([^/]+)$/,
      handlers.marketplaceUninstall,
      ['packageId']
    ),
    entry('GET', /^\/api\/routines$/, handlers.listRoutines),
    entry('POST', /^\/api\/routines$/, handlers.createRoutine),
    entry('GET', /^\/api\/routines\/([^/]+)$/, handlers.getRoutine, ['routineId']),
    entry('POST', /^\/api\/routines\/import$/, handlers.importRoutine),
    entry('GET', /^\/api\/gym-providers$/, handlers.listGymProviders),
    entry('POST', /^\/api\/gym-providers$/, handlers.createGymProvider),
    entry('POST', /^\/api\/gym-providers\/import\/basicfit$/, handlers.importBasicfitGymProvider),
    entry(
      'GET',
      /^\/api\/gym-providers\/([^/]+)\/sites\/([^/]+)\/equipment$/,
      handlers.getSiteEquipment,
      ['providerId', 'siteId']
    ),
    entry('GET', /^\/api\/gym-providers\/([^/]+)$/, handlers.getGymProvider, ['providerId']),
    entry('PATCH', /^\/api\/gym-providers\/([^/]+)$/, handlers.patchGymProvider, ['providerId']),
    entry('POST', /^\/api\/sessions$/, handlers.createSession),
    entry('PATCH', /^\/api\/sessions\/([^/]+)$/, handlers.patchSession, ['sessionId']),
    entry('POST', /^\/api\/webhooks\/pipedream$/, handlers.pipedreamWebhook),
    entry('GET', /^\/api\/integrations\/google-fit\/status$/, handlers.googleFitStatus),
    entry('GET', /^\/api\/integrations\/google-fit\/oauth\/start$/, handlers.googleFitOauthStart),
    entry('GET', /^\/api\/integrations\/google-fit\/oauth\/callback$/, handlers.googleFitOauthCallback),
    entry('POST', /^\/api\/integrations\/google-fit\/sync$/, handlers.googleFitSync)
  ];

  return function match(method, pathname) {
    for (const row of table) {
      if (row.method !== method) continue;
      const m = pathname.match(row.pattern);
      if (!m) continue;
      const params = {};
      row.paramNames.forEach((name, i) => {
        params[name] = m[i + 1];
      });
      return { handler: row.handler, params };
    }
    return null;
  };
}
