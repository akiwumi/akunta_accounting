"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { formatMoney } from "@/lib/data/format";
import { type Locale } from "@/lib/i18n/locale";

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  isProtected: boolean;
  entryCount: number;
  balance: number;
};

export type AccountClass = { id: string; name: string; hint: string };

type AccountsBrowserProps = {
  locale: Locale;
  year: number;
  accounts: AccountRow[];
  classes: AccountClass[];
};

const TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

/** Mirrors suggestAccountType in lib/accounting/accounts.ts. */
const suggestType = (code: string): (typeof TYPES)[number] | null => {
  if (!/^[1-8]\d{3}$/.test(code)) return null;
  const n = Number(code);
  if (n < 2000) return "ASSET";
  if (n < 2100) return "EQUITY";
  if (n >= 2640 && n <= 2649) return "ASSET";
  if (n < 3000) return "LIABILITY";
  if (n < 4000) return "INCOME";
  if (n < 8000) return "EXPENSE";
  if (n < 8400) return "INCOME";
  return "EXPENSE";
};

export const AccountsBrowser = ({ locale, year, accounts, classes }: AccountsBrowserProps) => {
  const router = useRouter();
  const sv = locale === "sv";
  const money = (value: number) => formatMoney(value, "SEK", sv ? "sv-SE" : "en-GB");

  const copy = sv
    ? {
        search: "Sök konto",
        searchPlaceholder: "Nummer eller namn",
        showInactive: (n: number) => `Visa inaktiva konton (${n})`,
        onlyUsed: "Bara konton med saldo",
        add: "Lägg till konto",
        addTitle: "Nytt konto",
        addHelp:
          "Kontonumret följer BAS-kontoplanen: fyra siffror, där den första siffran avgör vilken grupp kontot hör till. Välj ett nummer nära liknande konton.",
        number: "Kontonummer",
        name: "Namn",
        type: "Typ",
        typeHelp: "Föreslås utifrån kontonumret.",
        landsIn: (group: string) => `Hamnar under: ${group}`,
        types: { ASSET: "Tillgång", LIABILITY: "Skuld", EQUITY: "Eget kapital", INCOME: "Intäkt", EXPENSE: "Kostnad" },
        save: "Lägg till",
        saving: "Sparar...",
        cancel: "Avbryt",
        invalidCode: "Kontonumret ska vara fyra siffror och börja på 1 till 8.",
        duplicate: (label: string) => `Kontot finns redan: ${label}.`,
        duplicateInactive: (label: string) => `Kontot finns redan men är inaktivt: ${label}. Aktivera det i stället.`,
        nameRequired: "Ge kontot ett namn.",
        added: (label: string) => `Konto ${label} är tillagt.`,
        account: "Konto",
        balanceEnd: `Saldo 31 dec ${year}`,
        balanceYear: `Summa ${year}`,
        actions: "Åtgärder",
        rename: "Byt namn",
        renameSave: "Spara",
        deactivate: "Inaktivera",
        reactivate: "Aktivera",
        inactive: "Inaktivt",
        protectedHelp:
          "Akunta bokför på det här kontot när du lägger in kvitton, fakturor, löner eller guidade händelser. Därför kan det inte inaktiveras.",
        deactivateHelp: "Kontot försvinner ur listorna där du väljer konto, men finns kvar i huvudbok och rapporter.",
        entries: (n: number) => (n === 1 ? "1 bokförd rad" : `${n} bokförda rader`),
        noEntries: "Inga bokförda rader",
        none: "Inga konton matchar sökningen.",
        failed: "Det gick inte att spara. Försök igen.",
        protectedError: "Kontot används av Akunta och kan inte inaktiveras."
      }
    : {
        search: "Search accounts",
        searchPlaceholder: "Number or name",
        showInactive: (n: number) => `Show inactive accounts (${n})`,
        onlyUsed: "Only accounts with a balance",
        add: "Add account",
        addTitle: "New account",
        addHelp:
          "The account number follows the BAS chart: four digits, where the first digit decides which group the account belongs to. Choose a number close to similar accounts.",
        number: "Account number",
        name: "Name",
        type: "Type",
        typeHelp: "Suggested from the account number.",
        landsIn: (group: string) => `Goes under: ${group}`,
        types: { ASSET: "Asset", LIABILITY: "Liability", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Cost" },
        save: "Add",
        saving: "Saving...",
        cancel: "Cancel",
        invalidCode: "The account number must be four digits and start with 1 to 8.",
        duplicate: (label: string) => `The account already exists: ${label}.`,
        duplicateInactive: (label: string) => `The account already exists but is inactive: ${label}. Reactivate it instead.`,
        nameRequired: "Give the account a name.",
        added: (label: string) => `Account ${label} has been added.`,
        account: "Account",
        balanceEnd: `Balance 31 Dec ${year}`,
        balanceYear: `Total ${year}`,
        actions: "Actions",
        rename: "Rename",
        renameSave: "Save",
        deactivate: "Deactivate",
        reactivate: "Reactivate",
        inactive: "Inactive",
        protectedHelp:
          "Akunta books on this account when you enter receipts, invoices, salaries or guided entries. That is why it cannot be deactivated.",
        deactivateHelp: "The account disappears from the lists where you pick an account, but stays in the ledger and in reports.",
        entries: (n: number) => (n === 1 ? "1 booked line" : `${n} booked lines`),
        noEntries: "No booked lines",
        none: "No accounts match the search.",
        failed: "Could not save. Please try again.",
        protectedError: "The account is used by Akunta and cannot be deactivated."
      };

  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const inactiveCount = accounts.filter((account) => !account.isActive).length;
  const needle = query.trim().toLowerCase();
  const visible = accounts.filter((account) => {
    if (!showInactive && !account.isActive) return false;
    if (onlyUsed && account.balance === 0) return false;
    if (!needle) return true;
    return account.code.startsWith(needle) || account.name.toLowerCase().includes(needle);
  });

  const trimmedCode = code.trim();
  const suggested = suggestType(trimmedCode);
  const existing = accounts.find((account) => account.code === trimmedCode) ?? null;
  const codeProblem =
    trimmedCode === ""
      ? null
      : !suggested
        ? copy.invalidCode
        : existing
          ? (existing.isActive ? copy.duplicate : copy.duplicateInactive)(`${existing.code} ${existing.name}`)
          : null;
  const landsIn = suggested ? classes.find((group) => group.id === trimmedCode[0])?.name : null;
  const canAdd = Boolean(suggested) && !existing && name.trim().length >= 2 && busy === null;

  const request = async (url: string, method: "POST" | "PATCH", body: unknown) => {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    if (!response.ok) {
      if (sv && json.code === "PROTECTED") throw new Error(copy.protectedError);
      if (sv && json.code === "INVALID_CODE") throw new Error(copy.invalidCode);
      if (sv && json.code === "INVALID_NAME") throw new Error(copy.nameRequired);
      if (sv && json.code === "DUPLICATE") throw new Error(copy.duplicate(trimmedCode));
      throw new Error((!sv && json.error) || copy.failed);
    }
  };

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.failed);
    } finally {
      setBusy(null);
    }
  };

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!canAdd) return;
    void run("add", async () => {
      await request("/api/accounts", "POST", { code: trimmedCode, name: name.trim(), type: type ?? suggested });
      setNotice(copy.added(`${trimmedCode} ${name.trim()}`));
      setCode("");
      setName("");
      setType(null);
      setAdding(false);
    });
  };

  const onRename = (event: FormEvent) => {
    event.preventDefault();
    if (!renaming || renaming.name.trim().length < 2) return;
    const target = renaming;
    void run(`rename-${target.id}`, async () => {
      await request(`/api/accounts/${target.id}`, "PATCH", { name: target.name.trim() });
      setRenaming(null);
    });
  };

  const onToggle = (account: AccountRow) =>
    void run(`toggle-${account.id}`, () => request(`/api/accounts/${account.id}`, "PATCH", { isActive: !account.isActive }));

  const numeric = { textAlign: "right" as const, whiteSpace: "nowrap" as const, fontVariantNumeric: "tabular-nums" as const };

  return (
    <div className="stack" style={{ gap: 22 }}>
      <article className="card stack" style={{ padding: 20 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="stack" style={{ flex: "2 1 260px", maxWidth: 420 }}>
            {copy.search}
            <input
              type="search"
              value={query}
              placeholder={copy.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="row" style={{ flexWrap: "nowrap" }}>
            <input type="checkbox" checked={onlyUsed} onChange={(event) => setOnlyUsed(event.target.checked)} />
            <span>{copy.onlyUsed}</span>
          </label>
          {inactiveCount > 0 ? (
            <label className="row" style={{ flexWrap: "nowrap" }}>
              <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
              <span>{copy.showInactive(inactiveCount)}</span>
            </label>
          ) : null}
          <div style={{ marginLeft: "auto" }}>
            <button type="button" className={adding ? "secondary" : undefined} aria-expanded={adding} onClick={() => setAdding(!adding)}>
              {adding ? copy.cancel : copy.add}
            </button>
          </div>
        </div>

        {adding ? (
          <form className="stack" onSubmit={onAdd} style={{ padding: 16, borderRadius: 12, background: "var(--surface-container-low)" }}>
            <div className="stack" style={{ gap: 4 }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{copy.addTitle}</h2>
              <p className="note" style={{ maxWidth: "76ch" }}>{copy.addHelp}</p>
            </div>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label className="stack" style={{ flex: "0 1 160px" }}>
                {copy.number}
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  value={code}
                  aria-invalid={codeProblem !== null}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, ""));
                    setType(null);
                  }}
                  required
                />
              </label>
              <label className="stack" style={{ flex: "2 1 280px" }}>
                {copy.name}
                <input type="text" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
              <label className="stack" style={{ flex: "1 1 180px", maxWidth: 240 }}>
                {copy.type}
                <select value={type ?? suggested ?? ""} disabled={!suggested} onChange={(event) => setType(event.target.value)}>
                  {!suggested ? <option value="" /> : null}
                  {TYPES.map((value) => (
                    <option key={value} value={value}>
                      {copy.types[value]}
                    </option>
                  ))}
                </select>
                <span className="note">{copy.typeHelp}</span>
              </label>
            </div>
            {codeProblem ? <p className="error" role="alert">{codeProblem}</p> : landsIn ? <p className="note">{copy.landsIn(landsIn)}</p> : null}
            <div className="row">
              <button type="submit" disabled={!canAdd}>
                {busy === "add" ? copy.saving : copy.save}
              </button>
            </div>
          </form>
        ) : null}

        {error ? <p className="error" role="alert">{error}</p> : null}
        {notice ? <p className="success" role="status">{notice}</p> : null}
      </article>

      {visible.length === 0 ? <p className="note">{copy.none}</p> : null}

      {classes.map((group) => {
        const rows = visible.filter((account) => account.code.startsWith(group.id));
        if (rows.length === 0) return null;
        const balanceSheet = group.id === "1" || group.id === "2";
        return (
          <section className="stack" key={group.id} aria-labelledby={`account-class-${group.id}`} style={{ gap: 10 }}>
            <div className="stack" style={{ gap: 2 }}>
              <h2 id={`account-class-${group.id}`} style={{ margin: 0 }}>
                <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{group.id}</span> {group.name}
              </h2>
              <p className="note">{group.hint}</p>
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: "50%" }}>{copy.account}</th>
                    <th scope="col">{copy.type}</th>
                    <th scope="col" style={{ textAlign: "right" }}>{balanceSheet ? copy.balanceEnd : copy.balanceYear}</th>
                    <th scope="col" style={{ textAlign: "right" }}>{copy.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((account) => (
                    <tr key={account.id} style={account.isActive ? undefined : { opacity: 0.6 }}>
                      <td>
                        {renaming?.id === account.id ? (
                          <form className="row" onSubmit={onRename} style={{ flexWrap: "nowrap" }}>
                            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 620 }}>{account.code}</span>
                            <input
                              type="text"
                              aria-label={`${copy.rename} ${account.code}`}
                              maxLength={120}
                              value={renaming.name}
                              autoFocus
                              style={{ flex: 1, minWidth: 0 }}
                              onChange={(event) => setRenaming({ id: account.id, name: event.target.value })}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") setRenaming(null);
                              }}
                            />
                            <button type="submit" disabled={busy !== null || renaming.name.trim().length < 2}>
                              {copy.renameSave}
                            </button>
                            <button type="button" className="tertiary" onClick={() => setRenaming(null)}>
                              {copy.cancel}
                            </button>
                          </form>
                        ) : (
                          <>
                            <Link className="textLink" href={`/accounts/${account.id}?year=${year}`}>
                              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 620 }}>{account.code}</span> {account.name}
                            </Link>
                            {!account.isActive ? (
                              <>
                                {" "}
                                <span className="badge warn">{copy.inactive}</span>
                              </>
                            ) : null}
                            <span className="note" style={{ display: "block" }}>
                              {account.entryCount > 0 ? copy.entries(account.entryCount) : copy.noEntries}
                            </span>
                          </>
                        )}
                      </td>
                      <td>{copy.types[account.type as keyof typeof copy.types] ?? account.type}</td>
                      <td style={numeric}>{money(account.balance)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          className="tertiary"
                          disabled={busy !== null}
                          onClick={() => setRenaming({ id: account.id, name: account.name })}
                        >
                          {copy.rename}
                        </button>{" "}
                        {account.isActive ? (
                          <button
                            type="button"
                            className="tertiary"
                            disabled={busy !== null || account.isProtected}
                            title={account.isProtected ? copy.protectedHelp : copy.deactivateHelp}
                            onClick={() => onToggle(account)}
                          >
                            {copy.deactivate}
                          </button>
                        ) : (
                          <button type="button" className="tertiary" disabled={busy !== null} onClick={() => onToggle(account)}>
                            {copy.reactivate}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
};
