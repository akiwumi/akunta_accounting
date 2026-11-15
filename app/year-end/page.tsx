export const dynamic = "force-dynamic";

import Link from "next/link";
import type { ReactNode } from "react";

import {
  BankBalanceForm,
  CloseYearButton,
  ConfirmStepButton,
  OwnFiguresForm,
  SruDetailsForm,
  type OwnFigureField
} from "@/components/year-end/YearEndForms";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { parseTaxYear } from "@/lib/data/period";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { NE_MANUAL_BOX_IDS, neAmount, neBox, type NeBox, type NeSection } from "@/lib/tax/neBilaga";
import { neBoxNumber, neBoxText, nePartText, neWarningText } from "@/lib/tax/neTexts";
import { buildYearEndOverview, listYearEndYears, type StepStatus } from "@/lib/tax/neYearEnd";

const SKV_IMPORT_URL =
  "https://www.skatteverket.se/foretag/inkomstdeklaration/deklareraenskildnaringsverksamhet/importeranebilaganfranettdeklarationsprogram.4.361dc8c15312eff6fd10d2f.html";
const SKV_NE_GUIDE_URL = "https://www.skatteverket.se/fyllainebilagan";

const COMMON_OWN_FIGURES = ["R13", "R14", "R16", "R22", "R24", "R38", "R40", "R41", "R44"];

const Step = ({
  number,
  id,
  title,
  tag,
  children
}: {
  number: number;
  id: string;
  title: string;
  tag: ReactNode;
  children: ReactNode;
}) => (
  <article className="card stack" id={id}>
    <div className="row" style={{ justifyContent: "space-between" }}>
      <h2 style={{ margin: 0 }}>
        {number}. {title}
      </h2>
      {tag}
    </div>
    {children}
  </article>
);

type PageProps = { searchParams: Promise<{ year?: string | string[] }> };

