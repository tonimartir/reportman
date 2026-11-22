// The bytes PrintOutText writes for a text: the OEM code page 850 (OEMConvert, and the TM88 drivers
// that declare it), 858 (850 with the euro), UTF-8, and ISO-8859-1 (the data of the ESC/POS
// barcodes), as .NET encodes them. The code pages are those of System.Text.Encoding.CodePages,
// whose encoders fall back to the Windows "best fit" table and not to '?' only: 'ā' is written as
// 'a' and a combining acute accent as '´' in 850. The tables below are what .NET 10 writes for
// every UTF-16 code unit (golden-cs encoding 850 and 28591), and the test compares them with it.

/**
 * Code page 850, from U+0080 up: four hexadecimal digits of the code unit and two of the byte,
 * for every code unit .NET does not write as '?'. Below U+0080 the byte is the code unit.
 */
const CP850 =
  '00a0ff00a1ad00a2bd00a39c00a4cf00a5be00a6dd00a7f500a8f900a9b800aaa600abae00acaa00adf000aea900afee' +
  '00b0f800b1f100b2fd00b3fc00b4ef00b5e600b6f400b7fa00b8f700b9fb00baa700bbaf00bcac00bdab00bef300bfa8' +
  '00c0b700c1b500c2b600c3c700c48e00c58f00c69200c78000c8d400c99000cad200cbd300ccde00cdd600ced700cfd8' +
  '00d0d100d1a500d2e300d3e000d4e200d5e500d69900d79e00d89d00d9eb00dae900dbea00dc9a00dded00dee800dfe1' +
  '00e08500e1a000e28300e3c600e48400e58600e69100e78700e88a00e98200ea8800eb8900ec8d00eda100ee8c00ef8b' +
  '00f0d000f1a400f29500f3a200f49300f5e400f69400f7f600f89b00f99700faa300fb9600fc8100fdec00fee700ff98' +
  '010041010161010241010361010441010561010643010763010843010963010a43010b63010c43010d63010e44010f64' +
  '011044011164011245011365011445011565011645011765011845011965011a45011b65011c47011d67011e47011f67' +
  '012047012167012247012367012448012568012648012768012849012969012a49012b69012c49012d69012e49012f69' +
  '0130490131d501344a01356a01364b01376b01394c013a6c013b4c013c6c013d4c013e6c01414c01426c01434e01446e' +
  '01454e01466e01474e01486e014c4f014d6f014e4f014f6f01504f01516f01524f01536f015452015572015652015772' +
  '015852015972015a53015b73015c53015d73015e53015f73016053016173016254016374016454016574016654016774' +
  '016855016975016a55016b75016c55016d75016e55016f75017055017175017255017375017457017577017659017779' +
  '01785901795a017a7a017b5a017c7a017d5a017e7a01806201894401919f01929f019749019a6c019f4f01a04f01a16f' +
  '01a95301ab7401ae5401af5501b07501b65a01c0b301c32101cd4101ce6101cf4901d06901d14f01d26f01d35501d475' +
  '01d55501d67501d75501d87501d95501da7501db5501dc7501de4101df6101e44701e56701e64701e76701e84b01e96b' +
  '01ea4f01eb6f01ec4f01ed6f01f06a02616702789b02b9ef02ba2202bc2702c45e02c65e02c82702c9c402caef02cb27' +
  '02cd5f02daf802dc7e0300270301ef03025e03037e0304ee0305ee0308f9030af8030e220327f703315f03325f037e3b' +
  '03934703989d03a35303a64603a94f03b16103b2e103b46403b56503bce603c07003c37303c47403c66604bb6805893a' +
  '066a2520002020012020022020032020042020052020062020102d20112d20132d20142d2017f2201827201927201a27' +
  '201c22201d22201e222020c52021ce20220720240720262e2030252032ef2035ef20393c203a3e203c1320442f207030' +
  '207434207535207636207737207839207f6e2080302081fb2082fd2083fc208434208535208636208737208838208939' +
  '20a49c20a75020dd4f210243210745210a67210b48210c48210d48210e6821104921114921124c21136c21154e211850' +
  '211950211a51211b52211c52211d5221225421245a21264f21285a212a4b212b8f212c42212d43212e65212f65213045' +
  '21314621334d21346f21901b21911821921a21931921941d21951221a81722059d22115322122d2213f122152f22162f' +
  '22172a2218f8221907221a56221e38221f1c2223b322296e22363a223c7e22487e22613d22643d22653d226aae226baf' +
  '22c5fa23027f23035e2310aa23202823212923293c232a3e2500c42502b3250cda2510bf2514c02518d9251cc32524b4' +
  '252cc22534c1253cc52550cd2551ba2552c92553c92554c92555bb2556bb2557bb2558c82559c8255ac8255bbc255cbc' +
  '255dbc255ecc255fcc2560cc2561b92562b92563b92564cb2565cb2566cb2567ca2568ca2569ca256ace256bce256cce' +
  '2580df2584dc2588db258cdb2590db2591b02592b12593b225a0fe25ac1625b21e25ba1025bc1f25c41125cb0925d808' +
  '25d90a263a01263b02263c0f26400c26420b266006266305266503266604266a0d266b0e2713562758b330002030074f' +
  '30083c30093e300aae300baf301a5b301b5d30fbfaff0121ff0222ff0323ff0424ff0525ff0626ff0727ff0828ff0929' +
  'ff0a2aff0b2bff0c2cff0d2dff0e2eff0f2fff1030ff1131ff1232ff1333ff1434ff1535ff1636ff1737ff1838ff1939' +
  'ff1a3aff1b3bff1c3cff1d3dff1e3eff2040ff2141ff2242ff2343ff2444ff2545ff2646ff2747ff2848ff2949ff2a4a' +
  'ff2b4bff2c4cff2d4dff2e4eff2f4fff3050ff3151ff3252ff3353ff3454ff3555ff3656ff3757ff3858ff3959ff3a5a' +
  'ff3b5bff3c5cff3d5dff3e5eff3f5fff4060ff4161ff4262ff4363ff4464ff4565ff4666ff4767ff4868ff4969ff4a6a' +
  'ff4b6bff4c6cff4d6dff4e6eff4f6fff5070ff5171ff5272ff5373ff5474ff5575ff5676ff5777ff5878ff5979ff5a7a' +
  'ff5b7bff5c7cff5d7dff5e7e';

