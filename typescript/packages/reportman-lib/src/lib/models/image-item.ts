import { PrintPosItem } from "./print-pos-item.js";
import { ImageDrawStyleType, SharedImageType } from "./section.js";

/** C# ImageItem: the defaults are the ones of its constructor. */
export class ImageItem extends PrintPosItem {
  public expression = "";
  public dpires = 100;
  // C# parity: the constructor does not set DrawStyle, so it is 0 (C# names it Crop, this model Center).
  public drawStyle = ImageDrawStyleType.Center;
  public sharedImage = SharedImageType.None;
  /** The embedded image, base64 (C# StreamBase64 of its Stream). */
  public streamBase64 = "";
  public rotation = 0;
  public copyMode = 0;
  constructor() {
    super();
    this.className = "TRPIMAGE";
    this.width = 500;
    this.height = 500;
  }
}
