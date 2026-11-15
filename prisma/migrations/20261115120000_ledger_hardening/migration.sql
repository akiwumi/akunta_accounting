-- AlterTable
ALTER TABLE "BankImportRow" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "BankStatementLine" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "nextVerificationNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "receiptInboxToken" TEXT;

-- AlterTable
ALTER TABLE "CountryTaxProfile" ALTER COLUMN "vatStandardRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "vatReducedRate1" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "vatReducedRate2" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "vatReducedRate3" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "vatRegistrationThreshold" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "flatIncomeTaxRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "municipalSurchargeRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "nationalSurchargeRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "nationalSurchargeThreshold" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "socialContributionRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "socialContributionCap" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "pensionContributionRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "pensionContributionCap" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "generalDeductionRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "employerContributionRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "employeeWithholdingRate" SET DATA TYPE DECIMAL(9,6);

-- AlterTable
ALTER TABLE "CreditNote" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "vatAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "netAmount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "preliminaryTaxRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "employerContributionRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "pensionRate" SET DATA TYPE DECIMAL(9,6);

-- AlterTable
ALTER TABLE "EmployeeExpense" ALTER COLUMN "grossAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "vatAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "netAmount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "EmployerDeclaration" ALTER COLUMN "totalGross" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "totalTax" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "totalContrib" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "FixedAsset" ALTER COLUMN "acquisitionCost" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "disposalValue" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "IncomeTaxBand" ALTER COLUMN "fromAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "toAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "rate" SET DATA TYPE DECIMAL(9,6);

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "subtotalAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "vatAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "grossAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "vatRate" SET DATA TYPE DECIMAL(9,6);

-- AlterTable
ALTER TABLE "InvoiceItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "vatRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "netAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "vatAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "InvoicePayment" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "JournalLine" ALTER COLUMN "debit" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "credit" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "MileageEntry" ALTER COLUMN "kilometers" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "ratePerKm" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "deductionAmount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "OpeningBalance" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Payslip" ALTER COLUMN "grossSalary" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "taxableGross" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "taxWithheld" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "employerContrib" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "pensionAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "netSalary" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "PeriodisationEntry" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "grossAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "netAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "vatAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "vatRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "confidence" SET DATA TYPE DECIMAL(5,4),
ALTER COLUMN "fxRateToSek" SET DATA TYPE DECIMAL(18,8);

-- AlterTable
ALTER TABLE "SalaryEntry" ALTER COLUMN "grossSalary" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "bonusAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "overtimeAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "benefitsAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "taxableGross" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "preliminaryTaxRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "preliminaryTaxAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "employerContributionRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "employerContributionAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "pensionRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "pensionAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "netSalary" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "TaxConfig" ALTER COLUMN "municipalTaxRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "socialContributionRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "generalDeductionRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "vatStandardRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "vatReducedRateFood" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "vatReducedRateCulture" SET DATA TYPE DECIMAL(9,6);

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "reversesTransactionId" TEXT,
ADD COLUMN     "verificationNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "voidedByUserId" TEXT,
ALTER COLUMN "grossAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "netAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "vatAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "vatRate" SET DATA TYPE DECIMAL(9,6),
ALTER COLUMN "fxRateToSek" SET DATA TYPE DECIMAL(18,8);

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "BankImportBatch_businessId_createdAt_idx" ON "BankImportBatch"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "BankImportRow_batchId_idx" ON "BankImportRow"("batchId");

-- CreateIndex
CREATE INDEX "BankImportRow_transactionId_idx" ON "BankImportRow"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Business_receiptInboxToken_key" ON "Business"("receiptInboxToken");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "Invoice_businessId_status_idx" ON "Invoice"("businessId", "status");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "JournalLine_transactionId_idx" ON "JournalLine"("transactionId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE INDEX "PeriodLock_businessId_periodStart_periodEnd_idx" ON "PeriodLock"("businessId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Receipt_businessId_receiptDate_idx" ON "Receipt"("businessId", "receiptDate");

-- CreateIndex
CREATE INDEX "Receipt_businessId_needsReview_idx" ON "Receipt"("businessId", "needsReview");

-- CreateIndex
CREATE INDEX "Receipt_businessId_createdAt_idx" ON "Receipt"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_reversesTransactionId_key" ON "Transaction"("reversesTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_businessId_txnDate_idx" ON "Transaction"("businessId", "txnDate");

-- CreateIndex
CREATE INDEX "Transaction_receiptId_idx" ON "Transaction"("receiptId");

-- Backfill: number existing verifications per business in booking order,
-- then point each business at its next free number.
UPDATE "Transaction" t
   SET "verificationNumber" = n.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY "businessId" ORDER BY "createdAt", id) AS rn
      FROM "Transaction"
  ) n
 WHERE n.id = t.id;

