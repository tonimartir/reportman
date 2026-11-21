import { translateNum } from "../i18n/i18n.js";

export class PageUtils {
  public static readonly PageSizeArray: [number, number][] = [
    [8268, 11693], // psA4
    [7165, 10118], // psB5
    [8500, 11000], // psLetter
    [8500, 14000], // psLegal
    [7500, 10000], // psExecutive
    [33110, 46811], // psA0
    [23386, 33110], // psA1
    [16535, 23386], // psA2
    [11693, 16535], // psA3
    [5827, 8268], // psA5
    [4134, 5827], // psA6
    [2913, 4134], // psA7
    [2047, 2913], // psA8
    [1457, 2047], // psA9
    [40551, 57323], // psB0
    [28661, 40551], // psB1
    [1260, 1772], // psB10
    [20276, 28661], // psB2
    [14331, 20276], // psB3
    [10118, 14331], // psB4
    [5039, 7165], // psB6
    [3583, 5039], // psB7
    [2520, 3583], // psB8
    [1772, 2520], // psB9
    [6417, 9016], // psC5E
    [4125, 9500], // psComm10E
    [4331, 8661], // psDLE
    [8250, 13000], // psFolio
    [17000, 11000], // psLedger
    [11000, 17000], // psTabloid
    [-1, -1], // psNPageSize
    // Windows equivalents begins at 31
    [8500, 11000], // Letter 8 12 x 11 in
    [8500, 11000], // Letter Small 8 12 x 11 in
    [11000, 17000], // Tabloid 11 x 17 in
    [17000, 11000], // Ledger 17 x 11 in
    [8500, 14000], // Legal 8 12 x 14 in
    [55000, 8500], // Statement 5 12 x 8 12 in
    [7500, 10500], // Executive 7 14 x 10 12 in
    [11693, 16535], // A3 297 x 420 mm
    [8268, 11693], // A4 210 x 297 mm
    [8268, 11693], // A4 Small 210 x 297 mm
    [5827, 8268], // A5 148 x 210 mm
    [10118, 14331], // B4 (JIS) 250 x 354
    [7165, 10118], // B5 (JIS) 182 x 257 mm
    [8250, 13000], // Folio 8 12 x 13 in
    [8465, 10827], // Quarto 215 x 275 mm
    [10000, 14000], // 10x14 in
    [11000, 17000], // 11x17 in
    [8500, 11000], // Note 8 12 x 11 in
    [3875, 8875], // Envelope #9 3 78 x 8 78
    [4125, 9500], // Envelope #10 4 18 x 9 12
    [4500, 10375], // Envelope #11 4 12 x 10 38
    [4276, 11000], // Envelope #12 4 \276 x 11
    [5000, 11500], // Envelope #14 5 x 11 12
    [16969, 21969], // C size sheet 431 x 558 mm
    [21969, 33976], // D size sheet 558 x 863 mm
    [33976, 43976], // E size sheet 863 x 1117 mm
    [4331, 8661], // Envelope DL 110 x 220mm
    [6378, 9016], // Envelope C5 162 x 229 mm
    [12756, 18031], // Envelope C3  324 x 458 mm
    [9016, 12756], // Envelope C4  229 x 324 mm
    [4488, 6378], // Envelope C6  114 x 162 mm
    [4488, 9016], // Envelope C65 114 x 229 mm
    [9843, 13898], // Envelope B4  250 x 353 mm
    [6929, 9843], // Envelope B5  176 x 250 mm
    [6929, 4921], // Envelope B6  176 x 125 mm
    [4331, 9056], // Envelope 110 x 230 mm
    [3875, 7500], // Envelope Monarch 3.875 x 7.5 in
    [3625, 6500], // 6 34 Envelope 3 58 x 6 12 in
    [14875, 11000], // US Std Fanfold 14 78 x 11 in
    [8500, 12000], // German Std Fanfold 8 12 x 12 in
    [8500, 13000], // German Legal Fanfold 8 12 x 13 in
    [9843, 13898], // B4 (ISO) 250 x 353 mm
    [3937, 5827], // Japanese Postcard 100 x 148 mm
    [9000, 11000], // 9 x 11 in
    [10000, 11000], // 10 x 11 in
    [15000, 11000], // 15 x 11 in
    [8661, 8661], // Envelope Invite 220 x 220 mm
    [100, 100], // RESERVED--DO NOT USE
    [100, 100], // RESERVED--DO NOT USE
    [9275, 12000], // Letter Extra 9 \275 x 12 in
    [9275, 15000], // Legal Extra 9 \275 x 15 in
    [11690, 18000], // Tabloid Extra 11.69 x 18 in
    [9270, 12690], // A4 Extra 9.27 x 12.69 in
    [8275, 11000], // Letter Transverse 8 \275 x 11 in
    [8268, 11693], // A4 Transverse 210 x 297 mm
    [9275, 12000], // Letter Extra Transverse 9\275 x 12 in
    [8937, 14016], // SuperASuperAA4 227 x 356 mm
    [12008, 19172], // SuperBSuperBA3 305 x 487 mm
    [8500, 12690], // Letter Plus 8.5 x 12.69 in
    [8268, 12992], // A4 Plus 210 x 330 mm
    [5828, 8268], // A5 Transverse 148 x 210 mm
    [7166, 10118], // B5 (JIS) Transverse 182 x 257 mm
    [13071, 17520], // A3 Extra 322 x 445 mm
    [6850, 9252], // A5 Extra 174 x 235 mm
    [7913, 10867], // B5 (ISO) Extra 201 x 276 mm
    [16536, 23386], // A2 420 x 594 mm
    [11693, 16535], // A3 Transverse 297 x 420 mm
    [13071, 17520], // A3 Extra Transverse 322 x 445 mm
    [7874, 5827], // Japanese Double Postcard 200 x 148 mm
    [4173, 5827], // A6 105 x 148 mm
    [9449, 13071], // Japanese Envelope Kaku #2 240 x 332 mm
    [8504, 10906], // Japanese Envelope Kaku #3 216 x 277 mm
    [4724, 9252], // Japanese Envelope Chou #3 120 x 235 mm
    [3543, 8071], // Japanese Envelope Chou #4  90 x 205 mm
    [11000, 8500], // Letter Rotated 11 x 8 1/2 11 in
    [16535, 11693], // A3 Rotated 420 x 297 mm
    [11693, 8268], // A4 Rotated 297 x 210 mm
    [8268, 5828], // A5 Rotated 210 x 148 mm
    [14331, 10118], // B4 (JIS) Rotated 364 x 257 mm
    [10118, 7165], // B5 (JIS) Rotated 257 x 182 mm
    [5827, 3937], // Japanese Postcard Rotated 148 x 100 mm
    [5827, 7874], // Double Japanese Postcard Rotated 148 x 200 mm
    [5827, 4173], // A6 Rotated 148 x 105 mm
    [13071, 9449], // Japanese Envelope Kaku #2 Rotated
    [10906, 8504], // Japanese Envelope Kaku #3 Rotated
    [9252, 4724], // Japanese Envelope Chou #3 Rotated
    [8071, 3543], // Japanese Envelope Chou #4 Rotated
    [5039, 7165], // B6 (JIS) 128 x 182 mm
    [7165, 5039], // B6 (JIS) Rotated 182 x 128 mm
    [12000, 11000], // 12 x 11 in
    [4134, 9252], // Japanese Envelope You #4 105 x 235 mm
    [9252, 4134], // Japanese Envelope You #4 Rotated
    [5748, 8465], // PRC 16K 146 x 215 mm
    [3819, 5945], // PRC 32K 97 x 151 mm
    [3819, 5945], // PRC 32K(Big) 97 x 151 mm
    [4134, 6496], // PRC Envelope #1 102 x 165 mm
    [4134, 6929], // PRC Envelope #2 102 x 176 mm
    [4921, 5929], // PRC Envelope #3 125 x 176 mm
    [4331, 8189], // PRC Envelope #4 110 x 208 mm
    [4331, 8661], // PRC Envelope #5 110 x 220 mm
    [4724, 9055], // PRC Envelope #6 120 x 230 mm
    [6299, 9055], // PRC Envelope #7 160 x 230 mm
    [4724, 12165], // PRC Envelope #8 120 x 309 mm
    [9016, 12756], // PRC Envelope #9 229 x 324 mm
    [12756, 18031], // PRC Envelope #10 324 x 458 mm
    [8465, 5748], // PRC 16K Rotated
    [5945, 3819], // PRC 32K Rotated
    [5945, 3819], // PRC 32K(Big) Rotated
    [6496, 4134], // PRC Envelope #1 Rotated 165 x 102 mm
    [6929, 4134], // PRC Envelope #2 Rotated 176 x 102 mm
    [6929, 4921], // PRC Envelope #3 Rotated 176 x 125 mm
    [8189, 4331], // PRC Envelope #4 Rotated 208 x 110 mm
    [8661, 4331], // PRC Envelope #5 Rotated 220 x 110 mm
    [9055, 4724], // PRC Envelope #6 Rotated 230 x 120 mm
    [9055, 6299], // PRC Envelope #7 Rotated 230 x 160 mm
    [12165, 4724], // PRC Envelope #8 Rotated 309 x 120 mm
    [12756, 9016], // PRC Envelope #9 Rotated 324 x 229 mm
    [18031, 12756], // PRC Envelope #10 Rotated 458 x 324 mm
  ];

