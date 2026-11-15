/**
 * A small PDF writer for customer documents (invoices, quotes).
 *
 * Uses the built-in Helvetica fonts with WinAnsi encoding, so Swedish letters
 * print correctly, and knows the glyph widths, so amounts can be right-aligned
 * and long text wrapped. Coordinates are in points from the top-left corner.
 */

export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;

// Glyph widths (per 1000 units) for character codes 32 to 126, from the Adobe font metrics.
const REGULAR_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584
];
const BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584
];

// Accented Latin-1 letters share the width of their base letter.
const LATIN1_BASE: Record<number, string> = {};
const addBase = (base: string, accented: string) => {
  for (const char of accented) LATIN1_BASE[char.charCodeAt(0)] = base;
};
addBase("A", "ÀÁÂÃÄÅ");
addBase("C", "Ç");
addBase("E", "ÈÉÊË");
addBase("I", "ÌÍÎÏ");
addBase("N", "Ñ");
addBase("O", "ÒÓÔÕÖØ");
addBase("U", "ÙÚÛÜ");
addBase("Y", "Ý");
addBase("a", "àáâãäå");
addBase("c", "ç");
addBase("e", "èéêë");
addBase("i", "ìíîï");
addBase("n", "ñ");
addBase("o", "òóôõöø");
addBase("u", "ùúûü");
addBase("y", "ýÿ");

// Characters outside Latin-1 that WinAnsi can still show, or that have a plain stand-in.
const UNICODE_TO_WINANSI: Record<number, number> = {
  0x20ac: 0x80,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x2212: 0x2d,
  0x00a0: 0x20,
  0x202f: 0x20,
  0x2009: 0x20
};

const toWinAnsi = (value: string): number[] => {
  const codes: number[] = [];
  for (const char of value.replace(/[\r\n\t]+/g, " ")) {
    const code = char.codePointAt(0) ?? 63;
    if (UNICODE_TO_WINANSI[code] !== undefined) codes.push(UNICODE_TO_WINANSI[code]);
    else if ((code >= 32 && code <= 126) || (code >= 161 && code <= 255)) codes.push(code);
    else codes.push(63);
  }
  return codes;
};

const widthOfCode = (code: number, bold: boolean) => {
  const table = bold ? BOLD_WIDTHS : REGULAR_WIDTHS;
  if (code >= 32 && code <= 126) return table[code - 32];
  if (code === 0x80) return 556;
  const base = LATIN1_BASE[code];
  if (base) return table[base.charCodeAt(0) - 32];
  return 556;
};

export const textWidth = (value: string, size: number, bold = false) =>
  (toWinAnsi(value).reduce((sum, code) => sum + widthOfCode(code, bold), 0) * size) / 1000;

/** Splits text into lines no wider than maxWidth. Existing line breaks are kept. */
export const wrapText = (value: string, maxWidth: number, size: number, bold = false): string[] => {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const rawWord of words) {
      let word = rawWord;
      // A single word wider than the column is cut so it cannot overflow.
      while (textWidth(word, size, bold) > maxWidth && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && textWidth(word.slice(0, cut), size, bold) > maxWidth) cut -= 1;
        if (current) {
          lines.push(current);
          current = "";
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const candidate = current ? `${current} ${word}` : word;
      if (textWidth(candidate, size, bold) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
};

const literal = (value: string) => {
  let out = "(";
  for (const code of toWinAnsi(value)) {
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`;
    else if (code > 126) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
};

export type Rgb = [number, number, number];

export type TextOptions = {
  size?: number;
  bold?: boolean;
  align?: "left" | "right";
  color?: Rgb;
};

const num = (value: number) => (Math.round(value * 100) / 100).toString();

export class PdfDocument {
  private pages: string[][] = [[]];

  get pageCount() {
    return this.pages.length;
  }

  addPage() {
    this.pages.push([]);
  }

  private get current() {
    return this.pages[this.pages.length - 1];
  }

  /** Draws one line of text. With align "right", x is the right edge. */
  text(value: string, x: number, y: number, options: TextOptions = {}) {
    if (!value) return;
    const size = options.size ?? 10;
    const bold = options.bold ?? false;
    const [r, g, b] = options.color ?? [0.1, 0.11, 0.12];
    const left = options.align === "right" ? x - textWidth(value, size, bold) : x;
    this.current.push(
      `BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${num(r)} ${num(g)} ${num(b)} rg ${num(left)} ${num(PAGE_HEIGHT - y)} Td ${literal(value)} Tj ET`
    );
  }

  rect(x: number, y: number, width: number, height: number, fill: Rgb) {
    const [r, g, b] = fill;
    this.current.push(
      `${num(r)} ${num(g)} ${num(b)} rg ${num(x)} ${num(PAGE_HEIGHT - y - height)} ${num(width)} ${num(height)} re f`
    );
  }

  build(): Buffer {
    const pageCount = this.pages.length;
    const fontRegular = 3;
    const fontBold = 4;
    const pageObject = (index: number) => 5 + index * 2;
    const contentObject = (index: number) => 6 + index * 2;
    const maxObject = 4 + pageCount * 2;

    let pdf = "%PDF-1.4\n";
    const offsets: number[] = new Array(maxObject + 1).fill(0);
    const push = (objectNumber: number, body: string) => {
      offsets[objectNumber] = pdf.length;
      pdf += `${objectNumber} 0 obj\n${body}\nendobj\n`;
    };

    push(1, "<< /Type /Catalog /Pages 2 0 R >>");
    push(
      2,
      `<< /Type /Pages /Kids [${this.pages.map((_page, index) => `${pageObject(index)} 0 R`).join(" ")}] /Count ${pageCount} >>`
    );
    push(fontRegular, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    push(fontBold, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

    this.pages.forEach((commands, index) => {
      push(
        pageObject(index),
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentObject(index)} 0 R >>`
      );
      const stream = `${commands.join("\n")}\n`;
      push(contentObject(index), `<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    });

    const xrefStart = pdf.length;
    pdf += `xref\n0 ${maxObject + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= maxObject; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    // Every character written above is below 256, so latin1 keeps one byte per character.
    return Buffer.from(pdf, "latin1");
  }
}
