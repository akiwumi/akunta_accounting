/**
 * Import of SIE type 4 files: the way a user moves their books into Akunta
 * from another program.
 *
 * Two steps share one plan:
 *   previewSieImport  reads the file and the database and says exactly what
 *                     would happen. It writes nothing.
 *   executeSieImport  builds the same plan again inside one database
 *                     transaction and, if the plan has no errors, writes it.
 *                     Either everything is written or nothing is.
 *
 * What is written:
 *   - accounts the file uses that Akunta lacks (type from #KTYP, else from
 *     the BAS account number);
 *   - #IB of the file's own year (year 0) as OpeningBalance rows;
 *   - every #VER as a Transaction with JournalLine rows.
 *
 * LIMITATION, by design: an imported verification is an arbitrary multi-line
 * entry, so Akunta cannot tell which part of it is a sale, a purchase or VAT.
 * It is stored with direction TRANSFER, grossAmount = netAmount = total debit,
 * vatAmount 0 and vatRate 0. Reports built from journal lines (profit and
 * loss, balance sheet, ledger) show imported history correctly. Figures built
 * from the transaction fields (the VAT report, dashboard totals by direction)
 * do not include it. VAT periods that fall inside imported history must be
 * reported from the program the file came from.
 *
 * Ledger rules (lib/accounting/ledger.ts and the *_ledger_hardening
 * migration): verification numbers are assigned by the database, so imported
 * verifications get new Akunta numbers in file order and keep their original
 * series and number in `reference`; nothing is booked into a locked period
 * (checked here before anything is written, and again by the database);
 * every verification must balance (checked here, and again at commit).
 */

import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { writeLedgerAudit } from "@/lib/accounting/ledger";
import { EntrySources, TransactionDirections, type AccountType } from "@/lib/domain/enums";
import { accountTypeFromSie, flipForAccountType, isBalanceSheetType } from "@/lib/sie/accountTypes";
import { decodeSieBytes, type SieEncoding } from "@/lib/sie/cp437";
import { describeSieIssue, sieIsoDate, sieMessage, sieMoney, type SieLocale } from "@/lib/sie/messages";
import { formatSieAmount, parseSie, parseSieAmount, sieDateToUtc, type SieVoucher } from "@/lib/sie/parse";

type Db = Prisma.TransactionClient;

export const SIE_MAX_BYTES = 20 * 1024 * 1024;
export const SIE_AUDIT_ENTITY = "SieImport";

export type SieImportPreview = {
  canImport: boolean;
  encoding: SieEncoding;
  companyName: string | null;
  orgNumber: string | null;
  program: string | null;
  /** ISO dates. Index 0 is the year the file covers, -1 the year before. */
  fiscalYears: Array<{ index: number; start: string; end: string }>;
  accountsInFile: number;
  vouchersInFile: number;
  vouchersToImport: number;
  rowsToImport: number;
  /** True when every verification in the file has equal debit and credit. */
  allBalanced: boolean;
  /** Sum of all debit amounts to be booked, as "1234.50". */
  totalDebit: string;
  firstDate: string | null;
  lastDate: string | null;
  openingBalancesToImport: number;
  accountsToCreate: Array<{ code: string; name: string; type: AccountType }>;
  /** Accounts whose closing balance in the file was compared with opening balance plus verifications. */
  closingCheck: { checked: number; mismatches: number } | null;
  errors: string[];
  warnings: string[];
  skipped: string[];
  contentHash: string;
};

export type SieImportResult = {
  preview: SieImportPreview;
  vouchersImported: number;
  accountsCreated: number;
  openingBalancesImported: number;
  firstVerificationNumber: number | null;
  lastVerificationNumber: number | null;
};

type PlannedVoucher = {
  date: Date;
  description: string;
  reference: string;
  totalDebitOre: number;
  lines: Array<{ code: string; debitOre: number; creditOre: number; note: string | null }>;
};

type SieImportPlan = {
  preview: SieImportPreview;
  vouchers: PlannedVoucher[];
  /** Amounts with Akunta's natural sign. */
  openingBalances: Array<{ code: string; amountOre: number }>;
  openingYear: number | null;
  currency: string;
};

/** Thrown by executeSieImport when the plan has errors. Nothing has been written. */
export class SieImportError extends Error {
  constructor(public readonly preview: SieImportPreview) {
    super(preview.errors[0] ?? "The SIE file could not be imported.");
    this.name = "SieImportError";
  }
}

