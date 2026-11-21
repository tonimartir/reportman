export interface ReportResult {
  base64Pdf: string;
  pageWidth: number;
  pageHeight: number;
  pageCount: number;
  pageSizeIndex?: number;
  pageSizeName?: string;
  printerSelect?: number;
}
