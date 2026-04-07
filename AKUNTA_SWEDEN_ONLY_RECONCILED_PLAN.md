# Akunta Sweden-Only Reconciled Build Plan

Date: 2026-04-06  
Product: Akunta — Swedish bookkeeping SaaS for sole traders and small businesses operating in Sweden

## 1. Purpose of this reconciliation

This document merges:

1. The uploaded `PHASED_BUILD_IMPLEMENTATION_PLAN.md`.
2. The codebase review and implementation plan previously outlined for the current bookkeeping app.
3. The new instruction that the app must be **for Sweden only**.

The result is a single Sweden-only implementation plan. All international, UK, EU-wide, and non-Swedish territory planning has been removed.

---

## 2. Reconciliation summary

### Keep from the uploaded plan

These parts remain valid and should stay:

- Pure SaaS delivery model.
- Vercel-hosted Next.js app.
- PostgreSQL on Supabase.
- Prisma.
- Mobile-first UX.
- Storage-based file ingestion for receipts and documents.
- Queue-based OCR/import/export processing.
- Stripe billing.
- Resend or equivalent transactional email.
- Sentry and production observability.
- Multi-tenant organization model.
- RLS, rate limiting, backups, PITR, and GDPR controls.
- Existing feature carry-forward sections for receipts, invoices, ledger, reports, payroll, and Swedish tax modules.

### Change from the uploaded plan

These parts must be changed to fit a Sweden-only product:

- The app **must default to Sweden**, not “no default country”.
- Tax and jurisdiction settings become **Sweden-specific business settings**, not country-aware settings.
- Localization becomes **Swedish + English only**.
- Public resources/help/blog, if built, should be Sweden-focused.
- Tax calculations, VAT logic, payroll assumptions, and reports should be built around Swedish rules only.
- Compliance pages should use Swedish filing periods, labels, and workflows only.

### Remove from the uploaded plan

These parts are removed entirely:

- All UK and EU first-class support.
- All non-UK/EU configurable tax criteria.
- Country selector logic.
- Country resolution logic.
- Country template versioning.
- International tax profile tables.
- EU matrix and template families.
- Browser auto-translation strategy for many countries.
- Country-aware resources and territory-aware labels.
- Generic “global mode”.

---

## 3. Locked product decisions for the Sweden-only app

1. Akunta is a **Sweden-only accounting SaaS**.
2. The product is designed first for **enskild firma / sole traders**, while allowing later expansion to other Swedish business types if needed.
3. The source of truth is cloud-hosted only.
4. Frontend and API routes run in Next.js.
5. Production database is Supabase Postgres.
6. Files are stored in managed object storage, not local disk.
7. UX is mobile-first.
8. The accounting domain, compliance logic, and filing flows are based on **Swedish bookkeeping and tax workflows**.
9. The only built-in languages are **Swedish and English**.
10. The app should preserve current Swedish module behavior already present in the codebase.

---

## 4. Current app baseline that must be preserved

The existing codebase already contains meaningful scope that should not be lost during migration:

- Dashboard with P&L, VAT, and tax estimate indicators.
- Receipts upload, OCR/extraction, review, editing, and FX-to-SEK handling.
- Invoices, customer records, invoice PDF/email, and mark-as-paid flow.
- Transactions and ledger views with journal rendering and exports.
- Bank CSV import.
- Reports including VAT, tax estimate, and NE-bilaga draft.
- Payroll employees/salaries/expenses modules.
- Fixed assets, mileage, periodiseringsfond and expansionsfond support.
- Swedish settings such as F-skatt, VAT number, personnummer, VAT rates, and tax estimate assumptions.

This baseline is preserved and becomes the functional base for the SaaS migration.

---

## 5. Production architecture

## 5.1 Core stack

- **Frontend / API**: Next.js 14+ App Router, TypeScript, Vercel.
- **Database**: Supabase Postgres.
- **ORM**: Prisma.
- **Auth**: Supabase Auth or equivalent managed auth, with future BankID support.
- **Storage**: Supabase Storage.
- **Billing**: Stripe Billing.
- **Transactional email**: Resend.
- **Queue / async jobs**: Upstash Redis + QStash or equivalent.
- **Monitoring**: Sentry + Vercel Observability.

## 5.2 Environment topology

- `akunta-dev`
- `akunta-staging`
- `akunta-prod`

Rules:

