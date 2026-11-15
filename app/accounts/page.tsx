export const dynamic = "force-dynamic";

import Link from "next/link";

import { resolveAccountYear } from "@/app/accounts/years";
import { AccountsBrowser } from "@/components/accounts/AccountsBrowser";
import { BAS_CLASS_NAMES, listAccountsWithBalances, type BasClass } from "@/lib/accounting/accounts";
import { ensureBusiness } from "@/lib/data/business";
import { getRequestLocale } from "@/lib/i18n/locale";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const locale = await getRequestLocale();
  const sv = locale === "sv";

  const copy = sv
    ? {
        title: "Kontoplan",
        subtitle:
          "Alla konton som firman bokför på, grupperade efter BAS-kontoplanens klasser. Varje konto visar sitt saldo för året. Klicka på ett konto för att se vad som har bokförts på det.",
        year: "År",
        show: "Visa",
        journal: "Bokför manuellt"
      }
    : {
        title: "Chart of accounts",
        subtitle:
          "Every account the business books on, grouped by the classes of the BAS chart. Each account shows its balance for the year. Click an account to see what has been booked on it.",
        year: "Year",
        show: "Show",
        journal: "Journal entry"
      };

  const business = await ensureBusiness();
  const { year, years } = await resolveAccountYear(business.id, first(params.year));
  const accounts = await listAccountsWithBalances(business.id, year);

  const classes = (Object.keys(BAS_CLASS_NAMES) as BasClass[]).map((id) => ({
    id,
    name: sv ? BAS_CLASS_NAMES[id].sv : BAS_CLASS_NAMES[id].en,
    hint: sv ? BAS_CLASS_NAMES[id].svHint : BAS_CLASS_NAMES[id].enHint
  }));

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>

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
        <Link className="button tertiary" href="/journal" style={{ marginLeft: "auto" }}>
          {copy.journal}
        </Link>
      </form>

      <AccountsBrowser
        key={year}
        locale={locale}
        year={year}
        classes={classes}
        accounts={accounts.map((account) => ({
          id: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          isActive: account.isActive,
          isProtected: account.isProtected,
          entryCount: account.entryCount,
          balance: account.balance
        }))}
      />
    </section>
  );
}
