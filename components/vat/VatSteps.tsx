import Link from "next/link";

import { SKV_LINKS, vatHref } from "@/components/vat/links";
import { VatFilingAction } from "@/components/vat/VatFilingAction";
import { formatMoney } from "@/lib/data/format";
import { type Locale } from "@/lib/i18n/locale";
import {
  UNSUPPORTED_BOX_GROUPS,
  type MomsBlocker,
  type MomsBoxes,
  type MomsBoxId,
  type Momsdeklaration,
  type MomsEntry
} from "@/lib/tax/momsdeklaration";
import { formatVatDate, swedishToday, type VatPeriod, type VatPeriodStatus } from "@/lib/tax/vat-periods";

const MAX_ENTRIES_SHOWN = 200;

const money = (value: number, locale: Locale) => formatMoney(value, "SEK", locale === "sv" ? "sv-SE" : "en-GB");
const isoDay = (date: Date) => new Date(date).toISOString().slice(0, 10);

/** Extra checks the page works out itself, next to the ones from the ledger. */
export type VatPageCheck = {
  id: "noOrgNr" | "notRegistered" | "periodOpen" | "unpaidAtYearEnd";
  count?: number;
  amount?: number;
};

// ─── Step 1: Check ───────────────────────────────────────────────────────────

type CheckStepProps = {
  locale: Locale;
  period: VatPeriod;
  declaration: Momsdeklaration;
  pageChecks: VatPageCheck[];
  /** Nothing booked, nothing waiting and the deadline has not passed. */
  nothingYet: boolean;
};

