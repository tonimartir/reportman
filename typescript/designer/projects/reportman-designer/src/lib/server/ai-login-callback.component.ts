import { Component, OnInit } from '@angular/core';

/**
 * Where Google and Microsoft come back to after the AI's login, inside the popup the chat opened:
 * ?token=…&email=… on success, ?error=… otherwise. It hands the result to the page that opened it
 * (same origin only) and closes, so the report open in the designer is never left. The host routes
 * it at DesignerHost.aiCallbackPath (default /ai/callback).
 */
@Component({
  selector: 'rp-ai-login-callback',
  template: '<p style="padding:24px;font-family:Roboto,sans-serif">{{ text }}</p>',
})
export class AiLoginCallbackComponent implements OnInit {
  text = '…';

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const email = params.get('email');
    const error = params.get('error') ?? (token && email ? null : 'no_token');
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'rpsrv-ai-login', token, email, error }, window.location.origin);
      window.close();
      return;
    }
    // Opened without the page behind (a blocked popup's fallback, a bookmark): nothing to hand it to.
    this.text = error ? 'Reportman AI: ' + error : 'Reportman AI: ✓';
  }
}
