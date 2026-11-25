import { HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideZoneChangeDetection } from '@angular/core';
import { createCustomElement } from '@angular/elements';
import { createApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { from, switchMap } from 'rxjs';
import { provideReportmanDesigner } from '@reportman/ngx-designer';
import { DesignerElementComponent } from './designer-element.component';
import { elementConfig } from './element-config';
import { ShadowRootOverlayContainer } from './shadow-overlay-container';

/** The page's session as a Bearer token on the designer's calls, when the page gives getToken. */
const pageToken: HttpInterceptorFn = (request, next) => {
  const getToken = elementConfig.getToken;
  if (!getToken) return next(request);
  return from(Promise.resolve(getToken())).pipe(
    switchMap((token) => next(token ? request.clone({ setHeaders: { Authorization: 'Bearer ' + token } }) : request)),
  );
};

/** One application for the page and the custom element on top of it. */
export async function defineDesignerElement(): Promise<void> {
  if (customElements.get('reportman-designer')) return;
  const app = await createApplication({
    providers: [
      // The designer library still relies on zone.js to refresh after its awaits.
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideHttpClient(withInterceptors([pageToken])),
      provideAnimationsAsync(),
      { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline', subscriptSizing: 'dynamic' } },
      { provide: OverlayContainer, useClass: ShadowRootOverlayContainer },
      provideReportmanDesigner({
        designerUrl: () => elementConfig.api('/designer'),
        // Read once, by the first service that asks: the element makes sure that is after it read
        // its attributes (designer-element.component.ts).
        // Getters, read on every call: a page that opens the designer again with another company in
        // its `api-base` (a host application) must not keep the routes of the first one.
        host: () => ({
          aiInstallId: () => elementConfig.aiInstallId,
          get aiBridgeUrl() { return elementConfig.api('/ai/'); },
          get aiLoginUrl() { return elementConfig.api('/ai-login'); },
          get aiAccount() { return elementConfig.aiAccount; },
          aiAvailable: () => elementConfig.ai,
          // no-ai: no AI control at all (the server may have no AI, as @reportman/designer-server)
          aiEnabled: () => elementConfig.ai,
          get aiCallbackPath() { return elementConfig.aiCallbackPath; },
          monacoUrl: elementConfig.asset('assets/monaco-editor/min/vs'),
          getToken: () => (elementConfig.getToken ? elementConfig.getToken() : null),
          sessionLost: () => elementConfig.sessionLost(),
        }),
      }),
    ],
  });
  customElements.define('reportman-designer', createCustomElement(DesignerElementComponent, { injector: app.injector }));
}
