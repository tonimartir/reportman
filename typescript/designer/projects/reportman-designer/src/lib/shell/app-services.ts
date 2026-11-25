import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

/** Per-browser preferences (the original host application kept them per user in its cache service). */
@Injectable({ providedIn: 'root' })
export class CacheService {
  public async guardar<T>(clave: string, valor: T, ..._rest: any[]): Promise<void> {
    try {
      localStorage.setItem('rpdesigner_' + clave, JSON.stringify(valor));
    } catch {
      /* private mode or blocked storage */
    }
  }

  public async leer<T>(clave: string, ..._rest: any[]): Promise<T | undefined> {
    try {
      const raw = localStorage.getItem('rpdesigner_' + clave);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }
}

/** Only `hasModalesAbiertos()` survived from the original host application's navigation service. */
@Injectable({ providedIn: 'root' })
export class NavegacionService {
  private dialog = inject(MatDialog);

  public hasModalesAbiertos(): boolean {
    return this.dialog.openDialogs.length > 0;
  }
}

/** The original host application's DB client only lent the designer a key for its preferences. */
@Injectable({ providedIn: 'root' })
export class DBClientService {
  public get usuarioClave(): string {
    return localStorage.getItem('rpsrv_email') ?? 'local';
  }

  /** The original host application keyed preferences by user code; here the account e-mail plays that role. */
  public get codigoUsuarioActual(): string {
    return this.usuarioClave;
  }
}

/** Image copy and paste for the object inspector, on the async Clipboard API. */
@Injectable({ providedIn: 'root' })
export class ClipboardService {
  public async copyBase64ImageToClipboard(base64: string): Promise<void> {
    const blob = this.base64ToBlob(base64, 'image/png');
    const item = new ClipboardItem({ [blob.type]: blob });
    await navigator.clipboard.write([item]);
  }

  public async getBase64ImageFromClipboard(): Promise<string | undefined> {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      return this.blobToBase64(blob);
    }
    return undefined;
  }

  private base64ToBlob(base64: string, fallbackType: string): Blob {
    const comma = base64.indexOf(',');
    const data = comma >= 0 ? base64.substring(comma + 1) : base64;
    const type = comma >= 0 ? base64.substring(5, base64.indexOf(';')) || fallbackType : fallbackType;
    const bytes = atob(data);
    const array = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
    return new Blob([array], { type });
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.substring(result.indexOf(',') + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
