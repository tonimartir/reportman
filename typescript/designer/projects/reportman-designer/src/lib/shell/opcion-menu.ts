/** A menu entry, the shape the designer inherited from the original host application's menus. */
export interface OpcionMenu {
  nombre: string;
  title?: string;
  disabled?: boolean;
  callback?: () => any;
  checked?: boolean;
  imagen?: string;
  /** A Material icon name; the numeric sprite indexes of the original host application are mapped in `iconName()`. */
  icono?: number | string;
  colorFondo?: string;
  colorTexto?: string;
  clasesCss?: string;
  informativo?: boolean;
  separador?: boolean;
  separadorCompleto?: boolean;
  opciones?: OpcionMenu[];
  obtenerOpciones?: () => OpcionMenu[] | Promise<OpcionMenu[]>;
}

/** Icons the designer names the way the original host application did (numeric sprite index or ng-icons name) → Material Icons. */
export function iconName(icono: number | string | undefined | null): string {
  if (icono === undefined || icono === null || icono === '') return '';
  if (typeof icono === 'number') {
    const numeric: Record<number, string> = {
      179: 'undo',
      180: 'redo',
      183: 'description',
      198: 'add',
      199: 'delete',
      200: 'arrow_upward',
      201: 'arrow_downward',
    };
    return numeric[icono] ?? 'circle';
  }
  const named: Record<string, string> = {
    matDeleteOutline: 'delete',
    tablerArrowForwardUp: 'redo',
    tablerArrowBackUp: 'undo',
    matFileCopyOutline: 'file_copy',
    matContentPaste: 'content_paste',
    matContentCutSharp: 'content_cut',
    matContentCopy: 'content_copy',
    matAdd: 'add',
    ionMenuOutline: 'menu',
    ionListOutline: 'list',
    bootstrapThreeDots: 'more_horiz',
    bootstrapCaretUpFill: 'arrow_drop_up',
    bootstrapCaretDownFill: 'arrow_drop_down',
    tablerSquare: 'crop_square',
    tablerRectangle: 'rectangle',
    tablerOvalVertical: 'panorama_fish_eye',
    tablerCircle: 'circle',
    matSquareOutline: 'crop_square',
    matRectangleOutline: 'rectangle',
    bootstrapTextareaT: 'text_fields',
    ionBarChartSharp: 'bar_chart',
    matBarcodeSharp: 'qr_code',
    matImageOutline: 'image',
    matImage: 'image',
    matTextFields: 'text_fields',
    matFunctions: 'functions',
    matCategory: 'category',
    matSave: 'save',
    matPrint: 'print',
    matVisibility: 'visibility',
    matRemove: 'remove',
    bootstrapJustify: 'format_align_justify',
    bootstrapLayersHalf: 'layers',
    bootstrapTextCenter: 'format_align_center',
    bootstrapTextLeft: 'format_align_left',
    bootstrapTextRight: 'format_align_right',
    ionSearch: 'search',
    matAlignVerticalBottomOutline: 'vertical_align_bottom',
    matAlignVerticalCenterOutline: 'vertical_align_center',
    matAlignVerticalTopOutline: 'vertical_align_top',
    matFormatBold: 'format_bold',
    matFormatItalic: 'format_italic',
    matFormatStrikethrough: 'format_strikethrough',
    matFormatUnderlined: 'format_underlined',
    tablerArrowNarrowDown: 'arrow_downward',
    tablerArrowNarrowUp: 'arrow_upward',
    tablerBoxModelOff: 'grid_off',
    tablerDots: 'more_horiz',
    tablerHistoryOff: 'history_toggle_off',
    tablerTextPlus: 'post_add',
  };
  return named[icono] ?? icono;
}