export default async function YearEndPage({ searchParams }: PageProps) {
  const locale = await getRequestLocale();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const business = await ensureBusiness();
  const now = new Date();

  // ── Which year ────────────────────────────────────────────────────────────
  const params = await searchParams;
  const requested = parseTaxYear(Array.isArray(params.year) ? params.year[0] : params.year);
  const years = await listYearEndYears(business.id, now);
  let year = requested !== null && requested >= 2000 && requested <= 2100 ? requested : now.getUTCFullYear();
  if (requested === null) {
    // Default to last year while it is still open: that is the year-end most people come here for.
    const previous = now.getUTCFullYear() - 1;
    if (years.includes(previous)) {
      const lock = await prisma.periodLock.findFirst({
        where: {
          businessId: business.id,
          periodStart: { lte: new Date(Date.UTC(previous, 0, 1)) },
          periodEnd: { gte: new Date(Date.UTC(previous, 11, 31, 23, 59, 59, 999)) }
        },
        select: { id: true }
      });
      if (!lock) year = previous;
    }
  }
  if (!years.includes(year)) years.unshift(year);
  years.sort((a, b) => b - a);

  const overview = await buildYearEndOverview(business.id, year, now);
  const { ne } = overview;
  const cashMethod = overview.bookkeepingMethod !== "fakturametoden";

  const money = (value: number) => formatMoney(value, "SEK", numberLocale);
  const kr = (value: number) =>
    new Intl.NumberFormat(numberLocale, { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(value);

  const copy = sv
    ? {
        title: `Bokslut ${year}`,
        subtitle:
          "Gå igenom stegen uppifrån och ned. När du är klar har du en färdig NE-bilaga (bilagan för enskild firma i deklarationen) att läsa in hos Skatteverket, och året är stängt.",
        yearLabel: "Räkenskapsår",
        show: "Visa",
        closedBadge: "Stängt",
        openBadge: "Öppet",
        progress: (done: number, open: number) => `${done} steg klara, ${open} kvar att titta på.`,
        allDone: "Alla steg är klara.",
        notEnded: `Året ${year} är inte slut ännu. Du kan förbereda bokslutet, men siffrorna ändras tills året är över och året kan stängas först från den 1 januari ${year + 1}.`,
        closedNote: (date: string) => `Året stängdes ${date}. Bokföringen är låst och saldona är överförda till ${year + 1}. Du kan fortfarande ladda ner filerna och ändra dina egna belopp nedan.`,
        status: { done: "Klart", attention: "Behöver åtgärd", na: "Inte aktuellt" } as Record<StepStatus, string>,
        estimate: "Uppskattning",
        preview: "Förhandsvisning",
        nextUp: "Nästa steg",
        box: "Ruta",
        what: "Vad",
        amount: "Belopp",
        fillIn: "Fyll i själv",
        accountsBehind: "Konton bakom rutan",
        partsBehind: "Så är beloppet uträknat",
        account: "Konto",
        sections: {
          balance: "Balansräkning (B1 till B16)",
          income: "Resultaträkning (R1 till R11)",
          adjustments: "Skattemässiga justeringar (R12 till R48)",
          other: "Övriga uppgifter"
        } as Record<NeSection, string>,
        kind: { ledger: "Från bokföringen", computed: "Uträknat av Akunta", sum: "Summa", manual: "Eget belopp" } as Record<string, string>
      }
    : {
        title: `Year-end ${year}`,
        subtitle:
          "Work down the steps from the top. When you are done you have a finished NE-bilaga (the sole trader form in the tax return) to import at Skatteverket, and the year is closed.",
        yearLabel: "Fiscal year",
        show: "Show",
        closedBadge: "Closed",
        openBadge: "Open",
        progress: (done: number, open: number) => `${done} steps done, ${open} left to look at.`,
        allDone: "All steps are done.",
        notEnded: `${year} is not over yet. You can prepare the year-end, but the figures change until the year is over and the year can only be closed from 1 January ${year + 1}.`,
        closedNote: (date: string) => `The year was closed on ${date}. The books are locked and the balances have been carried forward to ${year + 1}. You can still download the files and change your own figures below.`,
        status: { done: "Done", attention: "Needs attention", na: "Not applicable" } as Record<StepStatus, string>,
        estimate: "Estimate",
        preview: "Preview",
        nextUp: "Next step",
        box: "Box",
        what: "What",
        amount: "Amount",
        fillIn: "Fill in yourself",
        accountsBehind: "Accounts behind the box",
        partsBehind: "How the amount is worked out",
        account: "Account",
        sections: {
          balance: "Balance sheet (B1 to B16)",
          income: "Income statement (R1 to R11)",
          adjustments: "Tax adjustments (R12 to R48)",
          other: "Other information"
        } as Record<NeSection, string>,
        kind: { ledger: "From the books", computed: "Worked out by Akunta", sum: "Total", manual: "Your own figure" } as Record<string, string>
      };

  const badge = (status: StepStatus) => (
    <span className={`badge${status === "done" ? " good" : status === "attention" ? " warn" : ""}`}>{copy.status[status]}</span>
  );

  // ── First open step, for the "next step" line ─────────────────────────────
  const openSteps: Array<{ id: string; label: string; open: boolean }> = [
    { id: "receipts", label: sv ? "Kvitton som väntar" : "Receipts waiting", open: overview.receipts.status === "attention" },
    { id: "customer-invoices", label: sv ? "Obetalda kundfakturor" : "Unpaid customer invoices", open: overview.customerInvoices.status === "attention" },
    { id: "supplier-bills", label: sv ? "Obetalda leverantörsfakturor" : "Unpaid supplier bills", open: overview.supplierBills.status === "attention" },
    { id: "balance", label: sv ? "Balansräkningen" : "The balance sheet", open: overview.balance.status === "attention" },
    { id: "bank", label: sv ? "Banksaldot" : "The bank balance", open: overview.bank.status === "attention" },
    { id: "assets", label: sv ? "Inventarier" : "Fixed assets", open: overview.assets.status === "attention" },
    { id: "reserves", label: sv ? "Periodiseringsfond" : "Tax reserves", open: overview.reserves.status === "attention" },
    { id: "close", label: sv ? "Stäng året" : "Close the year", open: !overview.closed }
  ];
  const next = openSteps.find((step) => step.open);

  // ── Own figures form ──────────────────────────────────────────────────────
  const ownFigure = (id: string): OwnFigureField => {
    const box = neBox(ne, id);
    const text = neBoxText(id, locale);
    return {
      id,
      number: neBoxNumber(id),
      label: id === "R16" ? (sv ? "Andra kostnader som inte bokförts men som ska dras av" : "Other costs not booked that are deductible") : text.label,
      help:
        id === "R16"
          ? sv
            ? "Utöver avskrivningar och milersättning, som Akunta redan har lagt in."
            : "On top of depreciation and mileage, which Akunta has already included."
          : text.help,
      sign: box.sign === "-" ? "-" : "+",
      value: overview.inputs.manual[id as keyof typeof overview.inputs.manual] ?? null
    };
  };
  const commonFigures = COMMON_OWN_FIGURES.map(ownFigure);
  const rareFigures = NE_MANUAL_BOX_IDS.filter((id) => !COMMON_OWN_FIGURES.includes(id)).map(ownFigure);

  // ── NE preview rows ───────────────────────────────────────────────────────
  const boxRow = (box: NeBox) => {
    const text = neBoxText(box.id, locale);
    const kind = box.kind === "manual" && box.amount === null ? null : box.entered && box.kind === "manual" ? "manual" : box.kind;
    return (
      <tr key={box.id}>
        <td style={{ whiteSpace: "nowrap" }}>
          <strong>{neBoxNumber(box.id)}</strong>
        </td>
        <td>
          <div className="stack" style={{ gap: 4 }}>
            <span>{text.label}</span>
            <span className="note">{text.help}</span>
            {box.accounts.length > 0 && (
              <details>
                <summary className="note">{copy.accountsBehind}</summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {box.accounts.map((line) => (
                    <li key={`${line.code}-${line.name}`} className="note">
                      {line.code ? `${line.code} ${line.name}` : nePartText(line.name, locale)}: {money(line.amount)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {box.parts.length > 0 && (
              <details>
                <summary className="note">{copy.partsBehind}</summary>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  {box.parts.map((part) => (
                    <li key={part.key} className="note">
                      {nePartText(part.key, locale)}: {kr(part.amount)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </td>
        <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
          {box.amount === null ? (
            <a href="#own-figures" className="badge warn">
              {copy.fillIn}
            </a>
          ) : (
            <>
              {box.sign === "-" && box.amount !== 0 ? "− " : ""}
              {kr(box.amount)}
            </>
          )}
        </td>
        <td className="note" style={{ whiteSpace: "nowrap" }}>
          {kind ? copy.kind[kind] : ""}
        </td>
      </tr>
    );
  };

  const sectionTable = (section: NeSection) => (
    <div className="stack" key={section}>
      <h3 style={{ margin: 0 }}>{copy.sections[section]}</h3>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>{copy.box}</th>
              <th>{copy.what}</th>
              <th style={{ textAlign: "right" }}>{copy.amount}</th>
              <th />
            </tr>
          </thead>
          <tbody>{ne.boxes.filter((box) => box.section === section).map(boxRow)}</tbody>
        </table>
      </div>
    </div>
  );

  const resultIsSurplus = ne.result >= 0;
  const missingText: Record<string, string> = sv
    ? {
        name: "ditt namn",
        personnummer: "ett giltigt personnummer",
        postalCode: "postnummer (fem siffror)",
        city: "postort"
      }
    : {
        name: "your name",
        personnummer: "a valid personnummer",
        postalCode: "postcode (five digits)",
        city: "town"
      };
  const missingDetails = overview.sru.missing.filter((item) => item !== "unsupportedYear").map((item) => missingText[item]);

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>

      <article className="card stack" id="year-end-summary">
        <form method="get" action="/year-end" className="row">
          <label className="stack" style={{ flex: "0 1 200px" }}>
            <span className="label">{copy.yearLabel}</span>
            <select name="year" defaultValue={String(year)}>
              {years.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary">
            {copy.show}
          </button>
          <span className={`badge${overview.closed ? " good" : ""}`}>{overview.closed ? copy.closedBadge : copy.openBadge}</span>
        </form>
        {overview.closed && overview.closedAt && <p className="note">{copy.closedNote(overview.closedAt.slice(0, 10))}</p>}
        {!overview.yearEnded && <p className="note">{copy.notEnded}</p>}
        <p>{overview.stepsOpen === 0 ? copy.allDone : copy.progress(overview.stepsDone, overview.stepsOpen)}</p>
        {next && (
          <p>
            {copy.nextUp}: <a href={`#${next.id}`}>{next.label}</a>
          </p>
        )}
      </article>

      {/* ── 1. Receipts ─────────────────────────────────────────────────── */}
      <Step number={1} id="receipts" title={sv ? "Kvitton som väntar på granskning" : "Receipts waiting for review"} tag={badge(overview.receipts.status)}>
        <p className="note">
          {sv
            ? "Ett kvitto som väntar på granskning är inte bokfört och finns därför inte med i bokslutet. Granska eller ta bort dem innan du går vidare."
            : "A receipt waiting for review is not booked, so it is missing from the year-end. Review or remove them before you go on."}
        </p>
        {overview.receipts.waiting > 0 ? (
          <p>
            {sv
              ? `${overview.receipts.waiting} kvitton från ${year} väntar.`
              : `${overview.receipts.waiting} receipts from ${year} are waiting.`}{" "}
            <Link href="/review#needs-review">{sv ? "Granska dem nu" : "Review them now"}</Link>
          </p>
        ) : (
          <p>{sv ? `Inga kvitton från ${year} väntar.` : `No receipts from ${year} are waiting.`}</p>
        )}
      </Step>

      {/* ── 2. Customer invoices ────────────────────────────────────────── */}
      <Step
        number={2}
        id="customer-invoices"
        title={sv ? "Obetalda kundfakturor vid årets slut" : "Customer invoices unpaid at year end"}
        tag={badge(overview.customerInvoices.status)}
      >
        <p className="note">
          {cashMethod
            ? sv
              ? "Med kontantmetoden bokför du när pengarna kommer in. Vid årets slut finns ett undantag: fakturor som du har skickat men inte fått betalt för den 31 december ska ändå räknas som intäkt det gamla året."
              : "With kontantmetoden (the cash method) you book when the money arrives. At year end there is one exception: invoices you have sent but not been paid for on 31 December still count as income in the old year."
            : sv
              ? "Med fakturametoden bokförs fakturan när den skickas, så obetalda fakturor finns redan med som kundfordringar."
              : "With fakturametoden (the invoice method) an invoice is booked when it is sent, so unpaid invoices are already included as receivables."}
        </p>
        {overview.customerInvoices.unpaidCount === 0 ? (
          <p>{sv ? "Inga kundfakturor var obetalda vid årets slut." : "No customer invoices were unpaid at year end."}</p>
        ) : (
          <>
            <p>
              {sv
                ? `${overview.customerInvoices.unpaidCount} fakturor på sammanlagt ${money(overview.customerInvoices.unpaidTotal)} var obetalda den 31 december. I bokföringen finns ${kr(overview.customerInvoices.bookedReceivables)} som kundfordringar (ruta B7).`
                : `${overview.customerInvoices.unpaidCount} invoices totalling ${money(overview.customerInvoices.unpaidTotal)} were unpaid on 31 December. The books show ${kr(overview.customerInvoices.bookedReceivables)} as receivables (box B7).`}{" "}
              <Link href="/invoices#invoice-list">{sv ? "Visa fakturorna" : "Show the invoices"}</Link>
            </p>
            {cashMethod && overview.customerInvoices.status === "attention" && (
              <p className="note">
                {sv
                  ? "Så gör du: bokför fakturorna som kundfordran per den 31 december. Akunta gör det åt dig under Bokför manuellt, där de obetalda fakturorna redan är ifyllda och återföringen den 1 januari skapas samtidigt. Markera sedan steget som hanterat."
                  : "What to do: book the invoices as receivables on 31 December. Akunta does it for you under Journal entry, where the unpaid invoices are already filled in and the reversal on 1 January is created at the same time. Then mark the step as handled."}{" "}
                <Link href="/journal">{sv ? "Öppna Bokför manuellt" : "Open Journal entry"}</Link>
              </p>
            )}
            {cashMethod && (
              <ConfirmStepButton
                locale={locale}
                year={year}
                field="customerInvoices"
                confirmed={overview.inputs.confirmed.customerInvoices}
                label={sv ? "Jag har hanterat de obetalda fakturorna" : "I have handled the unpaid invoices"}
                undoLabel={sv ? "Ångra: inte hanterat" : "Undo: not handled"}
              />
            )}
          </>
        )}
      </Step>

      {/* ── 3. Supplier bills ───────────────────────────────────────────── */}
      <Step
        number={3}
        id="supplier-bills"
        title={sv ? "Obetalda leverantörsfakturor vid årets slut" : "Supplier bills unpaid at year end"}
        tag={badge(overview.supplierBills.status)}
      >
        <p className="note">
          {sv
            ? "Samma undantag gäller åt andra hållet: fakturor från leverantörer som du hade fått men inte betalat den 31 december är en kostnad det gamla året. Akunta håller inte reda på dina leverantörsfakturor, så det här behöver du själv titta efter."
            : "The same exception applies the other way: bills from suppliers that you had received but not paid on 31 December are a cost in the old year. Akunta does not keep track of your supplier bills, so this is one to check yourself."}
        </p>
        <p>
          {overview.supplierBills.bookedPayables !== 0
            ? sv
              ? `I bokföringen finns ${kr(overview.supplierBills.bookedPayables)} som leverantörsskulder (ruta B15).`
              : `The books show ${kr(overview.supplierBills.bookedPayables)} as trade payables (box B15).`
            : sv
              ? "Inga leverantörsskulder är bokförda."
              : "No trade payables are booked."}
        </p>
        <p className="note">
          {sv
            ? "Har du obetalda leverantörsfakturor: bokför dem som skuld per den 31 december under Bokför manuellt, där återföringen den 1 januari skapas samtidigt. Har du inga, bekräfta bara."
            : "If you have unpaid supplier bills: book them as a liability on 31 December under Journal entry, where the reversal on 1 January is created at the same time. If you have none, just confirm."}{" "}
          <Link href="/journal">{sv ? "Öppna Bokför manuellt" : "Open Journal entry"}</Link>
        </p>
        <ConfirmStepButton
          locale={locale}
          year={year}
          field="supplierBills"
          confirmed={overview.inputs.confirmed.supplierBills}
          label={sv ? "Inga obetalda, eller så har jag hanterat dem" : "None unpaid, or I have handled them"}
          undoLabel={sv ? "Ångra bekräftelsen" : "Undo the confirmation"}
        />
      </Step>

      {/* ── 4. Balance sheet ────────────────────────────────────────────── */}
      <Step number={4} id="balance" title={sv ? "Balansräkningen stämmer" : "The balance sheet balances"} tag={badge(overview.balance.status)}>
        <p className="note">
          {sv
            ? "Tillgångar ska vara lika med skulder plus eget kapital. Stämmer det inte finns ett fel i de ingående balanserna."
            : "Assets must equal liabilities plus equity. If they do not, there is a mistake in the opening balances."}
        </p>
        <p>
          {sv ? "Tillgångar" : "Assets"} {money(overview.balance.totalAssets)}. {sv ? "Skulder och eget kapital" : "Liabilities and equity"}{" "}
          {money(overview.balance.liabilitiesAndEquity)}.
          {overview.balance.difference !== 0 && (
            <>
              {" "}
              <strong>
                {sv ? "Skillnad" : "Difference"} {money(overview.balance.difference)}.
              </strong>
            </>
          )}
        </p>
        {overview.balance.difference !== 0 && (
          <p className="note">
            {sv
              ? "Öppna balansrapporten och jämför de ingående balanserna med förra årets bokslut. Kontakta supporten om du inte hittar felet."
              : "Open the balance report and compare the opening balances with last year's closing figures. Contact support if you cannot find the mistake."}
          </p>
        )}
        <p>
          <Link href={`/reports?year=${year}#report-runner`}>{sv ? "Öppna balansrapporten" : "Open the balance report"}</Link>
        </p>
      </Step>

      {/* ── 5. Bank ─────────────────────────────────────────────────────── */}
      <Step number={5} id="bank" title={sv ? "Banksaldot stämmer med kontoutdraget" : "The bank balance matches the statement"} tag={badge(overview.bank.status)}>
        <p className="note">
          {sv
            ? "Det säkraste sättet att veta att allt är bokfört: saldot i bokföringen den 31 december ska vara exakt samma som på bankens kontoutdrag. Skriv in saldot från kontoutdraget så jämför vi."
            : "The surest way to know that everything is booked: the balance in your books on 31 December must be exactly the same as on the bank statement. Enter the statement balance and we compare."}
        </p>
        <p>
          {sv ? "Saldo i bokföringen (kassa och bank)" : "Balance in the books (cash and bank)"}: <strong>{money(overview.bank.ledgerBalance)}</strong>
        </p>
        <BankBalanceForm locale={locale} year={year} initial={overview.bank.statementBalance} />
        {overview.bank.difference !== null && Math.abs(overview.bank.difference) >= 0.005 && (
          <p className="note">
            {sv
              ? `Det skiljer ${money(Math.abs(overview.bank.difference))}. ${overview.bank.difference > 0 ? "Banken har mer än bokföringen: en inbetalning saknas eller en utgift är bokförd två gånger." : "Bokföringen har mer än banken: en utgift saknas eller en inbetalning är bokförd två gånger."} `
              : `They differ by ${money(Math.abs(overview.bank.difference))}. ${overview.bank.difference > 0 ? "The bank has more than the books: a payment received is missing or a cost is booked twice." : "The books have more than the bank: a cost is missing or a payment received is booked twice."} `}
            <Link href="/imports#import-upload">{sv ? "Importera kontoutdraget" : "Import the bank statement"}</Link>
            {sv ? " eller " : " or "}
            <Link href="/transactions#transaction-list">{sv ? "gå igenom transaktionerna" : "go through the transactions"}</Link>.
          </p>
        )}
        {overview.bank.status === "done" && <p className="success">{sv ? "Saldona stämmer." : "The balances match."}</p>}
      </Step>

      {/* ── 6. Fixed assets ─────────────────────────────────────────────── */}
      <Step number={6} id="assets" title={sv ? "Inventarier och avskrivningar" : "Fixed assets and depreciation"} tag={badge(overview.assets.status)}>
        <p className="note">
          {sv
            ? "Dyrare saker som håller i flera år, till exempel en dator eller en bil, dras inte av på en gång. Kostnaden fördelas över åren som avskrivning."
            : "More expensive things that last several years, such as a computer or a car, are not deducted all at once. The cost is spread over the years as depreciation."}
        </p>
        {overview.assets.count === 0 && overview.assets.bookedDepreciation === 0 ? (
          <p>
            {sv ? "Du har inga inventarier registrerade." : "You have no fixed assets registered."}{" "}
            <Link href="/assets#assets-register">{sv ? "Lägg till en inventarie" : "Add an asset"}</Link>
          </p>
        ) : (
          <>
            <p>
              {sv
                ? `${overview.assets.count} inventarier i registret. Årets avskrivning enligt registret: ${money(overview.assets.registerDepreciation)}. Bokförd avskrivning: ${money(overview.assets.bookedDepreciation)}.`
                : `${overview.assets.count} assets in the register. This year's depreciation by the register: ${money(overview.assets.registerDepreciation)}. Booked depreciation: ${money(overview.assets.bookedDepreciation)}.`}{" "}
              <Link href="/assets#assets-register">{sv ? "Öppna registret" : "Open the register"}</Link>
            </p>
            {overview.assets.unbookedDepreciation > 0 && (
              <p className="note">
                {sv
                  ? `${kr(overview.assets.unbookedDepreciation)} är inte bokfört och dras därför av i ruta R16 i NE-bilagan. Du behöver inte göra något, men kontrollera att köpet inte redan är bokfört som en vanlig kostnad. I så fall ska inventarien tas bort ur registret.`
                  : `${kr(overview.assets.unbookedDepreciation)} is not booked and is therefore deducted in box R16 of the NE-bilaga. You do not need to do anything, but check that the purchase is not already booked as an ordinary cost. If it is, remove the asset from the register.`}
              </p>
            )}
            {overview.assets.disposalsThisYear > 0 && (
              <p className="note">
                {sv
                  ? "Du har sålt eller utrangerat en inventarie i år. Kontrollera att försäljningen är bokförd som intäkt. Vinst eller förlust räknas inte ut automatiskt."
                  : "You sold or scrapped an asset this year. Check that the sale is booked as income. The gain or loss is not worked out automatically."}
              </p>
            )}
          </>
        )}
      </Step>

      {/* ── 7. Reserves ─────────────────────────────────────────────────── */}
      <Step number={7} id="reserves" title={sv ? "Periodiseringsfond och expansionsfond" : "Periodiseringsfond and expansionsfond"} tag={badge(overview.reserves.status)}>
        <p className="note">
          {sv
            ? "Med en periodiseringsfond skjuter du upp skatten på upp till 30 procent av vinsten i högst sex år. Det är frivilligt, görs bara i deklarationen och kräver inga pengar på ett särskilt konto."
            : "A periodiseringsfond (tax allocation reserve) lets you put off the tax on up to 30 percent of the profit for at most six years. It is optional, exists only in the tax return and needs no money set aside in an account."}
        </p>
        <p>
          {sv
            ? `I år får du sätta av högst ${kr(overview.reserves.allocationMax)}. Avsatt i år: ${kr(overview.reserves.allocation)}. Återfört i år: ${kr(overview.reserves.withdrawal)}.`
            : `This year you may set aside at most ${kr(overview.reserves.allocationMax)}. Set aside this year: ${kr(overview.reserves.allocation)}. Brought back this year: ${kr(overview.reserves.withdrawal)}.`}{" "}
          <Link href="/periodiseringsfond#periodiseringsfond-manager">{sv ? "Ändra avsättningar" : "Change the allocations"}</Link>
        </p>
        {overview.reserves.overdue > 0 && (
          <p className="note">
            <strong>
              {sv
                ? `${money(overview.reserves.overdue)} sattes av för ${year - 6} eller tidigare och måste återföras senast i år. Registrera en återföring för ${year}.`
                : `${money(overview.reserves.overdue)} was set aside for ${year - 6} or earlier and must be brought back this year at the latest. Record a withdrawal for ${year}.`}
            </strong>
          </p>
        )}
        {overview.reserves.expansionsfond !== 0 && (
          <p className="note">
            {sv
              ? "Du har ändrat expansionsfonden i år. Fyll också i punkt 12.1 eller 12.2 i Inkomstdeklaration 1 hos Skatteverket."
              : "You changed the expansionsfond this year. Also fill in item 12.1 or 12.2 of Inkomstdeklaration 1 at Skatteverket."}
          </p>
        )}
      </Step>

      {/* ── 8. Mileage ──────────────────────────────────────────────────── */}
      <Step number={8} id="mileage" title={sv ? "Körjournal" : "Mileage log"} tag={badge(overview.mileage.status)}>
        <p className="note">
          {sv
            ? "Tjänsteresor med din privata bil ger avdrag med ett fast belopp per mil. Resorna ska finnas i körjournalen."
            : "Business trips in your private car give a deduction at a fixed rate per 10 km (mil). The trips must be in the mileage log."}
        </p>
        <p>
          {overview.mileage.deduction > 0
            ? sv
              ? `Avdrag enligt körjournalen ${year}: ${money(overview.mileage.deduction)}. ${overview.mileage.unbooked > 0 ? `${kr(overview.mileage.unbooked)} är inte bokfört och dras av i ruta R16.` : "Beloppet är redan bokfört."}`
              : `Deduction by the mileage log ${year}: ${money(overview.mileage.deduction)}. ${overview.mileage.unbooked > 0 ? `${kr(overview.mileage.unbooked)} is not booked and is deducted in box R16.` : "The amount is already booked."}`
            : sv
              ? `Inga resor registrerade ${year}.`
              : `No trips recorded in ${year}.`}{" "}
          <Link href="/mileage#mileage-log">{sv ? "Öppna körjournalen" : "Open the mileage log"}</Link>
        </p>
      </Step>

      {/* ── 9. Result and tax ───────────────────────────────────────────── */}
      <Step number={9} id="result" title={sv ? "Resultat och vad du får betala" : "The result and what you will pay"} tag={<span className="badge">{copy.estimate}</span>}>
        <div className="grid">
          <div>
            <p className="label">{sv ? "Bokfört resultat (R11)" : "Booked result (R11)"}</p>
            <p className="kpi">{kr(ne.bookedResult)}</p>
            <p className="note">{sv ? "Intäkter minus kostnader i bokföringen." : "Income minus costs in the books."}</p>
          </div>
          <div>
            <p className="label">
              {resultIsSurplus ? (sv ? "Överskott att beskatta (R47)" : "Taxable surplus (R47)") : sv ? "Underskott (R48)" : "Deficit (R48)"}
            </p>
            <p className="kpi">{kr(Math.abs(ne.result))}</p>
            <p className="note">
              {sv
                ? "Efter skattemässiga justeringar och avdrag för egenavgifter. Det här beloppet går in i din deklaration."
                : "After tax adjustments and the deduction for egenavgifter. This is the amount that goes into your tax return."}
            </p>
          </div>
          <div>
            <p className="label">{sv ? "Skatt och avgifter, ungefär" : "Tax and contributions, roughly"}</p>
            <p className="kpi">{overview.taxEstimate ? kr(overview.taxEstimate.total) : "-"}</p>
            <p className="note">
              {overview.taxEstimate
                ? sv
                  ? `Varav egenavgifter (dina sociala avgifter) ${kr(overview.taxEstimate.socialContributions)} och inkomstskatt ${kr(overview.taxEstimate.incomeTax)}.`
                  : `Of which egenavgifter (your social contributions) ${kr(overview.taxEstimate.socialContributions)} and income tax ${kr(overview.taxEstimate.incomeTax)}.`
                : sv
                  ? "Ingen uppskattning: skatteinställningarna saknas."
                  : "No estimate: the tax settings are missing."}
            </p>
          </div>
        </div>
        <p className="note">
          {sv
            ? "Det här är en uppskattning, inte ett besked. Den räknas på verksamhetens överskott med skattesatserna under Inställningar och tar inte hänsyn till lön eller andra inkomster, grundavdrag, jobbskatteavdrag eller den F-skatt du redan har betalat in under året. Den exakta skatten ser du i Skatteverkets skatteuträkning när NE-bilagan är inläst."
            : "This is an estimate, not a decision. It is worked out on the surplus of the business with the tax rates under Settings and ignores salary or other income, the basic allowance, the earned income tax credit and the preliminary tax (F-skatt) you have already paid during the year. You see the exact tax in Skatteverket's tax calculation once the NE-bilaga is imported."}{" "}
          <Link href="/settings#tax-config">{sv ? "Ändra skattesatser" : "Change the tax rates"}</Link>
        </p>
      </Step>

      {/* ── 10. NE-bilaga ───────────────────────────────────────────────── */}
      <Step number={10} id="ne-bilaga" title={sv ? "NE-bilagan" : "The NE-bilaga"} tag={<span className="badge">{copy.preview}</span>}>
        <p className="note">
          {sv
            ? "NE-bilagan är den del av deklarationen där du redovisar din enskilda firma. Här är varje ruta med belopp och förklaring. Belopp från bokföringen kan du fälla ut för att se vilka konton som ligger bakom."
            : "The NE-bilaga is the part of the tax return where you report your sole trader business. Here is every box with its amount and an explanation. Amounts from the books can be opened to see the accounts behind them."}{" "}
          <a href={SKV_NE_GUIDE_URL} target="_blank" rel="noreferrer">
            {sv ? "Skatteverkets guide till NE-bilagan" : "Skatteverket's guide to the NE-bilaga"}
          </a>
        </p>

        {ne.warnings.length > 0 && (
          <div className="stack">
            <h3 style={{ margin: 0 }}>{sv ? "Att kontrollera" : "Things to check"}</h3>
            {ne.warnings.map((warning, index) => (
              <p className="note" key={`${warning.code}-${index}`}>
                {neWarningText(warning, locale, money)}
              </p>
            ))}
          </div>
        )}

        {(["balance", "income", "adjustments", "other"] as NeSection[]).map(sectionTable)}

        <div className="stack" id="own-figures">
          <h3 style={{ margin: 0 }}>{sv ? "Egna belopp" : "Your own figures"}</h3>
          <p className="note">
            {sv
              ? `Några rutor kan bara du svara på, eftersom uppgifterna inte finns i bokföringen. De visas som "Fyll i själv" i tabellen. De vanligaste är R40 och R41, som du hittar i specifikationen till deklarationen från Skatteverket. Det du inte fyller i räknas som tomt.`
              : `Some boxes only you can answer, because the information is not in the books. They are shown as "Fill in yourself" in the table. The most common are R40 and R41, which you find in the specification Skatteverket sends with your tax return. Anything you leave out counts as empty.`}
          </p>
          <OwnFiguresForm locale={locale} year={year} common={commonFigures} rare={rareFigures} />
        </div>

        <p className="note">
          {sv
            ? `Inte med i Akunta: övriga uppgifter 1 och 3 till 10 (leasad bil, räntekostnader, värdeminskning på byggnader, räntefördelning och expansionsfondens kapitalunderlag). Gäller något av det dig fyller du i det hos Skatteverket efter importen. Akunta utgår från att verksamheten är aktiv och att du gör förenklat årsbokslut. ${neAmount(ne, "R47") > 0 ? "Överskottet i R47 för du över till punkt 10.1 i Inkomstdeklaration 1." : neAmount(ne, "R48") > 0 ? "Underskottet i R48 för du över till punkt 10.2 i Inkomstdeklaration 1." : ""}`
            : `Not covered by Akunta: other information items 1 and 3 to 10 (leased car, interest costs, depreciation of buildings, interest allocation and the capital base of the expansionsfond). If any of them applies to you, fill it in at Skatteverket after the import. Akunta assumes that the business is active and that you prepare simplified year-end accounts (förenklat årsbokslut). ${neAmount(ne, "R47") > 0 ? "The surplus in R47 is carried to item 10.1 of Inkomstdeklaration 1." : neAmount(ne, "R48") > 0 ? "The deficit in R48 is carried to item 10.2 of Inkomstdeklaration 1." : ""}`}
        </p>
      </Step>

      {/* ── 11. SRU files ───────────────────────────────────────────────── */}
      <Step
        number={11}
        id="sru"
        title={sv ? "Ladda ner filerna till Skatteverket" : "Download the files for Skatteverket"}
        tag={badge(overview.sru.supported ? (overview.sru.ready ? "done" : "attention") : "na")}
      >
        <p className="note">
          {sv
            ? "I stället för att skriva av alla rutor kan du läsa in NE-bilagan som en fil (en SRU-fil) i Skatteverkets e-tjänst Inkomstdeklaration 1."
            : "Instead of typing every box you can import the NE-bilaga as a file (an SRU file) in Skatteverket's e-service Inkomstdeklaration 1."}
        </p>

        {!overview.sru.supported ? (
          <p>
            <strong>
              {sv
                ? `Ingen fil kan skapas för inkomståret ${year}. Akunta har Skatteverkets fältkoder för ${overview.sru.supportedYears.join(", ")} och gissar inte koder för andra år. Fyll i NE-bilagan för hand hos Skatteverket med hjälp av förhandsvisningen ovan.`
                : `No file can be made for income year ${year}. Akunta has Skatteverket's field codes for ${overview.sru.supportedYears.join(", ")} and does not guess codes for other years. Fill in the NE-bilaga by hand at Skatteverket using the preview above.`}
            </strong>
          </p>
        ) : (
          <>
            <h3 style={{ margin: 0 }}>{sv ? "Uppgifter om dig" : "Details about you"}</h3>
            <p className="note">
              {sv
                ? "Filerna måste innehålla ditt namn, personnummer och din postadress. Uppgifterna sparas bara i ditt bokslut."
                : "The files must contain your name, personnummer and postal address. The details are stored only with your year-end."}
            </p>
            <SruDetailsForm
              locale={locale}
              year={year}
              initial={{
                name: overview.sru.defaults.name ?? "",
                personnummer: overview.sru.defaults.personnummer ?? "",
                address: overview.sru.defaults.address ?? "",
                postalCode: overview.sru.defaults.postalCode ?? "",
                city: overview.sru.defaults.city ?? "",
                email: overview.sru.defaults.email ?? "",
                activity: overview.inputs.general.activity ?? "",
                helped: overview.inputs.general.helped ?? ""
              }}
            />

            {overview.sru.ready ? (
              <>
                <div className="row">
                  <a className="button" href={`/api/year-end/sru/blanketter?year=${year}`} download="BLANKETTER.SRU">
                    {sv ? "Ladda ner BLANKETTER.SRU" : "Download BLANKETTER.SRU"}
                  </a>
                  <a className="button secondary" href={`/api/year-end/sru/info?year=${year}`} download="INFO.SRU">
                    {sv ? "Ladda ner INFO.SRU" : "Download INFO.SRU"}
                  </a>
                </div>
                <p className="note">
                  {sv
                    ? `Filerna gäller blankettblock ${overview.sru.block} och skapas från bokföringen i samma stund som du laddar ner dem. Ändrar du något efteråt laddar du ner dem igen. Byt inte namn på filerna.`
                    : `The files are for form block ${overview.sru.block} and are built from the books at the moment you download them. If you change anything afterwards, download them again. Do not rename the files.`}
                </p>
                {!overview.yearEnded && (
                  <p className="note">
                    {sv
                      ? `Året är inte slut, så filen är bara ett utkast. Skatteverkets e-tjänst för ${year} öppnar under våren ${year + 1}.`
                      : `The year is not over, so the file is only a draft. Skatteverket's e-service for ${year} opens in the spring of ${year + 1}.`}
                  </p>
                )}
              </>
            ) : (
              <p>
                <strong>
                  {sv
                    ? `Fyll i ${missingDetails.join(", ")} ovan och spara, så visas nedladdningen här.`
                    : `Fill in ${missingDetails.join(", ")} above and save, and the download appears here.`}
                </strong>
              </p>
            )}

            <h3 style={{ margin: 0 }}>{sv ? "Så läser du in filen hos Skatteverket" : "How to import the file at Skatteverket"}</h3>
            <ol className="stack" style={{ margin: 0, paddingLeft: 22, gap: 8 }}>
              {(sv
                ? [
                    "Ladda ner BLANKETTER.SRU här ovanför och spara den på datorn.",
                    "Logga in i e-tjänsten Inkomstdeklaration 1 på skatteverket.se med BankID.",
                    "Välj fliken Bilagor. Där ser du vilka bilagor du förväntas lämna.",
                    "Klicka på Importera vid Enskild näringsverksamhet (NE). Klicka på Bläddra, leta upp BLANKETTER.SRU, klicka på Öppna och sedan på Importera.",
                    "Du får en översikt över vilka avsnitt i NE-bilagan som är klara och meddelandet att importen har lyckats. Klicka på ett avsnitt som inte är klart för att rätta eller komplettera det.",
                    "Öppna fliken Dina deklarationsuppgifter, välj Näringsverksamhet och kontrollera beloppen mot förhandsvisningen här.",
                    "Titta på fliken Skatteuträkning för att se vad du får betala eller får tillbaka.",
                    "Granska allt under fliken Skicka in, skriv under med BankID och spara kvittensen."
                  ]
                : [
                    "Download BLANKETTER.SRU above and save it on your computer.",
                    "Log in to the e-service Inkomstdeklaration 1 at skatteverket.se with BankID.",
                    "Choose the tab Bilagor (attachments). It shows which forms you are expected to submit.",
                    "Click Importera next to Enskild näringsverksamhet (NE). Click Bläddra, find BLANKETTER.SRU, click Öppna and then Importera.",
                    "You get an overview of which sections of the NE-bilaga are complete and a message that the import succeeded. Click a section that is not complete to correct or add to it.",
                    "Open the tab Dina deklarationsuppgifter, choose Näringsverksamhet and check the amounts against the preview here.",
                    "Look at the tab Skatteuträkning to see what you will pay or get back.",
                    "Review everything under the tab Skicka in, sign with BankID and save the receipt."
                  ]
              ).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="note">
              {sv
                ? "Du behöver bara BLANKETTER.SRU för importen. INFO.SRU behövs om en redovisningsbyrå skickar in filerna åt dig via Skatteverkets tjänst Filöverföring, som kräver båda filerna."
                : "You only need BLANKETTER.SRU for the import. INFO.SRU is needed if an accounting firm submits the files for you through Skatteverket's Filöverföring service, which requires both files."}{" "}
              <a href={SKV_IMPORT_URL} target="_blank" rel="noreferrer">
                {sv ? "Skatteverkets instruktion för importen" : "Skatteverket's instructions for the import"}
              </a>
            </p>
          </>
        )}
      </Step>

      {/* ── 12. Close ───────────────────────────────────────────────────── */}
      <Step number={12} id="close" title={sv ? "Stäng året" : "Close the year"} tag={badge(overview.closed ? "done" : overview.yearEnded ? "attention" : "na")}>
        <p className="note">
          {sv
            ? `När du stänger året låses bokföringen för ${year}, så att inget kan ändras av misstag, och saldona på bank, skulder och eget kapital förs över som ingående balanser till ${year + 1}. Gör det när stegen ovan är klara.`
            : `Closing the year locks the books for ${year}, so that nothing can be changed by mistake, and carries the balances for bank, liabilities and equity forward as opening balances for ${year + 1}. Do it when the steps above are done.`}
        </p>
        {overview.closed ? (
          <p className="success">
            {sv
              ? `${year} är stängt${overview.closedAt ? ` sedan ${overview.closedAt.slice(0, 10)}` : ""}. Saldona finns som ingående balanser ${year + 1}.`
              : `${year} is closed${overview.closedAt ? ` since ${overview.closedAt.slice(0, 10)}` : ""}. The balances are in place as opening balances for ${year + 1}.`}{" "}
            <Link href={`/year-end?year=${year + 1}`}>{sv ? `Gå till ${year + 1}` : `Go to ${year + 1}`}</Link>
          </p>
        ) : !overview.yearEnded ? (
          <p>
            {sv ? `Året kan stängas från den 1 januari ${year + 1}.` : `The year can be closed from 1 January ${year + 1}.`}
          </p>
        ) : (
          <CloseYearButton locale={locale} year={year} openSteps={Math.max(0, overview.stepsOpen - 1)} disabled={false} />
        )}
      </Step>
    </section>
  );
}
