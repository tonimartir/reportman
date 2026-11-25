import { Injectable } from "@angular/core";

@Injectable({
  providedIn: "root",
})
export class FileService {
  public downloadFile(base64Data: string, fileName: string) {
    // 1. Decode to bytes
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);

    // 2. Create blob
    const blob = new Blob([byteArray], { type: "application/octet-stream" });

    // 3. Temporary url
    const url = window.URL.createObjectURL(blob);

    // 4. Create <a> link simulate click
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();

    // 5. Cleanup
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }
}
