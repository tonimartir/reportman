/**
 * The relationship of a file embedded in a PDF/A-3 document to the document (C# PDFAFRelationShip,
 * the PDF /AFRelationship).
 */
export enum PDFAFRelationShip {
  Unspecified = 0,
  Alternative = 1,
  Data = 2,
  Source = 3,
  Supplement = 4,
}

/**
 * A file embedded into the generated document (C# EmbeddedFile, the report's EMBEDDEDFILE
 * entries). The members not read from the .rep (the C# fields are not initialised) stay undefined.
 */
export class EmbeddedFile {
  public fileName?: string;
  public mimeType?: string;
  public description?: string;
  public afRelationShip = PDFAFRelationShip.Unspecified;
  public creationDate?: string;
  public modificationDate?: string;
  /**
   * The file contents, base64. C# keeps them in a MemoryStream (its `stream` member), which its JSON
   * serialiser cannot write (getting MemoryStream.ReadTimeout throws): the TypeScript model carries
   * them as base64, like the images of sections and image items.
   */
  public streamBase64?: string;
}
