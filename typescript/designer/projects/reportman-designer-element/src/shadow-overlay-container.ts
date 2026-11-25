import { Injectable } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';

/**
 * Dialogs, menus, selects and tooltips render in the CDK overlay container, normally the last
 * child of <body>: outside the element's shadow root, where its styles do not reach. This one
 * puts the container inside the shadow root instead, so they look like the rest of the designer
 * and the page's styles do not reach them either.
 */
@Injectable()
export class ShadowRootOverlayContainer extends OverlayContainer {
  /** Set by the element before anything opens; a page that opens the designer again sets the new one. */
  static root: ShadowRoot | null = null;

  /**
   * The container is created once for the whole application, but a page that closes the designer and
   * opens it again (another report, or back from its list) gets a new element with a new shadow root:
   * the container goes with it. Left in the first one, which is no longer in the page, every dialog,
   * menu and select of the second designer opened there, where nobody could see it.
   */
  override getContainerElement(): HTMLElement {
    const container = super.getContainerElement();
    const root = ShadowRootOverlayContainer.liveRoot();
    if (root && container.parentNode !== root) root.appendChild(container);
    return container;
  }

  /** The shadow root of a designer that is in the page: the last one opened, or, gone, one that is left. */
  private static liveRoot(): ShadowRoot | null {
    const root = ShadowRootOverlayContainer.root;
    if (!root || root.host.isConnected) return root;
    const alive = Array.from(document.querySelectorAll('reportman-designer')).reverse().find((e) => e.isConnected && e.shadowRoot);
    return alive?.shadowRoot ?? root;
  }

  protected override _createContainer(): void {
    super._createContainer();
    const root = ShadowRootOverlayContainer.root;
    if (root && this._containerElement) root.appendChild(this._containerElement);
  }
}