export const VatCheckStep = ({ locale, period, declaration, pageChecks, nothingYet }: CheckStepProps) => {
  const sv = locale === "sv";
  const { crossCheck } = declaration;

  const copy = sv
    ? {
        heading: "1. Kontrollera",
        intro: "Det här behöver vara klart för att deklarationen ska bli rätt.",
        allClear: "Inget står i vägen",
        allClearText: "Alla kvitton i perioden är bokförda och momsen i rutorna stämmer med bokföringen.",
        nothingYet: "Inget att redovisa ännu",
        nothingYetText: (end: string, deadline: string) =>
          `Det finns inget bokfört i den här perioden, så det finns inget att kontrollera. Perioden löper till ${end} och deklarationen ska lämnas senast ${deadline}. Bokför dina kvitton och betalningar som vanligt, så fylls rutorna i av sig själva.`,
        nothingYetZero:
          "Har du inte haft någon försäljning eller några inköp alls när perioden är slut lämnar du ändå en deklaration med noll. Det gör du här på samma sätt.",
        addReceipt: "Lägg till kvitton",
        mustFix: "Åtgärda först",
        check: "Kontrollera",
        fix: "Öppna och åtgärda",
        more: (n: number) => `och ${n} till`,
        next: "Fortsätt till granskning",
        nextAnyway: "Fortsätt ändå",
        abroadTitle: "Har du handlat med utlandet under perioden?",
        abroadText:
          "Akunta fyller i ruta 05, 10, 11, 12, 48 och 49. Inköp från andra länder, försäljning till andra länder, import, byggtjänster med omvänd moms och momsfri försäljning hör hemma i andra rutor som Akunta inte stöder ännu. Har du haft sådant under perioden lägger du till de beloppen själv hos Skatteverket innan du skickar in.",
        abroadLink: "Se vilka rutor det gäller"
      }
    : {
        heading: "1. Check",
        intro: "These need to be in order for the return to be correct.",
        allClear: "Nothing in the way",
        allClearText: "Every receipt in the period is booked and the VAT in the boxes matches your books.",
        nothingYet: "Nothing to report yet",
        nothingYetText: (end: string, deadline: string) =>
          `Nothing is booked in this period, so there is nothing to check. The period runs until ${end} and the return is due by ${deadline}. Book your receipts and payments as usual and the boxes fill in by themselves.`,
        nothingYetZero:
          "If you have had no sales and no purchases at all when the period ends, you still file a return showing zero. You do that here in the same way.",
        addReceipt: "Add receipts",
        mustFix: "Fix first",
        check: "Check",
        fix: "Open and fix",
        more: (n: number) => `and ${n} more`,
        next: "Continue to review",
        nextAnyway: "Continue anyway",
        abroadTitle: "Did you trade with other countries in this period?",
        abroadText:
          "Akunta fills in boxes (rutor) 05, 10, 11, 12, 48 and 49. Purchases from other countries, sales to other countries, imports, construction services with reverse charge and sales exempt from VAT belong in other boxes that Akunta does not support yet. If you had any of those in the period, add the amounts yourself at Skatteverket before you submit.",
        abroadLink: "See which boxes this concerns"
      };

  const blockerText = (blocker: MomsBlocker): { title: string; text: string } => {
    switch (blocker.id) {
      case "receiptsPending":
        return sv
          ? {
              title: `${blocker.count} kvitton väntar på granskning`,
              text: "Ett kvitto bokförs först när du har granskat det. Tills dess saknas dess moms i ruta 48, så du drar av för lite."
            }
          : {
              title: `${blocker.count} receipts are waiting for review`,
              text: "A receipt is only booked once you have reviewed it. Until then its VAT is missing from box 48, so you deduct too little."
            };
      case "unclearRate":
        return sv
          ? {
              title: `${blocker.count} försäljningar har en momssats som inte går att avgöra`,
              text: `Momsen på dem (${money(blocker.amount ?? 0, locale)}) motsvarar varken 25, 12 eller 6 procent av beloppet, så de finns inte med i någon ruta. Ofta är det en försäljning med flera momssatser som behöver delas upp, eller ett fel belopp.`
            }
          : {
              title: `${blocker.count} sales have a VAT rate that cannot be determined`,
              text: `Their VAT (${money(blocker.amount ?? 0, locale)}) is neither 25, 12 nor 6 percent of the amount, so they are in no box. Usually it is a sale with several VAT rates that needs splitting, or a wrong amount.`
            };
      case "ledgerMismatch":
        return sv
          ? {
              title: "Rutorna stämmer inte med bokföringen",
              text: `Utgående moms: rutorna visar ${money(crossCheck.boxOutputVat, locale)}, momskontona i bokföringen (2610 till 2639) visar ${money(crossCheck.ledgerOutputVat, locale)}. Skillnad ${money(crossCheck.outputDifference, locale)}. Ingående moms: rutorna visar ${money(crossCheck.boxInputVat, locale)}, konto 2640 till 2649 visar ${money(crossCheck.ledgerInputVat, locale)}. Skillnad ${money(crossCheck.inputDifference, locale)}. Lämna inte in förrän skillnaden är förklarad.`
            }
          : {
              title: "The boxes do not match your books",
              text: `Output VAT: the boxes show ${money(crossCheck.boxOutputVat, locale)}, the VAT accounts in the ledger (2610 to 2639) show ${money(crossCheck.ledgerOutputVat, locale)}. Difference ${money(crossCheck.outputDifference, locale)}. Input VAT: the boxes show ${money(crossCheck.boxInputVat, locale)}, accounts 2640 to 2649 show ${money(crossCheck.ledgerInputVat, locale)}. Difference ${money(crossCheck.inputDifference, locale)}. Do not file until the difference is explained.`
            };
      case "salesAccountWithoutVat":
        return sv
          ? {
              title: `${blocker.count} försäljningar är bokförda på ett momskonto men utan moms`,
              text: "De ligger på ett försäljningskonto för 25, 12 eller 6 procent men har ingen moms. Stämmer det att de är momsfria hör de hemma på konto 3051, annars saknas moms i deklarationen."
            }
          : {
              title: `${blocker.count} sales are booked on a VAT sales account but without VAT`,
              text: "They sit on a sales account for 25, 12 or 6 percent but carry no VAT. If they really are VAT free they belong on account 3051, otherwise VAT is missing from the return."
            };
    }
  };

  const pageCheckText = (check: VatPageCheck): { title: string; text: string; href?: string; linkLabel?: string } => {
    switch (check.id) {
      case "noOrgNr":
        return sv
          ? {
              title: "Personnummer saknas",
              text: "Filen till Skatteverket måste innehålla ditt personnummer (eller organisationsnummer). Lägg till det i inställningarna så kan du ladda ner filen.",
              href: "/settings",
              linkLabel: "Öppna inställningar"
            }
          : {
              title: "Personal identity number missing",
              text: "The file for Skatteverket must contain your personnummer (or organisation number). Add it in settings and you can download the file.",
              href: "/settings",
              linkLabel: "Open settings"
            };
      case "notRegistered":
        return sv
          ? {
              title: "Företaget är inte markerat som momsregistrerat",
              text: "Är du inte momsregistrerad ska du inte lämna någon momsdeklaration. Stämmer det inte ändrar du det i inställningarna.",
              href: "/settings",
              linkLabel: "Öppna inställningar"
            }
          : {
              title: "The business is not marked as VAT registered",
              text: "If you are not VAT registered you do not file a VAT return. If that is wrong, change it in settings.",
              href: "/settings",
              linkLabel: "Open settings"
            };
      case "periodOpen":
        return sv
          ? {
              title: `Perioden pågår till ${formatVatDate(period.end, locale)}`,
              text: "Siffrorna är preliminära och ändras när du bokför mer. Du kan lämna in när perioden är slut."
            }
          : {
              title: `The period runs until ${formatVatDate(period.end, locale)}`,
              text: "The figures are preliminary and change as you book more. You can file once the period has ended."
            };
      case "unpaidAtYearEnd":
        return sv
          ? {
              title: `${check.count} obetalda fakturor vid årets slut`,
              text: `Med kontantmetoden redovisar du normalt momsen när kunden betalar. Vid räkenskapsårets slut ska momsen på obetalda fakturor ändå tas med. Akunta lägger inte till den automatiskt: ${money(check.amount ?? 0, locale)} i moms på obetalda fakturor finns inte i rutorna.`,
              href: "/invoices",
              linkLabel: "Visa fakturor"
            }
          : {
              title: `${check.count} unpaid invoices at year end`,
              text: `With the cash method (kontantmetoden) you normally report VAT when the customer pays. At the end of the fiscal year the VAT on unpaid invoices must be included anyway. Akunta does not add it automatically: ${money(check.amount ?? 0, locale)} of VAT on unpaid invoices is not in the boxes.`,
              href: "/invoices",
              linkLabel: "Show invoices"
            };
    }
  };

  if (nothingYet) {
    return (
      <div className="stack" style={{ gap: 14 }}>
        <h2 style={{ margin: 0 }}>{copy.nothingYet}</h2>
        <p style={{ margin: 0, maxWidth: "80ch" }}>
          {copy.nothingYetText(formatVatDate(period.end, locale), formatVatDate(period.deadline, locale))}
        </p>
        <p className="note" style={{ maxWidth: "80ch" }}>
          {copy.nothingYetZero}
        </p>
        <div className="row">
          <Link href="/receipts" className="button">
            {copy.addReceipt}
          </Link>
          <Link href={vatHref(period.key, "review")} className="button secondary">
            {copy.next}
          </Link>
        </div>
      </div>
    );
  }

  const hardBlockers = declaration.blockers.filter((b) => b.severity === "blocker").length;
  const nothingToFix = declaration.blockers.length === 0 && pageChecks.length === 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h2 style={{ margin: 0 }}>{copy.heading}</h2>
        <p className="note">{copy.intro}</p>
      </div>

      {nothingToFix && (
        <div className="stack" style={{ gap: 4 }}>
          <p style={{ margin: 0 }}>
            <span className="badge good">{copy.allClear}</span>
          </p>
          <p style={{ margin: 0 }}>{copy.allClearText}</p>
        </div>
      )}

      {declaration.blockers.map((blocker) => {
        const text = blockerText(blocker);
        const hidden = blocker.count - blocker.items.length;
        return (
          <div className="stack" key={blocker.id} style={{ gap: 6 }}>
            <p style={{ margin: 0 }}>
              <span className="badge warn">{blocker.severity === "blocker" ? copy.mustFix : copy.check}</span>{" "}
              <strong>{text.title}</strong>
            </p>
            <p style={{ margin: 0, maxWidth: "80ch" }}>{text.text}</p>
            {blocker.items.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {blocker.items.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className="textLink">
                      {item.label}
                    </Link>
                    {item.date && <span className="note"> {isoDay(item.date)}</span>}
                    {item.amount !== null && <span className="note"> {money(item.amount, locale)}</span>}
                    <span className="note"> · {copy.fix}</span>
                  </li>
                ))}
                {hidden > 0 && <li className="note">{copy.more(hidden)}</li>}
              </ul>
            )}
          </div>
        );
      })}

      {pageChecks.map((check) => {
        const text = pageCheckText(check);
        return (
          <div className="stack" key={check.id} style={{ gap: 6 }}>
            <p style={{ margin: 0 }}>
              <span className="badge warn">{copy.check}</span> <strong>{text.title}</strong>
            </p>
            <p style={{ margin: 0, maxWidth: "80ch" }}>{text.text}</p>
            {text.href && (
              <p style={{ margin: 0 }}>
                <Link href={text.href} className="textLink">
                  {text.linkLabel}
                </Link>
              </p>
            )}
          </div>
        );
      })}

      <div className="stack" style={{ gap: 6 }}>
        <p style={{ margin: 0 }}>
          <strong>{copy.abroadTitle}</strong>
        </p>
        <p style={{ margin: 0, maxWidth: "80ch" }}>{copy.abroadText}</p>
        <p style={{ margin: 0 }}>
          <Link href={`${vatHref(period.key, "review").replace("#flow", "")}#unsupported`} className="textLink">
            {copy.abroadLink}
          </Link>
        </p>
      </div>

      <div className="row">
        <Link href={vatHref(period.key, "review")} className="button">
          {hardBlockers > 0 ? copy.nextAnyway : copy.next}
        </Link>
      </div>
    </div>
  );
};