/**
 * ISO-8859-1 (code page 28591, the data of the ESC/POS barcodes), from U+0100 up, as CP850: below
 * U+0100 the byte is the code unit.
 */
const LATIN1 =
  '010041010161010241010361010441010561010643010763010843010963010a43010b63010c43010d63010e44010f64' +
  '011044011164011245011365011445011565011645011765011845011965011a45011b65011c47011d67011e47011f67' +
  '012047012167012247012367012448012568012648012768012849012969012a49012b69012c49012d69012e49012f69' +
  '01304901316901344a01356a01364b01376b01394c013a6c013b4c013c6c013d4c013e6c01414c01426c01434e01446e' +
  '01454e01466e01474e01486e014c4f014d6f014e4f014f6f01504f01516f01524f01536f015452015572015652015772' +
  '015852015972015a53015b73015c53015d73015e53015f73016053016173016254016374016454016574016654016774' +
  '016855016975016a55016b75016c55016d75016e55016f75017055017175017255017375017457017577017659017779' +
  '01785901795a017a7a017b5a017c7a017d5a017e7a018062018944019146019266019749019a6c019f4f01a04f01a16f' +
  '01ab7401ae5401af5501b07501b67a01cd4101ce6101cf4901d06901d14f01d26f01d35501d47501d55501d67501d755' +
  '01d87501d95501da7501db5501dc7501de4101df6101e44701e56701e64701e76701e84b01e96b01ea4f01eb6f01ec4f' +
  '01ed6f01f06a02616702b92702ba2202bc2702c45e02c65e02c82702cb6002cd5f02dc7e03006003025e03037e030e22' +
  '03315f03325f20002020012020022020032020042020052020062020102d20112d20132d20142d201827201927201a2c' +
  '201c22201d22201e2220222e20262e20322720356020393c203a3e212254ff0121ff0222ff0323ff0424ff0525ff0626' +
  'ff0727ff0828ff0929ff0a2aff0b2bff0c2cff0d2dff0e2eff0f2fff1030ff1131ff1232ff1333ff1434ff1535ff1636' +
  'ff1737ff1838ff1939ff1a3aff1b3bff1c3cff1d3dff1e3eff2040ff2141ff2242ff2343ff2444ff2545ff2646ff2747' +
  'ff2848ff2949ff2a4aff2b4bff2c4cff2d4dff2e4eff2f4fff3050ff3151ff3252ff3353ff3454ff3555ff3656ff3757' +
  'ff3858ff3959ff3a5aff3b5bff3c5cff3d5dff3e5eff3f5fff4060ff4161ff4262ff4363ff4464ff4565ff4666ff4767' +
  'ff4868ff4969ff4a6aff4b6bff4c6cff4d6dff4e6eff4f6fff5070ff5171ff5272ff5373ff5474ff5575ff5676ff5777' +
  'ff5878ff5979ff5a7aff5b7bff5c7cff5d7dff5e7e';

