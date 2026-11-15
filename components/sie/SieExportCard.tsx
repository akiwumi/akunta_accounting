import { type Locale } from "@/lib/i18n/locale";

type SieExportCardProps = {
  locale: Locale;
  /** Calendar years that have anything booked, newest first. */
  years: number[];
};

/**
 * A plain GET form: the browser downloads the file itself, so the card works
 * without any client-side script.
 */
export const SieExportCard = ({ locale, years }: SieExportCardProps) => {
  const copy =
    locale === "sv"
      ? {
          title: "Ta ut din bokföring",
          intro:
            "Ladda ner ett räkenskapsår som SIE-fil. Filen innehåller kontoplanen, ingående och utgående balanser och varje verifikation, även makulerade och deras rättelser. Din redovisningskonsult kan öppna den i vilket svenskt bokföringsprogram som helst.",
          year: "Räkenskapsår",
          download: "Ladda ner SIE-fil",
          empty: "Du har inte bokfört något ännu, så det finns inget att ta ut. När du har bokfört din första verifikation kan du ladda ner året här.",
          format: "Filen är av typen SIE 4 och sparas med ändelsen .se."
        }
      : {
          title: "Take your books out",
          intro:
            "Download a fiscal year as a SIE file. The file holds the chart of accounts, opening and closing balances and every verification, including cancelled ones and their corrections. Your accountant can open it in any Swedish bookkeeping program.",
          year: "Fiscal year",
          download: "Download SIE file",
          empty: "You have not booked anything yet, so there is nothing to take out. Once you have booked your first verification you can download the year here.",
          format: "The file is SIE type 4 and is saved with the extension .se."
        };

  return (
    <div className="stack">
      <h2>{copy.title}</h2>
      <p className="note">{copy.intro}</p>
      {years.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <form className="stack" method="get" action="/api/exports/sie">
          <div className="row">
            <label className="stack">
              <span className="note">{copy.year}</span>
              <select name="year" defaultValue={String(years[0])}>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <button type="submit">{copy.download}</button>
          </div>
          <p className="note">{copy.format}</p>
        </form>
      )}
    </div>
  );
};