UPDATE "Business" b
   SET "nextVerificationNumber" = COALESCE(
     (SELECT MAX("verificationNumber") FROM "Transaction" t WHERE t."businessId" = b.id), 0) + 1;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_businessId_verificationNumber_key" ON "Transaction"("businessId", "verificationNumber");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_reversesTransactionId_fkey" FOREIGN KEY ("reversesTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ─────────────────────────────────────────────────────────────────────────────
-- Ledger integrity rules enforced by the database (hand-written).
--
-- Bokföringslagen requires an unbroken verification series and forbids
-- deleting or altering a booked entry. The application follows these rules in
-- lib/accounting/ledger.ts; the triggers below are the backstop for any code
-- path that does not.
--
-- Maintenance escape hatch (tests, data repair), inside one transaction only:
--   SET LOCAL akunta.allow_ledger_rewrite = 'on';
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Verification numbers: assigned here, never by the application. The row
--    lock on "Business" serialises concurrent inserts, and a rolled-back insert
--    rolls the counter back with it, so the series has no gaps.
CREATE OR REPLACE FUNCTION akunta_assign_verification_number() RETURNS trigger AS $$
BEGIN
  UPDATE "Business"
     SET "nextVerificationNumber" = "nextVerificationNumber" + 1
   WHERE id = NEW."businessId"
  RETURNING "nextVerificationNumber" - 1 INTO NEW."verificationNumber";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEDGER_NO_BUSINESS: business % does not exist', NEW."businessId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transaction_assign_verification_number
  BEFORE INSERT ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION akunta_assign_verification_number();

-- 2. Locked periods: nothing may be booked into, or moved into or out of, one.
CREATE OR REPLACE FUNCTION akunta_check_period_lock() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PeriodLock" l
     WHERE l."businessId" = NEW."businessId"
       AND l."periodStart" <= NEW."txnDate" AND l."periodEnd" >= NEW."txnDate"
  ) OR (TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM "PeriodLock" l
     WHERE l."businessId" = OLD."businessId"
       AND l."periodStart" <= OLD."txnDate" AND l."periodEnd" >= OLD."txnDate"
  )) THEN
    RAISE EXCEPTION 'LEDGER_PERIOD_LOCKED: the date falls within a locked accounting period'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transaction_check_period_lock
  BEFORE INSERT OR UPDATE OF "txnDate" ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION akunta_check_period_lock();

-- 3. Booked entries are immutable. Corrections are made with a reversing entry.
CREATE OR REPLACE FUNCTION akunta_protect_transaction() RETURNS trigger AS $$
BEGIN
  IF current_setting('akunta.allow_ledger_rewrite', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: verification % cannot be deleted; book a correcting entry', OLD."verificationNumber"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."businessId" IS DISTINCT FROM OLD."businessId"
     OR NEW."verificationNumber" IS DISTINCT FROM OLD."verificationNumber"
     OR NEW."direction" IS DISTINCT FROM OLD."direction"
     OR NEW."grossAmount" IS DISTINCT FROM OLD."grossAmount"
     OR NEW."netAmount" IS DISTINCT FROM OLD."netAmount"
     OR NEW."vatAmount" IS DISTINCT FROM OLD."vatAmount"
     OR NEW."vatRate" IS DISTINCT FROM OLD."vatRate"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."reversesTransactionId" IS DISTINCT FROM OLD."reversesTransactionId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR (OLD."voidedAt" IS NOT NULL AND NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt") THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: verification % cannot be altered; book a correcting entry', OLD."verificationNumber"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transaction_protect
  BEFORE UPDATE OR DELETE ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION akunta_protect_transaction();

CREATE OR REPLACE FUNCTION akunta_protect_journal_line() RETURNS trigger AS $$
BEGIN
  IF current_setting('akunta.allow_ledger_rewrite', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'LEDGER_IMMUTABLE: journal lines cannot be altered or deleted; book a correcting entry'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_line_protect
  BEFORE UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION akunta_protect_journal_line();

-- 4. Every verification must balance. Checked at commit, so the lines of one
--    entry can be inserted in several statements inside one transaction.
ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_amounts_check"
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0));

CREATE OR REPLACE FUNCTION akunta_check_balanced() RETURNS trigger AS $$
DECLARE
  total_debit  numeric;
  total_credit numeric;
BEGIN
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO total_debit, total_credit
    FROM "JournalLine" WHERE "transactionId" = NEW."transactionId";
  IF total_debit <> total_credit THEN
    RAISE EXCEPTION 'LEDGER_UNBALANCED: debit % does not equal credit % for transaction %',
      total_debit, total_credit, NEW."transactionId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_line_balanced
  AFTER INSERT ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION akunta_check_balanced();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security.
--
-- Supabase exposes the public schema through its REST API to anyone holding
-- the anon key. The app never uses that API for data: it connects through
-- Prisma as the table owner, which bypasses RLS. Enabling RLS with no policies
-- therefore closes the REST API completely and leaves the app unaffected.
--
-- Any table added in a later migration must enable RLS in that migration.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  -- These roles exist on Supabase only; plain Postgres (local dev, CI) skips this.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END $$;