const voucherLabel = (voucher: SieVoucher): string => `${voucher.series} ${voucher.number}`.trim() || "(#)";

const examples = (items: string[]): string => items.slice(0, 3).join(", ");

const decimalToOre = (value: Prisma.Decimal): number => parseSieAmount(new Prisma.Decimal(value).toFixed(2)) ?? 0;

const buildPlan = async (
  db: Db,
  params: { businessId: string; bytes: Uint8Array; locale: SieLocale }
): Promise<SieImportPlan> => {
  const { businessId, bytes, locale } = params;
  const say = (code: Parameters<typeof sieMessage>[1], args: Record<string, string | number> = {}) =>
    sieMessage(locale, code, args);

  const errors: string[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];

  const preview: SieImportPreview = {
    canImport: false,
    encoding: "cp437",
    companyName: null,
    orgNumber: null,
    program: null,
    fiscalYears: [],
    accountsInFile: 0,
    vouchersInFile: 0,
    vouchersToImport: 0,
    rowsToImport: 0,
    allBalanced: true,
    totalDebit: "0.00",
    firstDate: null,
    lastDate: null,
    openingBalancesToImport: 0,
    accountsToCreate: [],
    closingCheck: null,
    errors,
    warnings,
    skipped,
    contentHash: ""
  };
  const plan: SieImportPlan = { preview, vouchers: [], openingBalances: [], openingYear: null, currency: "SEK" };
  const stop = (message: string): SieImportPlan => {
    errors.push(message);
    return plan;
  };

  if (bytes.length === 0) return stop(say("EMPTY_FILE"));
  if (bytes.length > SIE_MAX_BYTES) return stop(say("TOO_LARGE", { limit: SIE_MAX_BYTES / (1024 * 1024) }));

  const { text, encoding } = decodeSieBytes(bytes);
  const doc = parseSie(text);
  preview.encoding = encoding;
  preview.companyName = doc.companyName;
  preview.orgNumber = doc.orgNumber;
  preview.program = [doc.program, doc.programVersion].filter(Boolean).join(" ") || null;
  preview.fiscalYears = doc.fiscalYears.map((year) => ({
    index: year.index,
    start: sieIsoDate(year.start),
    end: sieIsoDate(year.end)
  }));
  preview.accountsInFile = doc.accounts.size;
  preview.vouchersInFile = doc.vouchers.length;

  for (const issue of doc.issues) {
    (issue.severity === "error" ? errors : warnings).push(describeSieIssue(locale, issue));
  }
  if (doc.issues.some((issue) => issue.code === "NOT_SIE")) return plan;

  // ── Identity of the content ─────────────────────────────────────────────
  // The hash covers what would be booked, not the bytes, so the same books
  // exported twice (a new #GEN date, another encoding) are still recognised.
  const year0 = doc.fiscalYears.find((year) => year.index === 0) ?? null;
  const opening0 = doc.openingBalances.filter((row) => row.yearIndex === 0 && row.amountOre !== 0);
  preview.contentHash = createHash("sha256")
    .update(
      JSON.stringify({
        year: year0 ? [year0.start, year0.end] : null,
        opening: opening0.map((row) => [row.account, row.amountOre]),
        vouchers: doc.vouchers.map((voucher) => [
          voucher.series,
          voucher.number,
          voucher.date,
          voucher.lines.map((line) => [line.account, line.amountOre])
        ])
      })
    )
    .digest("hex");

  const earlier = await db.auditLog.findFirst({
    where: { businessId, entityType: SIE_AUDIT_ENTITY, entityId: preview.contentHash },
    orderBy: { createdAt: "asc" }
  });
  if (earlier) {
    // Nothing else matters: say the one thing and stop.
    errors.length = 0;
    warnings.length = 0;
    return stop(say("ALREADY_IMPORTED", { date: earlier.createdAt.toISOString().slice(0, 10) }));
  }

  // ── File-level checks ───────────────────────────────────────────────────
  if (doc.vouchers.length === 0 && doc.sieType !== 4) {
    // No #SIETYP means type 1 (specification, #SIETYP).
    return stop(say("NOT_TYPE4", { type: doc.sieType ?? 1 }));
  }

  const business = await db.business.findUnique({ where: { id: businessId }, select: { baseCurrency: true } });
  const baseCurrency = (business?.baseCurrency || "SEK").toUpperCase();
  // No #VALUTA means SEK (specification, #VALUTA).
  const fileCurrency = doc.currency ?? "SEK";
  plan.currency = baseCurrency;
  if (fileCurrency !== baseCurrency) errors.push(say("CURRENCY", { currency: fileCurrency, base: baseCurrency }));

  if (doc.flag === 1) warnings.push(say("FLAG_SET"));

  // ── Verifications ───────────────────────────────────────────────────────
  type Candidate = { voucher: SieVoucher; reference: string | null; planned: PlannedVoucher };
  const candidates: Candidate[] = [];
  let emptyVouchers = 0;
  let rowsWithObjects = 0;
  let rowsWithOwnDate = 0;
  const outsideYear: SieVoucher[] = [];

  for (const voucher of doc.vouchers) {
    const rows = voucher.lines.filter((line) => line.amountOre !== 0);
    rowsWithObjects += rows.filter((line) => line.hasObjects).length;
    rowsWithOwnDate += rows.filter((line) => line.date !== undefined && line.date !== voucher.date).length;

    const debit = rows.reduce((sum, line) => sum + (line.amountOre > 0 ? line.amountOre : 0), 0);
    const credit = rows.reduce((sum, line) => sum + (line.amountOre < 0 ? -line.amountOre : 0), 0);
    if (debit !== credit) {
      preview.allBalanced = false;
      if (errors.length < 25) {
        errors.push(
          say("UNBALANCED", {
            line: voucher.line,
            voucher: voucherLabel(voucher),
            date: sieIsoDate(voucher.date),
            debit: sieMoney(locale, debit),
            credit: sieMoney(locale, credit),
            difference: sieMoney(locale, Math.abs(debit - credit))
          })
        );
      }
      continue;
    }
    if (rows.length === 0) {
      emptyVouchers += 1;
      continue;
    }
    if (year0 && (voucher.date < year0.start || voucher.date > year0.end)) outsideYear.push(voucher);

    const label = voucherLabel(voucher);
    const fallbackText = rows.find((line) => line.text)?.text ?? `SIE ${label}`;
    candidates.push({
      voucher,
      // Series, number and date identify a verification in the program it
      // came from. Unnumbered ones (allowed in SIE 4I files) have no identity.
      reference: voucher.number !== "" ? `SIE:${voucher.series}:${voucher.number}:${voucher.date}` : null,
      planned: {
        date: sieDateToUtc(voucher.date),
        description: (voucher.text || fallbackText).slice(0, 200),
        reference: voucher.number !== "" ? `SIE:${voucher.series}:${voucher.number}:${voucher.date}` : `SIE:${voucher.date}`,
        totalDebitOre: debit,
        lines: rows.map((line) => ({
          code: line.account,
          debitOre: line.amountOre > 0 ? line.amountOre : 0,
          creditOre: line.amountOre < 0 ? -line.amountOre : 0,
          note: line.text ? line.text.slice(0, 500) : null
        }))
      }
    });
  }

  // Verifications that an earlier, different file already brought in (for
  // example January to June, when this file is January to December).
  const references = candidates.map((candidate) => candidate.reference).filter((ref): ref is string => ref !== null);
  const alreadyImported = new Set<string>();
  for (let i = 0; i < references.length; i += 5000) {
    const found = await db.transaction.findMany({
      where: { businessId, source: EntrySources.SIE_IMPORT, reference: { in: references.slice(i, i + 5000) } },
      select: { reference: true }
    });
    for (const row of found) if (row.reference) alreadyImported.add(row.reference);
  }
  const fresh = candidates.filter((candidate) => !(candidate.reference && alreadyImported.has(candidate.reference)));
  const duplicates = candidates.length - fresh.length;
  plan.vouchers = fresh.map((candidate) => candidate.planned);

  if (duplicates > 0) skipped.push(say("DUPLICATE_VOUCHERS", { count: duplicates }));
  if (emptyVouchers > 0) skipped.push(say("EMPTY_VOUCHERS", { count: emptyVouchers }));
  if (rowsWithObjects > 0) skipped.push(say("OBJECTS"));
  if (rowsWithOwnDate > 0) skipped.push(say("ROW_DATES", { count: rowsWithOwnDate }));
  if (outsideYear.length > 0) {
    warnings.push(
      say("DATE_OUTSIDE_YEAR", {
        count: outsideYear.length,
        voucher: voucherLabel(outsideYear[0]),
        date: sieIsoDate(outsideYear[0].date)
      })
    );
  }

  // ── Accounts ────────────────────────────────────────────────────────────
  const existingAccounts = await db.account.findMany({
    where: { businessId },
    select: { id: true, code: true, name: true, type: true }
  });
  const existingByCode = new Map(existingAccounts.map((account) => [account.code, account]));

  const usedCodes = new Set<string>();
  for (const voucher of plan.vouchers) for (const line of voucher.lines) usedCodes.add(line.code);
  for (const row of opening0) usedCodes.add(row.account);

  const undeclared: string[] = [];
  const typeByCode = new Map<string, string>();
  for (const account of existingAccounts) typeByCode.set(account.code, account.type);
  for (const code of [...usedCodes].sort()) {
    if (existingByCode.has(code)) continue;
    const declared = doc.accounts.get(code);
    if (!declared || declared.name === "") undeclared.push(code);
    const type = accountTypeFromSie(code, declared?.type);
    typeByCode.set(code, type);
    preview.accountsToCreate.push({
      code,
      name: (declared?.name || `Konto ${code}`).slice(0, 200),
      type
    });
  }
  if (undeclared.length > 0) {
    warnings.push(say("UNDECLARED_ACCOUNTS", { count: undeclared.length, examples: examples(undeclared) }));
  }
  const unused = [...doc.accounts.keys()].filter((code) => !usedCodes.has(code) && !existingByCode.has(code)).length;
  if (unused > 0) skipped.push(say("UNUSED_ACCOUNTS", { count: unused }));
  const renamed = [...doc.accounts.values()].filter((account) => {
    const existing = existingByCode.get(account.code);
    return existing !== undefined && account.name !== "" && existing.name !== account.name;
  });
  if (renamed.length > 0) {
    skipped.push(
      say("NAME_DIFFERS", {
        count: renamed.length,
        examples: examples(renamed.map((account) => `${account.code} ${account.name}`))
      })
    );
  }

  // ── Opening balances ────────────────────────────────────────────────────
  const hasComparisonYears =
    doc.openingBalances.some((row) => row.yearIndex !== 0) ||
    doc.closingBalances.some((row) => row.yearIndex !== 0) ||
    doc.results.some((row) => row.yearIndex !== 0);
  if (hasComparisonYears) skipped.push(say("COMPARISON_YEARS"));

  if (year0 && opening0.length > 0) {
    // Akunta keys opening balances by calendar year (lib/accounting/year-end.ts),
    // so a fiscal year that spans two calendar years has nowhere to put them.
    if (year0.start.slice(0, 4) !== year0.end.slice(0, 4)) {
      warnings.push(say("NON_CALENDAR_YEAR", { start: sieIsoDate(year0.start), end: sieIsoDate(year0.end) }));
    } else {
      const openingYear = Number(year0.start.slice(0, 4));
      plan.openingYear = openingYear;

      const sum = opening0.reduce((total, row) => total + row.amountOre, 0);
      if (sum !== 0) warnings.push(say("IB_UNBALANCED", { difference: sieMoney(locale, Math.abs(sum)) }));

      const stored = await db.openingBalance.findMany({
        where: { businessId, fiscalYear: openingYear },
        include: { account: { select: { code: true } } }
      });
      const storedByCode = new Map(stored.map((row) => [row.account.code, decimalToOre(row.amount)]));

      const onResultAccounts: string[] = [];
      const conflicts: string[] = [];
      // One row per account, should the file repeat one.
      const perAccount = new Map<string, number>();
      for (const row of opening0) perAccount.set(row.account, (perAccount.get(row.account) ?? 0) + row.amountOre);
      for (const [code, sieOre] of perAccount) {
        const type = typeByCode.get(code) ?? accountTypeFromSie(code, undefined);
        if (!isBalanceSheetType(type)) {
          onResultAccounts.push(code);
          continue;
        }
        const natural = flipForAccountType(type, sieOre);
        const existing = storedByCode.get(code);
        if (existing === undefined) plan.openingBalances.push({ code, amountOre: natural });
        else if (existing !== natural) conflicts.push(code);
      }
      if (onResultAccounts.length > 0) {
        warnings.push(
          say("IB_ON_RESULT_ACCOUNT", { count: onResultAccounts.length, examples: examples(onResultAccounts) })
        );
      }
      if (conflicts.length > 0) {
        warnings.push(say("OB_CONFLICT", { year: openingYear, count: conflicts.length, examples: examples(conflicts) }));
      }
    }
  }

  // ── Does the file agree with itself? ────────────────────────────────────
  // Opening balance plus the verifications should give the closing balance
  // (#UB) and the result (#RES) the file states. If it does, the books will
  // look the same in Akunta as they did in the program they came from.
  const stated = [
    ...doc.closingBalances.filter((row) => row.yearIndex === 0).map((row) => ({ ...row, withOpening: true })),
    ...doc.results.filter((row) => row.yearIndex === 0).map((row) => ({ ...row, withOpening: false }))
  ];
  if (stated.length > 0 && preview.allBalanced) {
    const movement = new Map<string, number>();
    for (const voucher of doc.vouchers) {
      for (const line of voucher.lines) movement.set(line.account, (movement.get(line.account) ?? 0) + line.amountOre);
    }
    const openingByCode = new Map<string, number>();
    for (const row of opening0) openingByCode.set(row.account, (openingByCode.get(row.account) ?? 0) + row.amountOre);
    const mismatched = stated
      .filter(
        (row) => (row.withOpening ? (openingByCode.get(row.account) ?? 0) : 0) + (movement.get(row.account) ?? 0) !== row.amountOre
      )
      .map((row) => row.account);
    preview.closingCheck = { checked: stated.length, mismatches: mismatched.length };
    if (mismatched.length > 0) {
      warnings.push(say("CLOSING_MISMATCH", { count: mismatched.length, examples: examples(mismatched) }));
    }
  }

  // ── Locked periods ──────────────────────────────────────────────────────
  const locks = await db.periodLock.findMany({ where: { businessId } });
  const lockFor = (date: Date) => locks.find((lock) => lock.periodStart <= date && lock.periodEnd >= date);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const lockedCandidates = fresh.filter((candidate) => lockFor(candidate.planned.date) !== undefined);
  if (lockedCandidates.length > 0) {
    const first = lockedCandidates[0];
    const lock = lockFor(first.planned.date);
    errors.push(
      say("LOCKED", {
        count: lockedCandidates.length,
        voucher: voucherLabel(first.voucher),
        date: sieIsoDate(first.voucher.date),
        line: first.voucher.line,
        from: lock ? iso(lock.periodStart) : "",
        to: lock ? iso(lock.periodEnd) : ""
      })
    );
  } else if (plan.openingYear !== null && plan.openingBalances.length > 0) {
    const lock = lockFor(new Date(Date.UTC(plan.openingYear, 0, 1)));
    if (lock) {
      errors.push(say("LOCKED_OPENING", { year: plan.openingYear, from: iso(lock.periodStart), to: iso(lock.periodEnd) }));
    }
  }

  // ── What is already in Akunta for the same period ───────────────────────
  if (plan.vouchers.length > 0) {
    const times = plan.vouchers.map((voucher) => voucher.date.getTime());
    const first = new Date(Math.min(...times));
    const last = new Date(Math.max(...times));
    preview.firstDate = iso(first);
    preview.lastDate = iso(last);
    const existing = await db.transaction.count({
      where: { businessId, txnDate: { gte: first, lte: last }, source: { not: EntrySources.SIE_IMPORT } }
    });
    if (existing > 0) {
      const years = first.getUTCFullYear() === last.getUTCFullYear() ? `${first.getUTCFullYear()}` : `${first.getUTCFullYear()}-${last.getUTCFullYear()}`;
      warnings.push(say("EXISTING_ENTRIES", { count: existing, year: years }));
    }
  }

  preview.vouchersToImport = plan.vouchers.length;
  preview.rowsToImport = plan.vouchers.reduce((sum, voucher) => sum + voucher.lines.length, 0);
  preview.totalDebit = formatSieAmount(plan.vouchers.reduce((sum, voucher) => sum + voucher.totalDebitOre, 0));
  preview.openingBalancesToImport = plan.openingBalances.length;

  if (errors.length === 0 && plan.vouchers.length === 0 && plan.openingBalances.length === 0) {
    errors.push(say("NOTHING_TO_IMPORT"));
  }
  preview.canImport = errors.length === 0;
  return plan;
};

