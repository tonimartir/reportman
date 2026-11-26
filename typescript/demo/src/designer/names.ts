// What the page and the service worker of the designer share: where the saved reports are kept.

/** The alias of the demo's reports: SAMPLES/<sample>.rep. */
export const SAMPLES_ALIAS = 'SAMPLES';
/** The cache that keeps the reports a visitor saved. */
export const STORE_CACHE = 'reportman-designer-demo-reports';

/** The key of a saved report in the cache: a URL inside the demo's folder that is never fetched. */
export function storeKey(demoBase: string, reportPath: string): string {
  return new URL('designer/store/' + encodeURI(reportPath), demoBase).href;
}
