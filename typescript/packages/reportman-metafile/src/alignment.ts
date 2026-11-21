/**
 * The alignment flags stored in MetaObjectText.Alignment and TextObjectStruct.Alignment
 * (MetaFile.AlignmentFlags_* and the private copies of PDFCanvas, which adds AlignTop).
 */
export const AlignmentFlags = {
  AlignLeft: 1,
  AlignRight: 2,
  AlignHCenter: 4,
  AlignTop: 8,
  AlignBottom: 16,
  AlignVCenter: 32,
  SingleLine: 64,
  AlignHJustify: 1024,
} as const;