  private static readonly pageSizeMap: Record<number, string> = {
    0: "A4",
    1: "B5",
    2: "Letter",
    3: "Legal",
    4: "Executive",
    5: "A0",
    6: "A1",
    7: "A2",
    8: "A3",
    9: "A5",
    10: "A6",
    11: "A7",
    12: "A8",
    13: "A9",
    14: "B0",
    15: "B1",
    16: "B10",
    17: "B2",
    18: "B3",
    19: "B4",
    20: "B6",
    21: "B7",
    22: "B8",
    23: "B9",
    24: "C5E",
    25: "C10E",
    26: "DLE",
    27: "Folio",
    28: "Ledger",
    29: "Tabloid",
    30: "Custom",
    31: "Letter", // Windows
    32: "Letter Small", // Windows
    33: "Tabloid",
    34: "Ledger",
    35: "Legal",
    36: "Statement",
    37: "Executive",
    38: "A3",
    39: "A4",
    40: "A4 Small",
    41: "A5",
    42: "B4",
    43: "B5",
    44: "Folio",
    45: "Quarto",
    46: "10x14 in",
    47: "11x17 in",
    48: "Note",
    49: "Envelope #9",
    50: "Envelope #10",
    51: "Envelope #11",
    52: "Envelope #12",
    53: "Envelope #14",
    54: "C",
    55: "D",
    56: "E",
    57: "Envelope DL",
    58: "Envelope C5",
    59: "Envelope C3",
    60: "Envelope C4",
    61: "Envelope C6",
    62: "Envelope C65",
    63: "Envelope B4",
    64: "Envelope B5",
    65: "Envelope B6",
    66: "Envelope",
    67: "Envelope Monarch",
    68: "Envelope 6 34",
    69: "US Std Fanfold",
    70: "German Std Fanfold",
    71: "German Legal Fanfold",
    72: "B4 ISO",
    73: "Japanese Postcard",
    74: "9x11 in",
    75: "10x11 in",
    76: "15x11 in",
    77: "Envelope invite",
    78: "---",
    79: "---",
    80: "Letter Extra 1",
    81: "Letter Extra 2",
    82: "Tabloid Extra",
    83: "A4 Extra",
    84: "Letter trans.",
    85: "A4 trans.",
    86: "Letter Extra trans.",
    87: "SuperASuperAA4",
    88: "SuperVSuperBA3",
    89: "Letter Plus",
    90: "A4 Plus",
    91: "A5 trans.",
    92: "B5 trans.",
    93: "A3 Extra",
    94: "A5 Extra",
    95: "B5 Extra",
    96: "A2",
    97: "A3 trans.",
    98: "A3 Extra trans.",
    99: "Japanese Double Postcard",
    100: "A6",
    101: "Japanese Envelope Kaku #2",
    102: "Japanese Envelope Kaku #3",
    103: "Japanese Envelope Chou #3",
    104: "Japanese Envelope Chou #4",
    105: "Letter Rotated",
    106: "A3 Rotated",
    107: "A4 Rotated",
    108: "A5 Rotated",
    109: "B4 Rotated",
    110: "B5 Rotated",
    111: "Japanese Postcard Rotated",
    112: "Double Japanese Postcard Rotated",
    113: "A6 Rotated",
    114: "Japanese Envelope Kaku #2 Rotated",
    115: "Japanese Envelope Kaku #3 Rotated",
    116: "Japanese Envelope Chou #3 Rotated",
    117: "Japanese Envelope Chou #4 Rotated",
    // 118 no estaba definido en el original → se cubrirá con Unknown
    119: "B6",
    120: "B6 Rotated",
    121: "12x11 in",
    122: "Japanese Envelope You #4",
    123: "Japanese Envelope You #4 Rotated",
    124: "PRC 16K",
    125: "PRC 32K",
    126: "PRC 32K (Big)",
    127: "PRC Envelope #1",
    128: "PRC Envelope #2",
    129: "PRC Envelope #3",
    130: "PRC Envelope #4",
    131: "PRC Envelope #5",
    132: "PRC Envelope #6",
    133: "PRC Envelope #7",
    134: "PRC Envelope #8",
    135: "PRC Envelope #9",
    136: "PRC Envelope #10",
    137: "PRC 16K Rotated",
    138: "PRC 32K Rotated",
    139: "PRC 32K (Big) Rotated",
    140: "PRC Envelope #1 Rotated",
    141: "PRC Envelope #2 Rotated",
    142: "PRC Envelope #3 Rotated",
    143: "PRC Envelope #4 Rotated",
    144: "PRC Envelope #5 Rotated",
    145: "PRC Envelope #6 Rotated",
    146: "PRC Envelope #7 Rotated",
    147: "PRC Envelope #8 Rotated",
    148: "PRC Envelope #9 Rotated",
    149: "PRC Envelope #10 Rotated",
  };
  public static MaxIndex = 149;

