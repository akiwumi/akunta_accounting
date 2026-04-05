const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT_MARGIN = 42;
const START_Y = 800;
const HEADER_LINE_HEIGHT = 16;
const BODY_LINE_HEIGHT = 12;
const BODY_LINES_PER_PAGE = 56;

const sanitizePdfText = (value: string) =>
  value
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const wrapLine = (value: string, maxLength = 96) => {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return [""];
  if (clean.length <= maxLength) return [clean];

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length <= maxLength) {
      current = `${current} ${word}`;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
};

const chunkLines = (lines: string[], chunkSize: number) => {
  const chunks: string[][] = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    chunks.push(lines.slice(i, i + chunkSize));
  }
  return chunks.length > 0 ? chunks : [[]];
};

type PdfInput = {
  title: string;
  subtitle?: string;
  lines: string[];
};

export const buildSimplePdf = ({ title, subtitle, lines }: PdfInput): Buffer => {
  const normalizedLines = lines.flatMap((line) => wrapLine(line));
  const pages = chunkLines(normalizedLines, BODY_LINES_PER_PAGE);
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

  const contentStreams = pages.map((pageLines, pageIndex) => {
    const commands: string[] = [];
    commands.push("BT");
    commands.push("/F1 15 Tf");
    commands.push(`${LEFT_MARGIN} ${START_Y} Td`);
    commands.push(`(${sanitizePdfText(title)}) Tj`);

    commands.push("/F1 9 Tf");
    commands.push(`0 -${HEADER_LINE_HEIGHT} Td`);
    commands.push(`(${sanitizePdfText(`Generated: ${generatedAt}`)}) Tj`);

    if (subtitle) {
      commands.push(`0 -${HEADER_LINE_HEIGHT} Td`);
      commands.push(`(${sanitizePdfText(subtitle)}) Tj`);
    }

    commands.push(`0 -${HEADER_LINE_HEIGHT} Td`);
    commands.push(`(${sanitizePdfText(`Page ${pageIndex + 1} of ${pages.length}`)}) Tj`);

    commands.push("/F1 10 Tf");
    for (const line of pageLines) {
      commands.push(`0 -${BODY_LINE_HEIGHT} Td`);
      commands.push(`(${sanitizePdfText(line)}) Tj`);
    }
    commands.push("ET");
    return `${commands.join("\n")}\n`;
  });

  const pageCount = contentStreams.length;
  const firstPageObject = 3;
  const pageObjectFor = (index: number) => firstPageObject + index * 2;
  const contentObjectFor = (index: number) => firstPageObject + index * 2 + 1;
  const fontObject = firstPageObject + pageCount * 2;
  const maxObject = fontObject;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = new Array(maxObject + 1).fill(0);
  const pushObject = (objectNumber: number, body: string) => {
    offsets[objectNumber] = Buffer.byteLength(pdf, "binary");
    pdf += `${objectNumber} 0 obj\n${body}\nendobj\n`;
  };

  const pageReferences = pages.map((_, index) => `${pageObjectFor(index)} 0 R`).join(" ");

  pushObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  pushObject(2, `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageCount} >>`);

  pages.forEach((_, index) => {
    pushObject(
      pageObjectFor(index),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObjectFor(index)} 0 R >>`
    );
    const stream = contentStreams[index];
    const streamLength = Buffer.byteLength(stream, "binary");
    pushObject(contentObjectFor(index), `<< /Length ${streamLength} >>\nstream\n${stream}endstream`);
  });

  pushObject(fontObject, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const xrefStart = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${maxObject + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= maxObject; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "binary");
};
