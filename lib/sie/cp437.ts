/**
 * IBM PC 8-bit extended ASCII (codepage 437), the only character set the SIE
 * standard allows ("#FORMAT PC8", SIE filformat 4B section 5.8).
 *
 * Bytes 0x00-0x7F are plain ASCII. The string below is bytes 0x80-0xFF in order.
 */
const HIGH_HALF =
  "ÇüéâäàåçêëèïîìÄÅ" +
  "ÉæÆôöòûùÿÖÜ¢£¥₧ƒ" +
  "áíóúñÑªº¿⌐¬½¼¡«»" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩" +
  "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

const UNICODE_TO_BYTE = new Map<string, number>();
for (let i = 0; i < HIGH_HALF.length; i += 1) {
  UNICODE_TO_BYTE.set(HIGH_HALF[i], 0x80 + i);
}

/** Common characters that codepage 437 lacks, written with what it does have. */
const TRANSLITERATIONS: Record<string, string> = {
  "–": "-",
  "—": "-",
  "−": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "€": "EUR",
  "Ø": "O",
  "ø": "o",
  "•": "·"
};

const isEncodable = (char: string) => char.charCodeAt(0) < 0x80 || UNICODE_TO_BYTE.has(char);

/**
 * Rewrite text so that every character exists in codepage 437. Letters with
 * an accent the codepage lacks lose the accent (ã becomes a); anything else
 * unknown becomes "?". Run this before quoting a field, because a typographic
 * quote turns into a plain one that then needs escaping.
 */
export const toCp437Text = (text: string): string => {
  let out = "";
  for (const char of text.normalize("NFC")) {
    if (char.length === 1 && isEncodable(char)) {
      out += char;
      continue;
    }
    const replacement = TRANSLITERATIONS[char];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    const base = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += base.length > 0 && [...base].every((c) => c.length === 1 && isEncodable(c)) ? base : "?";
  }
  return out;
};

export const encodeCp437 = (text: string): Uint8Array => {
  const safe = toCp437Text(text);
  const bytes = new Uint8Array(safe.length);
  for (let i = 0; i < safe.length; i += 1) {
    const code = safe.charCodeAt(i);
    bytes[i] = code < 0x80 ? code : (UNICODE_TO_BYTE.get(safe[i]) ?? 0x3f);
  }
  return bytes;
};

export const decodeCp437 = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    out += byte < 0x80 ? String.fromCharCode(byte) : HIGH_HALF[byte - 0x80];
  }
  return out;
};

export type SieEncoding = "cp437" | "latin1" | "utf8";

// å ä ö Å Ä Ö é ü in each single-byte encoding.
const CP437_SWEDISH = new Set([0x86, 0x84, 0x94, 0x8f, 0x8e, 0x99, 0x82, 0x81]);
const LATIN1_SWEDISH = new Set([0xe5, 0xe4, 0xf6, 0xc5, 0xc4, 0xd6, 0xe9, 0xfc]);

/**
 * Decode a SIE file. The standard says codepage 437, but files written as
 * UTF-8 or Latin-1 (Windows-1252) are common in practice, so the encoding is
 * detected rather than trusted:
 *   1. a UTF-8 byte order mark, or bytes that are valid UTF-8 with at least
 *      one multi-byte character, mean UTF-8 (å ä ö in codepage 437 are bare
 *      continuation bytes, which is never valid UTF-8);
 *   2. otherwise whichever of codepage 437 and Latin-1 yields more Swedish
 *      letters wins, with codepage 437 as the default.
 */
export const decodeSieBytes = (bytes: Uint8Array): { text: string; encoding: SieEncoding } => {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;

  let cp437Score = 0;
  let latin1Score = 0;
  let highBytes = 0;
  for (let i = 0; i < body.length; i += 1) {
    const byte = body[i];
    if (byte < 0x80) continue;
    highBytes += 1;
    if (CP437_SWEDISH.has(byte)) cp437Score += 1;
    if (LATIN1_SWEDISH.has(byte)) latin1Score += 1;
  }

  if (hasBom || highBytes > 0) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
      return { text, encoding: "utf8" };
    } catch {
      if (hasBom) return { text: new TextDecoder("utf-8").decode(body), encoding: "utf8" };
    }
  }

  if (latin1Score > cp437Score) {
    return { text: new TextDecoder("windows-1252").decode(body), encoding: "latin1" };
  }
  return { text: decodeCp437(body), encoding: "cp437" };
};
