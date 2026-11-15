export const dynamic = "force-dynamic";

import Link from "next/link";

import { JournalWorkspace } from "@/components/journal/JournalWorkspace";
import { listRecentJournalEntries } from "@/lib/accounting/journal";
import { asNumber } from "@/lib/accounting/math";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { listVatPeriods, swedishToday, vatPeriodOptionsFor } from "@/lib/tax/vat-periods";

export default async function JournalPage() {
  const locale = await getRequestLocale();
  const sv = locale === "sv";
  const money = (value: number) => formatMoney(value, "SEK", sv ? "sv-SE" : "en-GB");

  const copy = sv
    ? {
        title: "Bokför manuellt",
        subtitle:
          "För det som inte är ett kvitto, en betalning eller en faktura: egna uttag och insättningar, lån, räntor, moms till Skatteverket och bokslutsposter. Välj vad som har hänt, så sköter Akunta kontona och visar vad som bokförs innan du sparar.",
        recent: "Senast bokfört här",
        recentHelp: "De senaste manuella posterna. De ligger i huvudboken som alla andra verifikationer och makuleras därifrån.",
        none: "Du har inte bokfört något manuellt ännu.",
        verification: "Ver.",
        date: "Datum",
        text: "Text",
        accounts: "Konton",
        amount: "Belopp",
        cancelled: "Makulerad",
        ledger: "Öppna huvudboken",
        chart: "Visa kontoplanen"
      }
    : {
        title: "Journal entry",
        subtitle:
          "For what is not a receipt, a payment or an invoice: owner withdrawals and deposits, loans, interest, VAT paid to Skatteverket and year-end entries. Choose what happened and Akunta handles the accounts and shows what will be booked before you save.",
        recent: "Recently booked here",
        recentHelp: "The latest manual entries. They are in the ledger like every other verification and are cancelled from there.",
        none: "You have not booked anything manually yet.",
        verification: "Ver.",
        date: "Date",
        text: "Text",
        accounts: "Accounts",
        amount: "Amount",
        cancelled: "Cancelled",
        ledger: "Open the ledger",
        chart: "Show the chart of accounts"
      };

  const business = await ensureBusiness();
  const [accounts, recent] = await Promise.all([
    prisma.account.findMany({
      where: { businessId: business.id, isActive: true },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" }
    }),
    listRecentJournalEntries(business.id, 10)
  ]);

  const today = swedishToday();
  const currentYear = Number(today.slice(0, 4));
  // Year-end entries are usually made early in the following year.
  const defaultYear = Number(today.slice(5, 7)) <= 6 ? currentYear - 1 : currentYear;
  const years = [currentYear, currentYear - 1, currentYear - 2];

  // The VAT period that most recently ended is the one a payment is most likely for.
  const endedPeriods = listVatPeriods(vatPeriodOptionsFor(business)).filter(
    (period) => period.end.toISOString().slice(0, 10) < today
  );
  const defaultVatPeriodEnd =
    endedPeriods[endedPeriods.length - 1]?.end.toISOString().slice(0, 10) ?? `${currentYear - 1}-12-31`;

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>

      <JournalWorkspace
        locale={locale}
        accounts={accounts}
        today={today}
        defaultYear={defaultYear}
        years={years}
        defaultVatPeriodEnd={defaultVatPeriodEnd}
        cashMethod={business.bookkeepingMethod === "kontantmetoden"}
      />

      <article className="card stack" id="recent-entries" style={{ padding: 24 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 style={{ margin: 0 }}>{copy.recent}</h2>
          <p className="note" style={{ maxWidth: "76ch" }}>{copy.recentHelp}</p>
        </div>
        {recent.length === 0 ? (
          <p className="note">{copy.none}</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{copy.verification}</th>
                  <th scope="col">{copy.date}</th>
                  <th scope="col">{copy.text}</th>
                  <th scope="col">{copy.accounts}</th>
                  <th scope="col" style={{ textAlign: "right" }}>{copy.amount}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 620 }}>{entry.verificationNumber}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{entry.txnDate.toISOString().slice(0, 10)}</td>
                    <td>
                      <Link className="textLink" href={`/review/transactions/${entry.id}`}>
                        {entry.description}
                      </Link>
                      {entry.voidedAt ? (
                        <>
                          {" "}
                          <span className="badge warn">{copy.cancelled}</span>
                        </>
                      ) : null}
                    </td>
                    <td className="note">
                      {[...new Set(entry.lines.map((line) => line.account.code))].sort().join(", ")}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {money(
                        entry.lines.reduce((sum, line) => sum + asNumber(line.debit), 0)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row">
          <Link className="button secondary" href="/ledger?source=JOURNAL">
            {copy.ledger}
          </Link>
          <Link className="button tertiary" href="/accounts">
            {copy.chart}
          </Link>
        </div>
      </article>
    </section>
  );
}