- Each Vercel environment maps only to its matching Supabase project.
- Never connect preview builds to production data.
- Never use local filesystem as the production persistence layer.

---

## 6. Sweden-only settings model

Remove all country-driven configuration and replace it with a fixed Swedish settings model.

### 6.1 Business settings

Store:

- Company name
- Organization number / personnummer as appropriate
- VAT number
- F-skatt status
- SNI code
- Bookkeeping method (`kontantmetoden` or `fakturametoden`)
- VAT registration status
- VAT filing frequency
- Fiscal year start month
- Default invoice settings
- Default sender identity
- Bank details

### 6.2 Sweden-only tax settings

Store:

- Municipal tax rate assumptions
- State tax threshold assumptions
- Self-employed social contributions / egenavgifter assumptions
- General deduction assumptions where applicable
- VAT standard and reduced rates used by the product
- Church/burial/public service fee assumptions if shown in estimates
- Preliminary F-tax estimate settings

### 6.3 Language settings

Supported UI languages:

- `sv-SE`
- `en-SE` or `en`

No country detection, no territory templates, no international tax schema.

---

## 7. Data model changes

The uploaded plan correctly moves toward multi-tenancy, but the schema must be reconciled with the actual codebase review.

## 7.1 Core tenancy/auth models to add

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String?
  fullName      String?
  bankIdSubject String?  @unique
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  memberships   Membership[]
  sessions      Session[]
  auditLogs     AuditLog[]
}

model Membership {
  id         String   @id @default(cuid())
  userId     String
  businessId String
  role       String
  createdAt  DateTime @default(now())

  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@unique([userId, businessId])
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

## 7.2 Compliance and audit models to add

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  businessId String
  userId     String?
  entityType String
  entityId   String
  action     String
  beforeJson String?
  afterJson  String?
  createdAt  DateTime @default(now())

  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  user       User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
}

model PeriodLock {
  id             String   @id @default(cuid())
  businessId     String
  periodStart    DateTime
  periodEnd      DateTime
  lockedAt       DateTime @default(now())
  lockedByUserId String?

  business       Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}

model Filing {
  id          String   @id @default(cuid())
  businessId  String
  filingType  String
  periodStart DateTime
  periodEnd   DateTime
  status      String
  externalRef String?
  payloadJson String?
  responseJson String?
  submittedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  business    Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}

model TaxEvent {
  id         String   @id @default(cuid())
  businessId String
  source     String
  eventType  String
  eventRef   String?
  title      String
  detail     String?
  eventDate  DateTime?
  createdAt  DateTime @default(now())

  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}
```

## 7.3 Reconciliation and bank sync models

```prisma
model BankConnection {
  id          String   @id @default(cuid())
  businessId  String
  provider    String
  providerRef String
  status      String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  business    Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}

