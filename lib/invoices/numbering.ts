const DEFAULT_INVOICE_NUMBER_PATTERN = "INV-{YYYY}-{SEQ:4}";

const pad = (value: number, width: number) => String(value).padStart(width, "0");

export const sanitizeInvoiceNumberPattern = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return DEFAULT_INVOICE_NUMBER_PATTERN;
  if (trimmed.length > 80) return trimmed.slice(0, 80);
  return trimmed;
};

export const formatInvoiceNumber = (input: {
  pattern?: string | null;
  sequence: number;
  issueDate: Date;
}) => {
  const pattern = sanitizeInvoiceNumberPattern(input.pattern);
  const date = input.issueDate;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const sequence = Math.max(1, Math.trunc(input.sequence));

  let rendered = pattern
    .replaceAll("{YYYY}", String(year))
    .replaceAll("{YY}", pad(year % 100, 2))
    .replaceAll("{MM}", pad(month, 2))
    .replaceAll("{DD}", pad(day, 2));

  let hasSequenceToken = false;
  rendered = rendered.replace(/\{SEQ(?::(\d{1,2}))?\}/g, (_full, widthRaw: string | undefined) => {
    hasSequenceToken = true;
    const width = widthRaw ? Number(widthRaw) : 4;
    const safeWidth = Number.isFinite(width) && width >= 1 && width <= 12 ? width : 4;
    return pad(sequence, safeWidth);
  });

  if (!hasSequenceToken) {
    rendered = `${rendered}-${pad(sequence, 4)}`;
  }

  return rendered.replace(/\s+/g, "").slice(0, 60);
};

export const getDefaultInvoiceNumberPattern = () => DEFAULT_INVOICE_NUMBER_PATTERN;
