"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type Preview = {
  canImport: boolean;
  encoding: "cp437" | "latin1" | "utf8";
  companyName: string | null;
  orgNumber: string | null;
  program: string | null;
  fiscalYears: Array<{ index: number; start: string; end: string }>;
  accountsInFile: number;
  vouchersInFile: number;
  vouchersToImport: number;
  rowsToImport: number;
  allBalanced: boolean;
  totalDebit: string;
  firstDate: string | null;
  lastDate: string | null;
  openingBalancesToImport: number;
  accountsToCreate: Array<{ code: string; name: string; type: string }>;
  closingCheck: { checked: number; mismatches: number } | null;
  errors: string[];
  warnings: string[];
  skipped: string[];
};

type Result = {
  vouchersImported: number;
  accountsCreated: number;
  openingBalancesImported: number;
  firstVerificationNumber: number | null;
  lastVerificationNumber: number | null;
};

type ApiResponse = { preview?: Preview; result?: Result; error?: string };

type Stage = "idle" | "reading" | "preview" | "importing" | "done";

export const SieImportCard = ({ locale }: { locale: Locale }) => {
  const sv = locale === "sv";
  const copy = sv
    ? {
        title: "Flytta hit din bokföring",
        intro:
          "Har du bokfört i ett annat program? Ta ut en SIE-fil därifrån och släpp den här, så följer kontoplan, ingående balanser och alla verifikationer (de enskilda bokföringsposterna) med. Du får se exakt vad som händer innan något sparas.",
        whereTitle: "Så hittar du SIE-filen",
        whereFortnox: "Klicka på företagsnamnet högst upp, välj Export, välj SIE typ 4 (Transaktioner) och klicka på Exportera.",
        whereBokio: "Gå till Inställningar, öppna Exportera data, välj räkenskapsår, klicka på de tre prickarna och välj SIE 4.",
        whereSpiris:
          "Gå till Inställningar, välj Import och export, sedan SIE - import och export av bokföringsdata. Skapa en ny export och välj räkenskapsår.",
        whereOther: "Leta efter SIE-export under inställningar eller bokföring och välj typ 4.",
        other: "Annat program",
        oneYear:
          "Ta ut en fil per räkenskapsår och börja med det äldsta. Välj alltid SIE 4: det är den typ som innehåller verifikationerna.",
        drop: "Släpp SIE-filen här",
        or: "eller",
        choose: "Välj fil",
        reading: "Läser filen...",
        previewTitle: "Det här kommer att hända",
        nothingSaved: "Inget har sparats ännu.",
        company: "Företag",
        unknown: "Anges inte i filen",
        fiscalYear: "Räkenskapsår",
        previousYear: "jämförelseår",
        from: "Från program",
        vouchers: "Verifikationer att bokföra",
        ofInFile: "av",
        inFile: "i filen",
        rows: "Konteringsrader",
        period: "Datum",
        turnover: "Summa debet",
        balance: "Balanskontroll",
        balanced: "Varje verifikation balanserar",
        notBalanced: "Minst en verifikation balanserar inte",
        closing: "Avstämning mot filen",
        closingOk: (n: number) => `Utgående saldon stämmer för alla ${n} konton`,
        closingOff: (n: number, m: number) => `${m} av ${n} konton skiljer sig`,
        opening: "Ingående balanser",
        openingHint: "Vad som fanns på varje konto när året började.",
        accounts: "Konton i filen",
        newAccounts: "Konton som skapas",
        newAccountsNone: "Alla konton som filen använder finns redan i Akunta.",
        code: "Konto",
        name: "Namn",
        type: "Typ",
        warnings: "Bra att veta innan du bekräftar",
        skipped: "Det här tas inte med",
        vatNote:
          "Importerad historik syns i resultaträkning, balansräkning och huvudbok. Den räknas inte in i Akuntas momsrapport, eftersom en SIE-fil inte säger vilken del av en verifikation som är moms. Redovisa moms för perioder före bytet från ditt gamla program.",
        cannot: "Filen kan inte importeras ännu",
        cannotHint: "Inget har sparats. Rätta det som står nedan och försök igen.",
        confirm: (n: number) => (n === 1 ? "Importera 1 verifikation" : `Importera ${n} verifikationer`),
        confirmOpening: "Importera ingående balanser",
        importing: "Importerar...",
        another: "Välj en annan fil",
        doneTitle: "Klart. Din bokföring är på plats.",
        doneVouchers: (n: number, a: number | null, b: number | null) =>
          n === 0
            ? "Inga verifikationer bokfördes."
            : `${n} verifikationer bokfördes som nummer ${a} till ${b} i Akunta. Ursprungligt nummer finns kvar som referens på varje verifikation.`,
        doneAccounts: (n: number) => `${n} konton skapades.`,
        doneOpening: (n: number) => `${n} ingående balanser sparades.`,
        seeTransactions: "Se verifikationerna",
        seeReports: "Kontrollera balansräkningen",
        importMore: "Importera ett år till",
        failed: "Filen kunde inte läsas. Kontrollera din anslutning och försök igen.",
        types: { ASSET: "Tillgång", LIABILITY: "Skuld", EQUITY: "Eget kapital", INCOME: "Intäkt", EXPENSE: "Kostnad" } as Record<string, string>
      }
    : {
        title: "Move your books here",
        intro:
          "Have you kept your books in another program? Export a SIE file from it and drop it here. Your chart of accounts, opening balances and every verification (the individual bookkeeping entries) come along. You see exactly what will happen before anything is saved.",
        whereTitle: "Where to find the SIE file",
        whereFortnox: "Click the company name at the top, choose Export, choose SIE typ 4 (Transaktioner) and click Exportera.",
        whereBokio: "Go to Inställningar, open Exportera data, pick the fiscal year, click the three dots and choose SIE 4.",
        whereSpiris:
          "Go to Inställningar, choose Import och export, then SIE - import och export av bokföringsdata. Start a new export and pick the fiscal year.",
        whereOther: "Look for SIE export under settings or bookkeeping and choose type 4.",
        other: "Another program",
        oneYear:
          "Export one file per fiscal year and start with the oldest. Always choose SIE 4: it is the type that contains the verifications.",
        drop: "Drop the SIE file here",
        or: "or",
        choose: "Choose file",
        reading: "Reading the file...",
        previewTitle: "This is what will happen",
        nothingSaved: "Nothing has been saved yet.",
        company: "Company",
        unknown: "Not stated in the file",
        fiscalYear: "Fiscal year",
        previousYear: "comparison year",
        from: "From program",
        vouchers: "Verifications to book",
        ofInFile: "of",
        inFile: "in the file",
        rows: "Entry rows",
        period: "Dates",
        turnover: "Total debit",
        balance: "Balance check",
        balanced: "Every verification balances",
        notBalanced: "At least one verification does not balance",
        closing: "Checked against the file",
        closingOk: (n: number) => `Closing balances agree for all ${n} accounts`,
        closingOff: (n: number, m: number) => `${m} of ${n} accounts differ`,
        opening: "Opening balances",
        openingHint: "What each account held when the year began.",
        accounts: "Accounts in the file",
        newAccounts: "Accounts that will be created",
        newAccountsNone: "Every account the file uses already exists in Akunta.",
        code: "Account",
        name: "Name",
        type: "Type",
        warnings: "Good to know before you confirm",
        skipped: "This is left out",
        vatNote:
          "Imported history shows in the profit and loss statement, the balance sheet and the ledger. It is not counted in Akunta's VAT report, because a SIE file does not say which part of a verification is VAT. Report VAT for periods before the switch from your old program.",
        cannot: "The file cannot be imported yet",
        cannotHint: "Nothing has been saved. Fix what is listed below and try again.",
        confirm: (n: number) => (n === 1 ? "Import 1 verification" : `Import ${n} verifications`),
        confirmOpening: "Import opening balances",
        importing: "Importing...",
        another: "Choose another file",
        doneTitle: "Done. Your books are in place.",
        doneVouchers: (n: number, a: number | null, b: number | null) =>
          n === 0
            ? "No verifications were booked."
            : `${n} verifications were booked as numbers ${a} to ${b} in Akunta. The original number is kept as the reference on each one.`,
        doneAccounts: (n: number) => `${n} accounts were created.`,
        doneOpening: (n: number) => `${n} opening balances were saved.`,
        seeTransactions: "See the verifications",
        seeReports: "Check the balance sheet",
        importMore: "Import another year",
        failed: "The file could not be read. Check your connection and try again.",
        types: { ASSET: "Asset", LIABILITY: "Liability", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expense" } as Record<string, string>
      };

  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = async (target: File, mode: "preview" | "confirm"): Promise<ApiResponse> => {
    const body = new FormData();
    body.append("file", target);
    body.append("mode", mode);
    const response = await fetch("/api/imports/sie", { method: "POST", body });
    const json = (await response.json().catch(() => ({}))) as ApiResponse;
    if (!response.ok && !json.preview && !json.error) json.error = copy.failed;
    return json;
  };

  const reset = () => {
    setStage("idle");
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const read = async (target: File) => {
    setFile(target);
    setPreview(null);
    setResult(null);
    setError(null);
    setStage("reading");
    try {
      const json = await send(target, "preview");
      if (json.preview) {
        setPreview(json.preview);
        setStage("preview");
      } else {
        setError(json.error ?? copy.failed);
        setStage("idle");
      }
    } catch {
      setError(copy.failed);
      setStage("idle");
    }
  };

  const confirm = async () => {
    if (!file) return;
    setError(null);
    setStage("importing");
    try {
      const json = await send(file, "confirm");
      if (json.result) {
        setResult(json.result);
        setStage("done");
        return;
      }
      // The server checked again and found something new: show its fresh answer.
      if (json.preview) setPreview(json.preview);
      else setError(json.error ?? copy.failed);
      setStage("preview");
    } catch {
      setError(copy.failed);
      setStage("preview");
    }
  };

  const numberLocale = sv ? "sv-SE" : "en-GB";
  const money = (value: string) =>
    Number(value).toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const mainYear = preview?.fiscalYears.find((year) => year.index === 0) ?? null;
  const busy = stage === "reading" || stage === "importing";

  return (
    <div className="stack">
      <h2>{copy.title}</h2>
      <p className="note">{copy.intro}</p>

      {stage === "done" && result ? (
        <div className="stack" role="status">
          <p>
            <span className="badge good">{copy.doneTitle}</span>
          </p>
          <p>{copy.doneVouchers(result.vouchersImported, result.firstVerificationNumber, result.lastVerificationNumber)}</p>
          {result.accountsCreated > 0 && <p className="note">{copy.doneAccounts(result.accountsCreated)}</p>}
          {result.openingBalancesImported > 0 && <p className="note">{copy.doneOpening(result.openingBalancesImported)}</p>}
          <p className="note">{copy.vatNote}</p>
          <div className="row">
            <Link className="button" href="/transactions">
              {copy.seeTransactions}
            </Link>
            <Link className="button secondary" href="/reports">
              {copy.seeReports}
            </Link>
            <button type="button" className="secondary" onClick={reset}>
              {copy.importMore}
            </button>
          </div>
        </div>
      ) : (
        <>
          {!preview && (
            <>
              <div className="stack">
                <h3>{copy.whereTitle}</h3>
                <p className="note">
                  <strong>Fortnox.</strong> {copy.whereFortnox}
                </p>
                <p className="note">
                  <strong>Bokio.</strong> {copy.whereBokio}
                </p>
                <p className="note">
                  <strong>Spiris.</strong> {copy.whereSpiris}
                </p>
                <p className="note">
                  <strong>{copy.other}.</strong> {copy.whereOther}
                </p>
                <p className="note">{copy.oneYear}</p>
              </div>

              <div
                className="row"
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const dropped = event.dataTransfer.files?.[0];
                  if (dropped && !busy) void read(dropped);
                }}
                style={{
                  padding: "28px 20px",
                  borderRadius: 12,
                  justifyContent: "center",
                  background: dragging ? "var(--secondary-container)" : "var(--surface-container-low)",
                  transition: "background-color 340ms ease-in-out"
                }}
              >
                <span>{stage === "reading" ? copy.reading : copy.drop}</span>
                {stage !== "reading" && <span className="note">{copy.or}</span>}
                <input
                  ref={inputRef}
                  id="sie-file"
                  type="file"
                  accept=".se,.si,.sie,.SE,.SI,.SIE,text/plain"
                  aria-label={copy.choose}
                  disabled={busy}
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) void read(chosen);
                  }}
                />
              </div>
            </>
          )}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {preview && (
            <div className="stack" aria-live="polite">
              <h3>{preview.canImport ? copy.previewTitle : copy.cannot}</h3>
              <p className="note">
                {file?.name ? `${file.name}. ` : ""}
                {preview.canImport ? copy.nothingSaved : copy.cannotHint}
              </p>

              {preview.errors.length > 0 && (
                <div className="stack" role="alert">
                  {preview.errors.map((message) => (
                    <p className="error" key={message}>
                      {message}
                    </p>
                  ))}
                </div>
              )}

              <div className="tableWrap">
                <table>
                  <tbody>
                    <tr>
                      <th scope="row">{copy.company}</th>
                      <td>
                        {preview.companyName ?? copy.unknown}
                        {preview.orgNumber ? ` (${preview.orgNumber})` : ""}
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">{copy.fiscalYear}</th>
                      <td>
                        {mainYear ? `${mainYear.start} – ${mainYear.end}` : copy.unknown}
                        {preview.fiscalYears
                          .filter((year) => year.index !== 0)
                          .map((year) => ` · ${copy.previousYear} ${year.start.slice(0, 4)}`)
                          .join("")}
                      </td>
                    </tr>
                    {preview.program && (
                      <tr>
                        <th scope="row">{copy.from}</th>
                        <td>{preview.program}</td>
                      </tr>
                    )}
                    <tr>
                      <th scope="row">{copy.vouchers}</th>
                      <td>
                        {preview.vouchersToImport}
                        {preview.vouchersToImport !== preview.vouchersInFile
                          ? ` ${copy.ofInFile} ${preview.vouchersInFile} ${copy.inFile}`
                          : ""}
                      </td>
                    </tr>
                    {preview.vouchersToImport > 0 && (
                      <>
                        <tr>
                          <th scope="row">{copy.rows}</th>
                          <td>{preview.rowsToImport}</td>
                        </tr>
                        <tr>
                          <th scope="row">{copy.period}</th>
                          <td>
                            {preview.firstDate} – {preview.lastDate}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">{copy.turnover}</th>
                          <td>{money(preview.totalDebit)}</td>
                        </tr>
                      </>
                    )}
                    <tr>
                      <th scope="row">{copy.balance}</th>
                      <td>
                        <span className={preview.allBalanced ? "badge good" : "badge warn"}>
                          {preview.allBalanced ? copy.balanced : copy.notBalanced}
                        </span>
                      </td>
                    </tr>
                    {preview.closingCheck && (
                      <tr>
                        <th scope="row">{copy.closing}</th>
                        <td>
                          <span className={preview.closingCheck.mismatches === 0 ? "badge good" : "badge warn"}>
                            {preview.closingCheck.mismatches === 0
                              ? copy.closingOk(preview.closingCheck.checked)
                              : copy.closingOff(preview.closingCheck.checked, preview.closingCheck.mismatches)}
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr>
                      <th scope="row">{copy.opening}</th>
                      <td>
                        {preview.openingBalancesToImport}
                        <span className="note"> · {copy.openingHint}</span>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">{copy.accounts}</th>
                      <td>{preview.accountsInFile}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3>
                {copy.newAccounts} ({preview.accountsToCreate.length})
              </h3>
              {preview.accountsToCreate.length === 0 ? (
                <p className="note">{copy.newAccountsNone}</p>
              ) : (
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{copy.code}</th>
                        <th>{copy.name}</th>
                        <th>{copy.type}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.accountsToCreate.map((account) => (
                        <tr key={account.code}>
                          <td data-label={copy.code}>{account.code}</td>
                          <td data-label={copy.name}>{account.name}</td>
                          <td data-label={copy.type}>{copy.types[account.type] ?? account.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <div className="stack">
                  <h3>{copy.warnings}</h3>
                  {preview.warnings.map((message) => (
                    <p key={message}>
                      <span className="badge warn">!</span> {message}
                    </p>
                  ))}
                </div>
              )}

              {preview.skipped.length > 0 && (
                <div className="stack">
                  <h3>{copy.skipped}</h3>
                  {preview.skipped.map((message) => (
                    <p className="note" key={message}>
                      {message}
                    </p>
                  ))}
                </div>
              )}

              {preview.canImport && <p className="note">{copy.vatNote}</p>}

              <div className="row">
                {preview.canImport && (
                  <button type="button" onClick={confirm} disabled={busy}>
                    {stage === "importing"
                      ? copy.importing
                      : preview.vouchersToImport > 0
                        ? copy.confirm(preview.vouchersToImport)
                        : copy.confirmOpening}
                  </button>
                )}
                <button type="button" className="secondary" onClick={reset} disabled={busy}>
                  {copy.another}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
