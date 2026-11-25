/**
 * What the element was told (its attributes and properties), read by the designer's services
 * when they start: they start after the element has set it. One designer per page, so one config.
 */
export const elementConfig = {
  /** The origin of the designer's server (Reportman.Designer.Server); empty: this page's origin. */
  server: '',
  /**
   * Where the designer's routes hang on that server: `{apiBase}/designer`, `{apiBase}/ai/`,
   * `{apiBase}/ai-login`. `/api` (Reportman.Server's) by default; a host that answers per company
   * puts the company in it (`/api/empresas/12/disenador`).
   */
  apiBase: '/api',
  /** Whose AI account: `login` (the person logs in from the chat) or `host` (the host's server puts it). */
  aiAccount: 'login' as 'login' | 'host',
  /** The server's installation for Reportman AI (asked to Reportman.Server when not given). */
  aiInstallId: '',
  ai: true,
  /** Where Google and Microsoft come back to after the AI's login (a path of this page's origin). */
  aiCallbackPath: '/ai/callback',
  getToken: null as null | (() => string | null | undefined | Promise<string | null | undefined>),
  sessionLost: (): void => undefined,
  /** The folder this script was loaded from: the stylesheet, Monaco and ai-callback.html are next to it. */
  scriptBase: new URL('.', import.meta.url).href,

  url(path: string): string {
    return this.server.replace(/\/+$/, '') + path;
  },

  /** A route of the designer's server, under its base. */
  api(path: string): string {
    const base = '/' + this.apiBase.trim().replace(/^\/+|\/+$/g, '');
    return this.url((base === '/' ? '' : base) + path);
  },

  asset(path: string): string {
    return new URL(path, this.scriptBase).href;
  },
};