// ─── Step 2: Review ──────────────────────────────────────────────────────────

type ReviewStepProps = {
  locale: Locale;
  period: VatPeriod;
  declaration: Momsdeklaration;
};

const BOX_ORDER: MomsBoxId[] = ["05", "10", "11", "12", "48", "49"];

const EntriesTable = ({ locale, entries, show }: { locale: Locale; entries: MomsEntry[]; show: "net" | "vat" }) => {
  const sv = locale === "sv";
  const copy = sv
    ? {
        summary: (n: number) => `Visa de ${n} verifikationerna bakom rutan`,
        none: "Inga verifikationer i den här rutan.",
        ver: "Ver.nr",
        date: "Datum",
        description: "Beskrivning",
        net: "Belopp utan moms",
        vat: "Moms",
        cancelled: "Makulerad",
        correction: "Rättelse",
        open: "Öppna",
        truncated: (n: number) => `Visar de första ${MAX_ENTRIES_SHOWN} av ${n}. Alla finns under Transaktioner.`
      }
    : {
        summary: (n: number) => `Show the ${n} entries behind this box`,
        none: "No entries in this box.",
        ver: "Ver. no.",
        date: "Date",
        description: "Description",
        net: "Amount excl. VAT",
        vat: "VAT",
        cancelled: "Cancelled",
        correction: "Correction",
        open: "Open",
        truncated: (n: number) => `Showing the first ${MAX_ENTRIES_SHOWN} of ${n}. All of them are under Transactions.`
      };

  if (entries.length === 0) return <p className="note">{copy.none}</p>;

  return (
    <details>
      <summary style={{ cursor: "pointer" }}>{copy.summary(entries.length)}</summary>
      <div className="tableWrap" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              <th>{copy.ver}</th>
              <th>{copy.date}</th>
              <th>{copy.description}</th>
              <th style={{ textAlign: "right" }}>{show === "net" ? copy.net : copy.vat}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, MAX_ENTRIES_SHOWN).map((entry) => (
              <tr key={entry.id}>
                <td>{entry.verificationNumber}</td>
                <td>{isoDay(entry.txnDate)}</td>
                <td>
                  {entry.description}
                  {(entry.cancelled || entry.correction) && (
                    <>
                      {" "}
                      <span className="badge warn">{entry.cancelled ? copy.cancelled : copy.correction}</span>
                    </>
                  )}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(show === "net" ? entry.net : entry.vat, locale)}</td>
                <td>
                  <Link href={entry.receiptId ? `/review/receipts/${entry.receiptId}` : `/review/transactions/${entry.id}`}>
                    {copy.open}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length > MAX_ENTRIES_SHOWN && (
        <p className="note" style={{ marginTop: 8 }}>
          {copy.truncated(entries.length)} <Link href="/transactions">/transactions</Link>
        </p>
      )}
    </details>
  );
};

