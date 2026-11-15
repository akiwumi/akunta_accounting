export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";

import { resolveAccountYear } from "@/app/accounts/years";
import { BAS_CLASS_NAMES, basClassOf, getAccountLedger } from "@/lib/accounting/accounts";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { getRequestLocale } from "@/lib/i18n/locale";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AccountPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const locale = await getRequestLocale();
  const sv = locale === "sv";
  const money = (value: number) => formatMoney(value, "SEK", sv ? "sv-SE" : "en-GB");

  const copy = sv
    ? {
        back: "Till kontoplanen",
        year: "År",
        show: "Visa",
        inactive: "Inaktivt",
        opening: "Ingående saldo",
        openingHelp: "Det kontot hade med sig in i året.",
        closing: "Utgående saldo",
        change: "Förändring under året",
        yearTotal: "Summa för året",
        resultHelp: "Intäkter och kostnader börjar varje år på noll.",
        date: "Datum",
        verification: "Ver.",
        text: "Text",
        debit: "Debet",
        credit: "Kredit",
        balance: "Saldo",
        none: "Inget är bokfört på kontot det här året.",
        cancelled: "Makulerad",
        correction: "Rättelse",
        debitNormal: "På det här kontot ökar saldot i debet och minskar i kredit.",
        creditNormal: "På det här kontot ökar saldot i kredit och minskar i debet.",
        sum: "Summa"
      }
    : {
        back: "Back to the chart of accounts",
        year: "Year",
        show: "Show",
        inactive: "Inactive",
        opening: "Opening balance",
        openingHelp: "What the account carried into the year.",
        closing: "Closing balance",
        change: "Change during the year",
        yearTotal: "Total for the year",
        resultHelp: "Income and costs start every year at zero.",
        date: "Date",
        verification: "Ver.",
        text: "Text",
        debit: "Debit",
        credit: "Credit",
        balance: "Balance",
        none: "Nothing is booked on the account this year.",
        cancelled: "Cancelled",
        correction: "Correction",
        debitNormal: "On this account the balance goes up with a debit and down with a credit.",
        creditNormal: "On this account the balance goes up with a credit and down with a debit.",
        sum: "Total"
      };

  const business = await ensureBusiness();
  const { year, years } = await resolveAccountYear(business.id, first(query.year));
  const ledger = await getAccountLedger(business.id, id, year);
  if (!ledger) notFound();

  const { account } = ledger;
  const basClass = basClassOf(account.code);
  const groupName = basClass ? (sv ? BAS_CLASS_NAMES[basClass].sv : BAS_CLASS_NAMES[basClass].en) : null;
  const isResult = account.type === "INCOME" || account.type === "EXPENSE";
  const numeric = { textAlign: "right" as const, whiteSpace: "nowrap" as const, fontVariantNumeric: "tabular-nums" as const };

  return (
    <section className="page">
      <p style={{ margin: 0 }}>
        <Link className="textLink" href={`/accounts?year=${year}`}>
          ← {copy.back}
        </Link>
      </p>
      <h1 className="title">
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{account.code}</span> {account.name}
      </h1>
      <p className="subtitle">
        {groupName ? `${groupName}. ` : ""}
        {ledger.debitNormal ? copy.debitNormal : copy.creditNormal}{" "}
        {!account.isActive ? <span className="badge warn">{copy.inactive}</span> : null}
      </p>

      <form className="row" method="get" style={{ alignItems: "flex-end" }}>
        <label className="stack" style={{ flex: "0 1 160px" }}>
          {copy.year}
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
      </form>

      <div className="grid">
        {!isResult ? (
          <article className="card">
            <p className="label">{copy.opening}</p>
            <p className="kpi">{money(ledger.opening)}</p>
            <p className="note">{copy.openingHelp}</p>
          </article>
        ) : null}
        <article className="card">
          <p className="label">{isResult ? copy.yearTotal : copy.change}</p>
          <p className="kpi">{money(Math.round((ledger.closing - ledger.opening) * 100) / 100)}</p>
          {isResult ? <p className="note">{copy.resultHelp}</p> : null}
        </article>
        {!isResult ? (
          <article className="card">
            <p className="label">{copy.closing}</p>
            <p className="kpi">{money(ledger.closing)}</p>
          </article>
        ) : null}
      </div>

      {ledger.rows.length === 0 ? (
        <p className="note">{copy.none}</p>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{copy.date}</th>
                <th scope="col">{copy.verification}</th>
                <th scope="col" style={{ width: "40%" }}>{copy.text}</th>
                <th scope="col" style={{ textAlign: "right" }}>{copy.debit}</th>
                <th scope="col" style={{ textAlign: "right" }}>{copy.credit}</th>
                <th scope="col" style={{ textAlign: "right" }}>{copy.balance}</th>
              </tr>
            </thead>
            <tbody>
              {!isResult ? (
                <tr>
                  <td style={{ whiteSpace: "nowrap" }}>{year}-01-01</td>
                  <td />
                  <td>{copy.opening}</td>
                  <td />
                  <td />
                  <td style={numeric}>{money(ledger.opening)}</td>
                </tr>
              ) : null}
              {ledger.rows.map((row, index) => (
                <tr key={`${row.transactionId}-${index}`}>
                  <td style={{ whiteSpace: "nowrap" }}>{row.txnDate.toISOString().slice(0, 10)}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{row.verificationNumber}</td>
                  <td>
                    <Link className="textLink" href={`/review/transactions/${row.transactionId}`}>
                      {row.description}
                    </Link>
                    {row.status === "CANCELLED" ? (
                      <>
                        {" "}
                        <span className="badge warn">{copy.cancelled}</span>
                      </>
                    ) : row.status === "CORRECTION" ? (
                      <>
                        {" "}
                        <span className="badge">{copy.correction}</span>
                      </>
                    ) : null}
                  </td>
                  <td style={numeric}>{row.debit > 0 ? money(row.debit) : ""}</td>
                  <td style={numeric}>{row.credit > 0 ? money(row.credit) : ""}</td>
                  <td style={numeric}>{money(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>{copy.sum}</th>
                <th style={numeric}>{money(ledger.totalDebit)}</th>
                <th style={numeric}>{money(ledger.totalCredit)}</th>
                <th style={numeric}>{money(ledger.closing)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
