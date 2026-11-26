// What the page and the service worker of the designer share: where the saved reports are kept.

/** The alias of the demo's reports: SAMPLES/<sample>.rep. */
export const SAMPLES_ALIAS = 'SAMPLES';
/** The cache that keeps the reports a visitor saved (and made), and the samples' schema file they changed. */
export const STORE_CACHE = 'reportman-designer-demo-reports';

/** The key of a saved report in the cache: a URL inside the demo's folder that is never fetched. */
export function storeKey(demoBase: string, reportPath: string): string {
  return new URL('designer/store/' + encodeURI(reportPath), demoBase).href;
}

/**
 * The cache of this browser's Reportman AI installation: apart from the reports, so that restoring the
 * samples does not make a new installation (with new guest credits).
 */
export const AI_CACHE = 'reportman-designer-demo-ai';

/** The key of this browser's Reportman AI installation in AI_CACHE (a URL that is never fetched). */
export function aiInstallKey(demoBase: string): string {
  return new URL('designer/store-ai/install-id', demoBase).href;
}

/** The key of the local schema file of the samples (SAMPLES.json) the visitor changed, in STORE_CACHE. */
export function schemaKey(demoBase: string, alias: string): string {
  return new URL('designer/store-schemas/' + encodeURIComponent(alias.toUpperCase()) + '.json', demoBase).href;
}

/** The visitor's own reports (made with New report), in localStorage: their names, without .rep. */
export const OWN_REPORTS = 'reportman-designer-demo-own';