model BankStatementLine {
  id                    String   @id @default(cuid())
  businessId            String
  connectionId          String?
  txnDate               DateTime
  bookingDate           DateTime?
  description           String
  amount                Decimal
  currency              String   @default("SEK")
  externalId            String?
  matchedTransactionId  String?
  status                String   @default("UNMATCHED")
  createdAt             DateTime @default(now())

  business              Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
}
```

## 7.4 Business fields to add for Sweden-only integrations

Add to `Business`:

- `skvActorId`
- `skvAuthorizationStatus`
- `bankgiro`
- `plusgiro`
- `peppolId`

Do **not** add international tax-profile tables such as `country_tax_templates`, `organization_tax_profiles`, or `organization_tax_profile_rules`.

---

## 8. File-by-file implementation plan

## 8.1 Authentication and business context

### `lib/auth/session.ts`
Replace the current local/demo auth with:

- hashed password verification
- DB-backed sessions
- current user lookup
- current business lookup by membership
- role checks
- future BankID support

### `middleware.ts`
Change it to:

- validate a real session
- resolve current business membership
- enforce route protection
- prevent access without business context

### `lib/data/business.ts`
Refactor it so it no longer returns one implicit global business.

Add:

- `getCurrentBusinessOrThrow()`
- `createBusinessForUser()`
- `requireCurrentBusiness()`

### `app/api/auth/*`
Add:

- `register/route.ts`
- `reset-password/route.ts`
- `bankid/start/route.ts`
- `bankid/collect/route.ts`

---

## 8.2 Accounting engine

### `lib/accounting/posting.ts`
Split into:

- `lib/accounting/posting-cash.ts`
- `lib/accounting/posting-accrual.ts`

Then add a small selector that dispatches based on `business.bookkeepingMethod`.

### Missing accounting behaviors to add

- full `fakturametoden`
- accounts receivable and accounts payable logic
- partial payments
- credit notes
- write-offs
- corrections instead of destructive edits
- opening balances and year rollover
- closed-period behavior and period locks

### `lib/accounting/reports.ts`
Extend to support:

- filing snapshots
- locked periods
- filing-ready VAT totals
- NE-bilaga and tax estimate traceability

---

## 8.3 Reconciliation and banking

### `app/api/imports/bank-csv/route.ts`
Keep as fallback, but rework the flow to:

1. import rows
2. normalize rows
3. save `BankStatementLine`
4. generate matching suggestions
5. let user confirm matches
6. finalize link/posting

### Add new files

```text
lib/reconciliation/
  matcher.ts
  rules.ts
  suggestions.ts
  finalize.ts

app/api/reconciliation/
  suggestions/route.ts
  match/route.ts
  finalize/route.ts
```

### Add bank sync integration layer

```text
lib/integrations/banking/
  provider.ts
  transactions.ts
  accounts.ts
  sync.ts

app/api/integrations/banking/
  connect/route.ts
  callback/route.ts
  sync/route.ts
```

---

## 8.4 Storage, OCR, and documents

### Keep from the uploaded plan

- storage-backed uploads
- async OCR/extraction queue
- review before posting

### Add missing production requirements

- replace local filesystem storage in production
- virus/malware scan for uploads if feasible
- immutable evidence retention policy
- stronger validation for PDF/image uploads
- backup/restore strategy for files and DB

### Add abstraction layer

```text
lib/storage/
  receipts.ts
  invoices.ts
```

---

## 8.5 Invoices and delivery

### Existing invoice flow to preserve

- invoice creation
- numbering patterns
- PDF generation
- email sending
- mark paid
- posting into ledger

### Missing invoice features to add

- partial payment support
- credit invoices / credit notes
- invoice lifecycle states beyond paid/unpaid if needed
- delivery abstraction
- PEPPOL readiness for Sweden

### Files to add/update

- `lib/invoices/pdf.ts`
- `app/api/invoices/[id]/deliver/route.ts`
- `lib/integrations/einvoice/peppol.ts`

---

## 8.6 Payroll

The codebase already has payroll structure, but it is not yet compliance-grade.

### Add

- payroll run state machine
- payslip generation
- tax withholding logic
- employer contribution rules
- declaration preparation flow
- paid/unpaid and approval transitions with audit history

### Files

```text
lib/payroll/
  calculations.ts
  declarations.ts
  payslips.ts

app/api/payroll/
  declarations/route.ts
  payslips/route.ts
```

---

## 8.7 Compliance and auditability

### `app/compliance/page.tsx`
Extend it into a live compliance workspace:

- Swedish filing deadlines
- VAT filing status
- Skattekonto balance
- Kundhändelser feed
- unresolved issues and warnings
- locked periods
- audit alerts

### `app/audit/page.tsx`
Add a dedicated audit trail page showing:

- who changed what
- before/after values
- filing actions
- export actions
- period lock/unlock actions

---

## 9. Sweden-only tax authority integrations

These are the external APIs that matter most for this app.

## 9.1 Priority 1: Beskattningsengagemang

Use for:

- onboarding checks
- F-skatt status
- VAT registration status
- employer registration status

Files:

```text
lib/integrations/skatteverket/beskattningsengagemang.ts
app/api/integrations/skatteverket/beskattningsengagemang/route.ts
```

UI placement:

- setup flow
- settings page
- compliance page

## 9.2 Priority 2: Momsdeklaration

Use for:

- VAT draft generation
- VAT submission
- filing status retrieval

Files:

```text
lib/integrations/skatteverket/momsdeklaration.ts
app/api/integrations/skatteverket/moms/draft/route.ts
app/api/integrations/skatteverket/moms/submit/route.ts
app/api/integrations/skatteverket/moms/status/route.ts
```

Connect to:

- `app/api/reports/vat/route.ts`
- `app/reports/page.tsx`
- `app/filings/page.tsx`

## 9.3 Priority 3: Skattekonto

Use for:

- tax account balance
- tax transactions
- reconciliation of tax payments

Files:

```text
lib/integrations/skatteverket/skattekonto.ts
app/api/integrations/skatteverket/skattekonto/route.ts
```

Connect to:

- dashboard
- compliance page
- tax payment reconciliation views

## 9.4 Priority 4: Kundhändelser

Use for:

- event feed
- deadlines
- pending tax actions
- compliance notifications

Files:

```text
lib/integrations/skatteverket/kundhandelser.ts
app/api/integrations/skatteverket/events/sync/route.ts
```

## 9.5 Priority 5: Ombudshantering

Only if accountant access is added.

Use for:

- validating representative permissions
- accountant workflows

Files:

```text
lib/integrations/skatteverket/ombud.ts
app/api/integrations/skatteverket/ombud/route.ts
```

## 9.6 Priority 6: Arbetsgivardeklaration

Only when payroll becomes filing-grade.

Files:

```text
lib/integrations/skatteverket/arbetsgivardeklaration.ts
app/api/payroll/declarations/route.ts
```

## 9.7 Later: Inkomstdeklaration 1

Use later for sole-trader filing when implementation timing and API maturity make sense.

Files:

```text
lib/integrations/skatteverket/inkomstdeklaration1.ts
```

Feeds from:

- tax estimate
- NE-bilaga data
- year-end summaries

---

## 10. Shared integration layer

Do not spread integration auth logic through page routes.

Create:

```text
lib/integrations/skatteverket/
  auth.ts
  client.ts
  beskattningsengagemang.ts
  momsdeklaration.ts
  skattekonto.ts
  kundhandelser.ts
  ombud.ts
  arbetsgivardeklaration.ts
  inkomstdeklaration1.ts
```

Responsibilities:

- token handling
- API key handling
- request signing or authorization flow handling
- error normalization
- retry strategy
- correlation IDs
- logging and auditability

Also create:

```text
lib/integrations/bankid/
  auth.ts
  client.ts
```

---

## 11. Public site and content scope after reconciliation

The uploaded plan added a public site and content layer. That can stay, but only in a Sweden-only form.

### Keep

- public landing page
- sign-in route from public site
- help pages
- support page
- blog
- testimonials

### Change

- all content should be Sweden-focused
- resources should be Sweden-focused only
- remove country-aware resources
- remove territory-aware content strategy

### Repository additions that still make sense

```text
app/
  (public)/
    page.tsx
    sign-in/page.tsx
    help/page.tsx
    help/[slug]/page.tsx
    support/page.tsx
    blog/page.tsx
    blog/[slug]/page.tsx
    resources/page.tsx

components/public/
  Hero.tsx
  FeatureGrid.tsx
  TestimonialCarousel.tsx
  LatestPosts.tsx
  SupportForm.tsx

lib/content/
  blog.ts
  help.ts
  resources.ts
```

### Remove

- `CountryResourceLinks.tsx`
- territory/tax profile public content coupling
- language/country-detection-driven content branches beyond Swedish and English

---

## 12. Exact removals from the uploaded plan

Delete these ideas from the old plan entirely:

- “country-dependent tax setup for UK/EU + configurable global mode”
- “must not default to Sweden”
- `NEXT_PUBLIC_COUNTRY_DETECTION_MODE`
- `NEXT_PUBLIC_DEFAULT_COUNTRY=none`
- `SUPPORTED_TAX_COUNTRIES=...`
- `DEEPL_API_KEY` and `DEEPL_API_URL` as core scope requirements
- country selector requirement
- country resolution source metadata
- migration wizard for changing country after transactions exist
- all-country option packs
- UK + EU template matrix
- non-UK/EU custom jurisdiction setup
- all country-tax template tables
- all country-aware reporting and export logic

---

## 13. Exact environment variable set after Sweden-only reconciliation

```bash
# App
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://app.akunta.com
SESSION_SECRET=change-this-very-long-random-string
CRON_SECRET=change-this-very-long-random-string

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Prisma / PostgreSQL
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
DIRECT_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres

# Stripe
STRIPE_SECRET_KEY=sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...

# Email
RESEND_API_KEY=re_...
EMAIL_FROM=Akunta <billing@akunta.com>
EMAIL_REPLY_TO=support@akunta.com

# OCR / AI
OPENAI_API_KEY=sk-...
OPENAI_RECEIPT_MODEL=gpt-4.1-mini

# Queue and jobs
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
QSTASH_TOKEN=...
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...

# Observability
SENTRY_DSN=https://...
NEXT_PUBLIC_SENTRY_DSN=https://...

# Localization
SUPPORTED_APP_LOCALES=sv-SE,en
DEFAULT_APP_LOCALE=sv-SE

# Public site / support
NEXT_PUBLIC_SITE_URL=https://akunta.com
SUPPORT_CONTACT_EMAIL=support@akunta.com
SUPPORT_FORM_RECIPIENT=support@akunta.com
```

---

## 14. Updated phased roadmap

## Phase 0: Production foundation

- Provision Supabase dev/staging/prod.
- Configure Vercel envs.
- Wire environment variables.
- Move all production persistence off local disk.
- Document deployment and migration workflow.

## Phase 1: Real auth and tenancy

- Replace local/demo auth.
- Add users, memberships, sessions, business context.
- Enforce tenant scoping.
- Add audit logging skeleton.
- Preserve current login UX where useful, but back it with real auth.

## Phase 2: Core accounting hardening

- Finalize receipts, invoices, transactions, ledger, exports, and reports on multi-tenant schema.
- Split `kontantmetoden` and `fakturametoden`.
- Add period locks.
- Add corrections and opening balances.

## Phase 3: OCR and document pipeline

- Move OCR/extraction to async queue workers.
- Store original files in object storage.
- Add low-confidence review queue.
- Preserve existing receipt extraction fields and FX metadata.

## Phase 4: Invoicing and posting lifecycle

- Preserve invoice builder and PDF/email flow.
- Add better status handling, partial payments, credit notes, and ledger traceability.
- Add PEPPOL readiness for Swedish invoice delivery.

## Phase 5: Reports, filings, and tax integrations

- Keep VAT report, P&L, balance sheet, tax estimate, and NE-bilaga draft.
- Add filing snapshots.
- Integrate Beskattningsengagemang, Momsdeklaration, Skattekonto, and Kundhändelser.
- Add filings page and submission history.

## Phase 6: Billing and subscriptions

- Add Stripe checkout and customer portal.
- Sync subscription state.
- Gate features by plan without breaking core accounting flows.

## Phase 7: Reconciliation and banking

- Add bank connection support.
- Keep CSV import as fallback.
- Build matching suggestions and finalize workflow.
- Add dashboard reconciliation queue.

## Phase 8: Payroll-grade compliance

- Add payslips.
- Add employer declaration preparation.
- Integrate Arbetsgivardeklaration when payroll is mature enough.

## Phase 9: Hardening and launch

- Security testing.
- Backup and recovery drills.
- Observability and alerting.
- Regression checks for receipts, invoices, ledger, payroll, reports, exports, and filings.

---

## 15. Best next implementation steps

1. Replace `lib/auth/session.ts` and `middleware.ts`.
2. Add `User`, `Membership`, `Session`, `AuditLog`, `Filing`, `TaxEvent`, and `PeriodLock`.
3. Refactor business resolution out of the current singleton pattern.
4. Split posting engine into cash and accrual modules.
5. Add bank statement line storage and reconciliation routes.
6. Build shared Skatteverket integration client/auth layer.
7. Integrate Beskattningsengagemang in setup/settings/compliance.
8. Connect VAT report outputs to Momsdeklaration.
9. Add Skattekonto and Kundhändelser to dashboard/compliance.
10. Migrate files to object storage and queue OCR/import jobs.

---

## 16. Acceptance criteria for the reconciled Sweden-only plan

1. Every authenticated request resolves a real user and business.
2. No cross-tenant data leakage is possible through server routes or policies.
3. All core accounting actions are auditable.
4. The app preserves current Swedish bookkeeping features already implemented.
5. The app supports Swedish sole-trader workflows without country selection.
6. VAT reporting and compliance workflows are Sweden-specific.
7. The product does not contain tax-template logic for other countries.
8. Receipts, invoices, ledger, reports, payroll, and exports all work in the production SaaS architecture.
9. The roadmap clearly prioritizes Swedish integrations over international expansion.

---

## 17. Final conclusion

The uploaded phased plan had a strong SaaS and production foundation, but its international and country-template direction conflicts with the actual product direction now required.

The correct path is:

- keep the SaaS architecture,
- keep the strong security/tenancy/production pieces,
- keep the existing Swedish feature baseline,
- remove all multi-country tax architecture,
- and focus the build on Swedish bookkeeping, Swedish compliance, and Swedish tax authority integrations.