export const VatReviewStep = ({ locale, period, declaration }: ReviewStepProps) => {
  const sv = locale === "sv";
  const { boxes, exact, crossCheck, salesWithoutVat } = declaration;

  const copy = sv
    ? {
        heading: "2. Granska",
        intro: "Så här ser din momsdeklaration ut, ruta för ruta. Öppna en ruta för att se vad som ligger bakom.",
        box: "Ruta",
        before: (v: string) => `${v} före avrundning. Deklarationen tar bara hela kronor, ören stryks.`,
        formula: "Ruta 10 + 11 + 12 minus ruta 48:",
        matches: "Stämmer med bokföringen",
        matchesText: "Momsen i rutorna är samma som på momskontona i bokföringen för perioden.",
        mismatch: "Stämmer inte med bokföringen",
        mismatchText: (out: string, inn: string) =>
          `Skillnad utgående moms ${out}, ingående moms ${inn}. Gå tillbaka till kontrollen för detaljer.`,
        unsupportedHeading: "Rutor som Akunta inte fyller i ännu",
        unsupportedIntro:
          "De här rutorna är inte noll, de är tomma för att Akunta inte kan räkna fram dem. Har du haft sådan handel under perioden fyller du i dem själv i Skatteverkets e-tjänst efter att du har laddat upp filen. Ruta 49 räknas då om där.",
        notSupported: "Stöds inte ännu",
        withoutVat: (amount: string, n: number) =>
          `Du har ${amount} i försäljning utan moms i perioden (${n} verifikationer). Den finns inte med i någon ruta. Är det försäljning till andra länder eller momsfri försäljning hör den hemma i ruta 35 till 42.`,
        guide: "Skatteverkets förklaring av varje ruta",
        back: "Tillbaka till kontrollen",
        next: "Fortsätt till inlämning"
      }
    : {
        heading: "2. Review",
        intro: "This is your VAT return, box by box. Open a box to see what is behind it.",
        box: "Box (ruta)",
        before: (v: string) => `${v} before rounding. The return takes whole kronor only, the öre are dropped.`,
        formula: "Box 10 + 11 + 12 minus box 48:",
        matches: "Matches your books",
        matchesText: "The VAT in the boxes is the same as on the VAT accounts in your ledger for the period.",
        mismatch: "Does not match your books",
        mismatchText: (out: string, inn: string) =>
          `Difference in output VAT ${out}, input VAT ${inn}. Go back to the check for details.`,
        unsupportedHeading: "Boxes Akunta does not fill in yet",
        unsupportedIntro:
          "These boxes are not zero, they are empty because Akunta cannot work them out. If you had this kind of trade in the period, fill them in yourself in Skatteverket's e-service after you upload the file. Box 49 is then recalculated there.",
        notSupported: "Not supported yet",
        withoutVat: (amount: string, n: number) =>
          `You have ${amount} of sales without VAT in the period (${n} entries). They are in no box. If they are sales to other countries or sales exempt from VAT they belong in boxes 35 to 42.`,
        guide: "Skatteverket's explanation of each box",
        back: "Back to the check",
        next: "Continue to filing"
      };

  const boxCopy: Record<MomsBoxId, { name: string; text: string }> = sv
    ? {
        "05": {
          name: "Momspliktig försäljning",
          text: "Det du har sålt i Sverige med moms under perioden, räknat utan momsen."
        },
        "10": { name: "Utgående moms 25 %", text: "Momsen du har tagit ut av dina kunder på försäljning med 25 procent moms." },
        "11": {
          name: "Utgående moms 12 %",
          text: "Momsen du har tagit ut på försäljning med 12 procent moms, till exempel livsmedel och hotell."
        },
        "12": {
          name: "Utgående moms 6 %",
          text: "Momsen du har tagit ut på försäljning med 6 procent moms, till exempel böcker och persontransporter."
        },
        "48": {
          name: "Ingående moms att dra av",
          text: "Momsen du har betalat på inköp till företaget och får tillbaka."
        },
        "49": {
          name: boxes["49"] < 0 ? "Moms att få tillbaka" : "Moms att betala",
          text: "Det du ska betala till Skatteverket, eller få tillbaka om beloppet är negativt."
        }
      }
    : {
        "05": {
          name: "Sales liable to VAT (momspliktig försäljning)",
          text: "What you sold in Sweden with VAT during the period, counted without the VAT."
        },
        "10": { name: "Output VAT 25 % (utgående moms)", text: "The VAT you charged your customers on sales at 25 percent." },
        "11": {
          name: "Output VAT 12 % (utgående moms)",
          text: "The VAT you charged on sales at 12 percent, for example food and hotel stays."
        },
        "12": {
          name: "Output VAT 6 % (utgående moms)",
          text: "The VAT you charged on sales at 6 percent, for example books and passenger transport."
        },
        "48": {
          name: "Input VAT to deduct (ingående moms)",
          text: "The VAT you paid on purchases for the business and get back."
        },
        "49": {
          name: boxes["49"] < 0 ? "VAT to get back (moms att få tillbaka)" : "VAT to pay (moms att betala)",
          text: "What you pay to Skatteverket, or get back if the amount is negative."
        }
      };

  const unsupportedCopy: Record<(typeof UNSUPPORTED_BOX_GROUPS)[number]["id"], { name: string; text: string }> = sv
    ? {
        selfSupply: {
          name: "Uttag, vinstmarginal och hyresinkomster",
          text: "Om du har tagit ut varor eller tjänster för eget bruk, säljer med vinstmarginalbeskattning eller hyr ut lokal med frivillig moms."
        },
        reverseCharge: {
          name: "Inköp där du själv redovisar momsen",
          text: "Varor och tjänster köpta från andra EU-länder, tjänster köpta från länder utanför EU och inköp i Sverige med omvänd moms, till exempel byggtjänster."
        },
        exemptSales: {
          name: "Försäljning utan svensk moms",
          text: "Varor och tjänster sålda till andra EU-länder, export, försäljning med omvänd moms och annan momsfri försäljning."
        },
        import: {
          name: "Import",
          text: "Varor som du har importerat från länder utanför EU och redovisar momsen för i deklarationen."
        }
      }
    : {
        selfSupply: {
          name: "Self-supply, margin scheme and rental income",
          text: "If you took goods or services for your own use, sell under the profit margin scheme or let premises with voluntary VAT."
        },
        reverseCharge: {
          name: "Purchases where you account for the VAT yourself",
          text: "Goods and services bought from other EU countries, services bought from outside the EU and purchases in Sweden with reverse charge, for example construction services."
        },
        exemptSales: {
          name: "Sales without Swedish VAT",
          text: "Goods and services sold to other EU countries, exports, sales with reverse charge and other sales exempt from VAT."
        },
        import: {
          name: "Imports",
          text: "Goods you imported from outside the EU and account for the VAT on in the return."
        }
      };

  const entriesFor = (id: MomsBoxId): MomsEntry[] => (id === "49" ? [] : declaration.entries[id]);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h2 style={{ margin: 0 }}>{copy.heading}</h2>
        <p className="note">{copy.intro}</p>
      </div>

      {BOX_ORDER.map((id) => (
        <div className="stack" key={id} style={{ gap: 6 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <p className="label">
                {copy.box} {id}
              </p>
              <h3 style={{ margin: 0 }}>{boxCopy[id].name}</h3>
            </div>
            <p className="kpi" style={{ fontSize: "1.5rem" }}>
              {money(boxes[id], locale)}
            </p>
          </div>
          <p style={{ margin: 0, maxWidth: "80ch" }}>{boxCopy[id].text}</p>
          {id === "49" ? (
            <p className="note">
              {copy.formula} {boxes["10"]} + {boxes["11"]} + {boxes["12"]} − {boxes["48"]} = {boxes["49"]}
            </p>
          ) : (
            <>
              {exact[id] !== boxes[id] && <p className="note">{copy.before(money(exact[id], locale))}</p>}
              <EntriesTable locale={locale} entries={entriesFor(id)} show={id === "05" ? "net" : "vat"} />
            </>
          )}
        </div>
      ))}

      <div className="stack" style={{ gap: 4 }}>
        <p style={{ margin: 0 }}>
          <span className={crossCheck.ok ? "badge good" : "badge warn"}>{crossCheck.ok ? copy.matches : copy.mismatch}</span>
        </p>
        <p className="note">
          {crossCheck.ok
            ? copy.matchesText
            : copy.mismatchText(money(crossCheck.outputDifference, locale), money(crossCheck.inputDifference, locale))}
        </p>
      </div>

      <div className="stack" id="unsupported" style={{ gap: 14 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h3 style={{ margin: 0 }}>{copy.unsupportedHeading}</h3>
          <p style={{ margin: 0, maxWidth: "80ch" }}>{copy.unsupportedIntro}</p>
        </div>
        {UNSUPPORTED_BOX_GROUPS.map((group) => (
          <div key={group.id} className="stack" style={{ gap: 2 }}>
            <p style={{ margin: 0 }}>
              <strong>
                {copy.box} {group.boxes[0]} {sv ? "till" : "to"} {group.boxes[group.boxes.length - 1]}
              </strong>{" "}
              {unsupportedCopy[group.id].name} <span className="badge warn">{copy.notSupported}</span>
            </p>
            <p className="note" style={{ maxWidth: "80ch" }}>
              {unsupportedCopy[group.id].text}
            </p>
          </div>
        ))}
        {salesWithoutVat.count > 0 && (
          <p style={{ margin: 0, maxWidth: "80ch" }}>{copy.withoutVat(money(salesWithoutVat.amount, locale), salesWithoutVat.count)}</p>
        )}
        <p className="note">
          <a href={SKV_LINKS.boxes} target="_blank" rel="noreferrer" className="textLink">
            {copy.guide}
          </a>
        </p>
      </div>

      <div className="row">
        <Link href={vatHref(period.key, "file")} className="button">
          {copy.next}
        </Link>
        <Link href={vatHref(period.key, "check")} className="button secondary">
          {copy.back}
        </Link>
      </div>
    </div>
  );
};

// ─── Step 3: File ────────────────────────────────────────────────────────────

type FileStepProps = {
  locale: Locale;
  period: VatPeriod;
  status: VatPeriodStatus;
  boxes: MomsBoxes;
  hasOrgNr: boolean;
  openBlockers: number;
  filed: { submittedAt: Date | null; boxes: MomsBoxes | null; locked: boolean } | null;
};

export const VatFileStep = ({ locale, period, status, boxes, hasOrgNr, openBlockers, filed }: FileStepProps) => {
  const sv = locale === "sv";
  const amount = money(Math.abs(boxes["49"]), locale);
  const deadline = formatVatDate(period.deadline, locale);
  const downloadHref = `/api/vat-return/xml?period=${encodeURIComponent(period.key)}`;
  const figuresChanged = filed?.boxes ? (Object.keys(boxes) as MomsBoxId[]).some((id) => filed.boxes![id] !== boxes[id]) : false;

  const copy = sv
    ? {
        heading: "3. Lämna in",
        intro:
          "Akunta skickar inte in deklarationen åt dig. Du laddar ner en fil här och laddar upp den hos Skatteverket. Det tar ett par minuter.",
        blockers: (n: number) =>
          `${n} saker i kontrollen är inte åtgärdade. Lämnar du in nu kan deklarationen bli fel och behöva rättas.`,
        toCheck: "Gå till kontrollen",
        step1: "Ladda ner filen",
        step1Text: "Filen innehåller ruta 05, 10, 11, 12, 48 och 49 för perioden.",
        download: "Ladda ner filen",
        noOrgNr: "Lägg till ditt personnummer i inställningarna, så kan du ladda ner filen.",
        settings: "Öppna inställningar",
        step2: "Logga in hos Skatteverket",
        step2Text: "Öppna e-tjänsten Lämna momsdeklaration och logga in med BankID.",
        openSkv: "Öppna Skatteverket",
        step3: "Välj Deklarera via fil och ladda upp filen",
        step3Text: "Välj filen du just laddade ner. Skatteverket fyller i rutorna åt dig.",
        step4: "Kontrollera beloppen",
        step4Text: (v: string) =>
          `Ruta 49 ska visa ${v}. Har du haft handel med utlandet, import eller omvänd moms lägger du till de rutorna nu under Rätta uppgifter manuellt.`,
        step5: "Skriv under och skicka in",
        step5Text: "Spara kvittensen du får.",
        step6Pay: `Betala ${amount} till ditt skattekonto`,
        step6PayText: `Pengarna ska vara bokförda på skattekontot senast ${deadline}. Betala ett par dagar innan.`,
        step6Refund: `Du får tillbaka ${amount}`,
        step6RefundText: "Beloppet sätts in på ditt skattekonto när Skatteverket har behandlat deklarationen.",
        step6Zero: "Inget att betala",
        step6ZeroText: "Deklarationen ska lämnas in ändå, även när beloppet är noll.",
        done: "När du har skickat in",
        doneText: "Markera perioden som inlämnad här, så håller Akunta reda på det åt dig.",
        filedHeading: "Inlämnad",
        filedOn: (d: string) => `Du markerade den här perioden som inlämnad ${d}.`,
        filedFigures: "Det här lämnade du in:",
        box: "Ruta",
        locked: "Perioden är låst. Inget mer kan bokföras i den.",
        notLocked: "Perioden är inte låst. Det som bokförs i den nu kommer inte med i det du har lämnat in.",
        changed:
          "Bokföringen för perioden har ändrats sedan du lämnade in. Siffrorna ovan stämmer inte längre med det du skickade. Du behöver lämna en rättad deklaration.",
        correct: "Behöver du rätta något? Lämna en ny, fullständig deklaration för samma period hos Skatteverket.",
        correctLink: "Så rättar du en momsdeklaration",
        downloadAgain: "Ladda ner filen igen",
        guide: "Skatteverkets beskrivning av inlämning via fil",
        back: "Tillbaka till granskningen"
      }
    : {
        heading: "3. File",
        intro:
          "Akunta does not submit the return for you. You download a file here and upload it at Skatteverket. It takes a couple of minutes.",
        blockers: (n: number) =>
          `${n} items in the check are not fixed. If you file now the return may be wrong and need correcting.`,
        toCheck: "Go to the check",
        step1: "Download the file",
        step1Text: "The file contains boxes 05, 10, 11, 12, 48 and 49 for the period.",
        download: "Download the file",
        noOrgNr: "Add your personnummer in settings and you can download the file.",
        settings: "Open settings",
        step2: "Log in at Skatteverket",
        step2Text: "Open the e-service Lämna momsdeklaration (file VAT return) and log in with BankID.",
        openSkv: "Open Skatteverket",
        step3: "Choose Deklarera via fil and upload the file",
        step3Text: "Pick the file you just downloaded. Skatteverket fills in the boxes for you.",
        step4: "Check the amounts",
        step4Text: (v: string) =>
          `Box 49 should show ${v}. If you had trade with other countries, imports or reverse charge, add those boxes now under Rätta uppgifter manuellt (correct manually).`,
        step5: "Sign and submit",
        step5Text: "Keep the receipt you get.",
        step6Pay: `Pay ${amount} to your tax account (skattekonto)`,
        step6PayText: `The money must be booked on the tax account by ${deadline}. Pay a couple of days before.`,
        step6Refund: `You get ${amount} back`,
        step6RefundText: "The amount is credited to your tax account once Skatteverket has processed the return.",
        step6Zero: "Nothing to pay",
        step6ZeroText: "The return must still be filed, also when the amount is zero.",
        done: "When you have submitted",
        doneText: "Mark the period as filed here and Akunta keeps track of it for you.",
        filedHeading: "Filed",
        filedOn: (d: string) => `You marked this period as filed on ${d}.`,
        filedFigures: "This is what you filed:",
        box: "Box",
        locked: "The period is locked. Nothing more can be booked into it.",
        notLocked: "The period is not locked. Anything booked into it now is not part of what you filed.",
        changed:
          "The books for the period have changed since you filed. The figures above no longer match what you sent. You need to file a corrected return.",
        correct: "Need to correct something? File a new, complete return for the same period at Skatteverket.",
        correctLink: "How to correct a VAT return",
        downloadAgain: "Download the file again",
        guide: "Skatteverket's description of filing by file",
        back: "Back to the review"
      };

  if (filed) {
    const shown = filed.boxes ?? boxes;
    return (
      <div className="stack" style={{ gap: 18 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 style={{ margin: 0 }}>{copy.heading}</h2>
          <p style={{ margin: 0 }}>
            <span className="badge good">{copy.filedHeading}</span>{" "}
            {filed.submittedAt ? copy.filedOn(formatVatDate(new Date(`${swedishToday(filed.submittedAt)}T00:00:00.000Z`), locale)) : ""}
          </p>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <p style={{ margin: 0 }}>{copy.filedFigures}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {BOX_ORDER.map((id) => (
              <li key={id}>
                {copy.box} {id}: {money(shown[id], locale)}
              </li>
            ))}
          </ul>
        </div>
        <p className="note">{filed.locked ? copy.locked : copy.notLocked}</p>
        {figuresChanged && <p className="error">{copy.changed}</p>}
        <p style={{ margin: 0, maxWidth: "80ch" }}>
          {copy.correct}{" "}
          <a href={SKV_LINKS.correct} target="_blank" rel="noreferrer" className="textLink">
            {copy.correctLink}
          </a>
        </p>
        {hasOrgNr && (
          <div className="row">
            <a href={downloadHref} className="button secondary" download>
              {copy.downloadAgain}
            </a>
          </div>
        )}
      </div>
    );
  }

  const payment =
    boxes["49"] > 0
      ? { title: copy.step6Pay, text: copy.step6PayText }
      : boxes["49"] < 0
        ? { title: copy.step6Refund, text: copy.step6RefundText }
        : { title: copy.step6Zero, text: copy.step6ZeroText };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h2 style={{ margin: 0 }}>{copy.heading}</h2>
        <p style={{ margin: 0, maxWidth: "80ch" }}>{copy.intro}</p>
      </div>

      {openBlockers > 0 && (
        <p style={{ margin: 0 }}>
          <span className="badge warn">!</span> {copy.blockers(openBlockers)}{" "}
          <Link href={vatHref(period.key, "check")} className="textLink">
            {copy.toCheck}
          </Link>
        </p>
      )}

      <ol className="stack" style={{ margin: 0, paddingLeft: 22, gap: 18 }}>
        <li>
          <div className="stack" style={{ gap: 6 }}>
            <strong>{copy.step1}</strong>
            <span>{copy.step1Text}</span>
            {hasOrgNr ? (
              <div className="row">
                <a href={downloadHref} className="button" download>
                  {copy.download}
                </a>
              </div>
            ) : (
              <span>
                {copy.noOrgNr}{" "}
                <Link href="/settings" className="textLink">
                  {copy.settings}
                </Link>
              </span>
            )}
          </div>
        </li>
        <li>
          <div className="stack" style={{ gap: 6 }}>
            <strong>{copy.step2}</strong>
            <span>{copy.step2Text}</span>
            <div className="row">
              <a href={SKV_LINKS.declare} target="_blank" rel="noreferrer" className="button secondary">
                {copy.openSkv}
              </a>
            </div>
          </div>
        </li>
        <li>
          <div className="stack" style={{ gap: 6 }}>
            <strong>{copy.step3}</strong>
            <span>{copy.step3Text}</span>
          </div>
        </li>
        <li>
          <div className="stack" style={{ gap: 6 }}>
            <strong>{copy.step4}</strong>
            <span>{copy.step4Text(money(boxes["49"], locale))}</span>
          </div>
        </li>
        <li>
          <div className="stack" style={{ gap: 6 }}>
            <strong>{copy.step5}</strong>
            <span>{copy.step5Text}</span>
          </div>
        </li>
        <li>
          <div className="stack" style={{ gap: 6 }}>
            <strong>{payment.title}</strong>
            <span>{payment.text}</span>
          </div>
        </li>
      </ol>

      <div className="stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>{copy.done}</h3>
        <p style={{ margin: 0 }}>{copy.doneText}</p>
        <VatFilingAction locale={locale} periodKey={period.key} enabled={status !== "upcoming"} />
      </div>

      <div className="row">
        <Link href={vatHref(period.key, "review")} className="button secondary">
          {copy.back}
        </Link>
        <a href={SKV_LINKS.fileGuide} target="_blank" rel="noreferrer" className="textLink">
          {copy.guide}
        </a>
      </div>
    </div>
  );
};
