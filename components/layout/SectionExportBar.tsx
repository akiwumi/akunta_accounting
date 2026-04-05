import { type Locale } from "@/lib/i18n/locale";
import { type ExportSection } from "@/lib/exports/sections";

type SectionExportBarProps = {
  locale: Locale;
  section: ExportSection;
  params?: Record<string, string | undefined | null>;
};

const copy = {
  en: {
    title: "Export This Section",
    excel: "Export Excel",
    pdf: "Export PDF"
  },
  sv: {
    title: "Exportera den här sidan",
    excel: "Exportera Excel",
    pdf: "Exportera PDF"
  }
} as const;

export const SectionExportBar = ({ locale, section, params }: SectionExportBarProps) => {
  const labels = copy[locale];
  const buildHref = (format: "excel" | "pdf") => {
    const query = new URLSearchParams({
      section,
      format
    });

    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (!value) return;
      query.set(key, value);
    });

    return `/api/exports/section?${query.toString()}`;
  };

  return (
    <div className="row" id={`${section}-export`}>
      <span className="note">{labels.title}</span>
      <a className="button secondary" href={buildHref("excel")}>
        {labels.excel}
      </a>
      <a className="button secondary" href={buildHref("pdf")}>
        {labels.pdf}
      </a>
    </div>
  );
};