  public static pageSizeName(index: number): string {
    const value = PageUtils.pageSizeMap[index];
    if (!value) {
      return "";
    }
    return value;
  }
  public static pageSizeNames(): string[] {
    const names: string[] = [];
    for (let i = 0; i <= 149; i++) {
      names.push(PageUtils.pageSizeMap[i]);
    }
    return names;
  }
  public static GetLanguageKeys(): string[] {
    return [
      "en-US",
      "es-ES",
      "ca-ES",
      "fr-FR",
      "pt-PT",
      "de-DE",
      "it-IT",
      "tr-TR",
      "lt-LT",
      "el-GR",
      "hu-hu",
      "da-DK",
      "nl-NL",
      "es-MX",
    ];
  }
  public static GetLanguageDescriptions(): string[] {
    return [
      translateNum(264),
      translateNum(265),
      translateNum(266),
      translateNum(953),
      translateNum(1218),
      translateNum(1219),
      translateNum(1220),
      translateNum(1258),
      translateNum(1383),
      translateNum(1387),
      translateNum(1388),
      translateNum(1384),
      translateNum(1385),
      translateNum(1386),
    ];
  }
  public static getPaperSources(): string[] {
    return [
      translateNum(95),
      translateNum(1287),
      translateNum(1288),
      translateNum(1289),
      translateNum(1290),
      translateNum(1291),
      translateNum(1292),
      translateNum(1293),
      translateNum(1294),
      translateNum(1295),
      translateNum(1296),
      translateNum(1297),
      "---",
      "---",
      translateNum(1299),
    ];
  }
  public static getPrinterNames(): string[] {
    return [
      translateNum(467),
      translateNum(468),
      translateNum(469),
      translateNum(470),
      translateNum(471),
      translateNum(472),
      translateNum(473),
      translateNum(474),
      translateNum(475),
      translateNum(476),
      translateNum(477),
      translateNum(478),
      translateNum(479),
      translateNum(480),
      translateNum(481),
      translateNum(482),
    ];
  }
}