let cp850Map: Map<number, number> | null = null;
let latin1Map: Map<number, number> | null = null;

function hexMap(table: string): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < table.length; i += 6) map.set(parseInt(table.slice(i, i + 4), 16), parseInt(table.slice(i + 4, i + 6), 16));
  return map;
}

function cp850(): Map<number, number> {
  if (cp850Map === null) cp850Map = hexMap(CP850);
  return cp850Map;
}

/** The code pages PrintOutText writes text in. */
export type TextCodePage = 850 | 858 | 65001;

/**
 * A text in code page 850 or 858 (Encoding.GetEncoding(n).GetBytes, and the same through
 * Encoding.Convert from UTF-8): one byte per UTF-16 code unit, so a surrogate pair is "??" and a
 * lone surrogate "?", as .NET writes them.
 */
export function encodeOem(text: string, codepage: 850 | 858 = 850): Uint8Array {
  const map = cp850();
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let b: number | undefined;
    if (c < 0x80) b = c;
    // 858 is 850 with the euro where 850 has the dotless i, which then falls back to 'i'
    else if (codepage === 858 && c === 0x20ac) b = 0xd5;
    else if (codepage === 858 && c === 0x0131) b = 0x69;
    else b = map.get(c);
    out[i] = b ?? 0x3f;
  }
  return out;
}

/** A text in ISO-8859-1 (Encoding.GetEncoding(28591).GetBytes, with the best fit of .NET). */
export function encodeLatin1(text: string): Uint8Array {
  if (latin1Map === null) latin1Map = hexMap(LATIN1);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c < 0x100 ? c : (latin1Map.get(c) ?? 0x3f);
  }
  return out;
}

/** A text in UTF-8 (Encoding.UTF8.GetBytes): a lone surrogate is U+FFFD (EF BF BD). */
export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

/** A text in a code page PrintOutText writes. */
export function encodeText(text: string, codepage: TextCodePage): Uint8Array {
  return codepage === 65001 ? encodeUtf8(text) : encodeOem(text, codepage);
}

/**
 * Code page 437 from 0x80 up, as .NET decodes it (Encoding.GetEncoding(437).GetString): the bytes
 * below 0x80 are the ASCII characters, the control codes included.
 */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/**
 * The text of bytes in code page 437 (Encoding.GetEncoding(437).GetString). Reportman.Server reads
 * the bytes of its text format this way (PrintOutText.PrintResult) before it answers them in UTF-8.
 */
export function decodeCp437(bytes: Uint8Array): string {
  const units = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    units[i] = b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80]!;
  }
  return units.join('');
}