/** Step one: say what the import would do. Writes nothing. */
export const previewSieImport = async (
  db: Db,
  params: { businessId: string; bytes: Uint8Array; locale?: SieLocale }
): Promise<SieImportPreview> => {
  const plan = await buildPlan(db, { ...params, locale: params.locale ?? "en" });
  return plan.preview;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const oreToDecimal = (ore: number) => new Prisma.Decimal(formatSieAmount(ore));

/**
 * Step two: write the import. Everything happens in one database transaction,
 * so a failure at any point (ours or a database trigger's) leaves the books
 * exactly as they were.
 *
 * @throws SieImportError when the file cannot be imported; `preview.errors` says why.
 */
export const executeSieImport = async (
  client: PrismaClient,
  params: { businessId: string; userId?: string | null; bytes: Uint8Array; fileName?: string; locale?: SieLocale }
): Promise<SieImportResult> => {
  const { businessId } = params;
  return client.$transaction(
    async (tx) => {
      // Serialise imports for this business: a second import of the same file
      // waits here and then finds the first one's audit row.
      const locked = await tx.$queryRaw<Array<{ next: number }>>`
        SELECT "nextVerificationNumber" AS next FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
      if (locked.length === 0) throw new Error("Business not found.");
      const firstNumber = locked[0].next;

      const plan = await buildPlan(tx, { businessId, bytes: params.bytes, locale: params.locale ?? "en" });
      const { preview } = plan;
      if (!preview.canImport) throw new SieImportError(preview);

      if (preview.accountsToCreate.length > 0) {
        await tx.account.createMany({
          data: preview.accountsToCreate.map((account) => ({
            businessId,
            code: account.code,
            name: account.name,
            type: account.type
          }))
        });
      }
      const accounts = await tx.account.findMany({ where: { businessId }, select: { id: true, code: true } });
      const accountId = new Map(accounts.map((account) => [account.code, account.id]));
      const idFor = (code: string): string => {
        const id = accountId.get(code);
        if (!id) throw new Error(`Account ${code} is missing after it should have been created.`);
        return id;
      };

      if (plan.openingYear !== null && plan.openingBalances.length > 0) {
        const fiscalYear = plan.openingYear;
        await tx.openingBalance.createMany({
          data: plan.openingBalances.map((row) => ({
            businessId,
            accountId: idFor(row.code),
            fiscalYear,
            amount: oreToDecimal(row.amountOre)
          }))
        });
      }

      // Rows are inserted in file order, and the database numbers them in
      // that order, so the imported series keeps the sequence of the original.
      const withIds = plan.vouchers.map((voucher) => ({ id: `sie${randomUUID().replace(/-/g, "")}`, voucher }));
      for (const group of chunk(withIds, 500)) {
        await tx.transaction.createMany({
          data: group.map(({ id, voucher }) => ({
            id,
            businessId,
            txnDate: voucher.date,
            description: voucher.description,
            // See the LIMITATION note at the top of this file.
            direction: TransactionDirections.TRANSFER,
            grossAmount: oreToDecimal(voucher.totalDebitOre),
            netAmount: oreToDecimal(voucher.totalDebitOre),
            vatAmount: 0,
            vatRate: 0,
            currency: plan.currency,
            source: EntrySources.SIE_IMPORT,
            reference: voucher.reference
          }))
        });
      }
      const journalLines = withIds.flatMap(({ id, voucher }) =>
        voucher.lines.map((line) => ({
          transactionId: id,
          accountId: idFor(line.code),
          debit: oreToDecimal(line.debitOre),
          credit: oreToDecimal(line.creditOre),
          note: line.note
        }))
      );
      for (const group of chunk(journalLines, 2000)) {
        await tx.journalLine.createMany({ data: group });
      }

      const result: SieImportResult = {
        preview,
        vouchersImported: plan.vouchers.length,
        accountsCreated: preview.accountsToCreate.length,
        openingBalancesImported: plan.openingBalances.length,
        firstVerificationNumber: plan.vouchers.length > 0 ? firstNumber : null,
        lastVerificationNumber: plan.vouchers.length > 0 ? firstNumber + plan.vouchers.length - 1 : null
      };

      // The audit row is also the record that this content has been imported.
      await writeLedgerAudit(tx, {
        businessId,
        userId: params.userId,
        entityType: SIE_AUDIT_ENTITY,
        entityId: preview.contentHash,
        action: "IMPORT",
        after: {
          fileName: params.fileName ?? null,
          fileSha256: createHash("sha256").update(params.bytes).digest("hex"),
          companyName: preview.companyName,
          program: preview.program,
          fiscalYears: preview.fiscalYears,
          vouchersImported: result.vouchersImported,
          firstVerificationNumber: result.firstVerificationNumber,
          lastVerificationNumber: result.lastVerificationNumber,
          accountsCreated: preview.accountsToCreate.map((account) => account.code),
          openingBalancesImported: result.openingBalancesImported,
          openingYear: plan.openingYear
        }
      });

      return result;
    },
    { maxWait: 15_000, timeout: 180_000 }
  );
};
