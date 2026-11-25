/** What `PresentacionService.mostrarLoading()` hands back: something to hide when the work is done. */
export class LoadingModal {
  private readonly shownAt = Date.now();

  constructor(private readonly close: () => void) {}

  /** Hides the overlay, keeping it visible at least briefly so it does not flicker. */
  public async ocultar(): Promise<void> {
    const elapsed = Date.now() - this.shownAt;
    if (elapsed < 150) await new Promise((r) => setTimeout(r, 150 - elapsed));
    this.close();
  }
}
