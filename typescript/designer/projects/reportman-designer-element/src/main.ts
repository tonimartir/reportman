// <reportman-designer>: Report Manager's web designer as a custom element (see
// designer-element.component.ts). The designer needs zone.js; a page that already loaded it (an
// Angular application with zones) keeps its own, and Angular is loaded after it.
async function start(): Promise<void> {
  if (!(globalThis as any).Zone) await import('zone.js');
  const { defineDesignerElement } = await import('./bootstrap');
  await defineDesignerElement();
}

start().catch((err) => console.error('[reportman-designer]', err));
