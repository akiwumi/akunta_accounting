
# Akunta — Manual Implementation Checklist

Everything in this document requires action outside the codebase. Code is already written; these are the accounts, credentials, agreements, and configuration steps that must be done manually before each feature works in production.

---

## 1. Infrastructure — Supabase

The app currently runs on SQLite (`prisma/dev.db`). Switch to Supabase PostgreSQL before any production use.

### Steps

1. Create three Supabase projects: `akunta-dev`, `akunta-staging`, `akunta-prod`
2. Enable Point-in-Time Recovery (PITR) on the prod project (Settings → Database → Backups)
3. Change `prisma/schema.prisma` datasource from `sqlite` to `postgresql`
4. Run `prisma db push` against each project in order: dev → staging → prod
5. Create storage buckets named `receipts` and `invoices` — set both to **private**

### Environment variables

```bash
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
DIRECT_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres

NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

STORAGE_PROVIDER=supabase
SUPABASE_STORAGE_BUCKET=receipts
```

---

## 2. Infrastructure — Vercel

1. Create a Vercel project linked to this repo
2. Map each git branch/environment to its matching Supabase project — **never connect preview builds to production data**
3. Generate secrets:
   ```bash
   openssl rand -hex 32   # use once for SESSION_SECRET, once for CRON_SECRET
   ```

### Environment variables

```bash
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://app.akunta.com
NEXT_PUBLIC_SITE_URL=https://akunta.com
SESSION_SECRET=<64-char random string>
CRON_SECRET=<64-char random string>
SUPPORTED_APP_LOCALES=sv-SE,en
DEFAULT_APP_LOCALE=sv-SE
SUPPORT_CONTACT_EMAIL=support@akunta.com
```

---

## 3. OpenAI (receipt OCR)

Already partially configured in `.env`. Set the key.

```bash
OPENAI_API_KEY=sk-...
OPENAI_RECEIPT_MODEL=gpt-4.1-mini
```

---

## 4. Email — SMTP

Required by invoice email delivery and the registration confirmation flow.

1. Create a [Resend](https://resend.com) account (or use any SMTP provider)
2. Verify the `akunta.com` sending domain
3. Copy SMTP credentials from the Resend dashboard

```bash
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=re_...
SMTP_SECURE=false
EMAIL_FROM=Akunta <billing@akunta.com>
EMAIL_REPLY_TO=support@akunta.com
SUPPORT_EMAIL=support@akunta.com
```

---

## 5. Stripe — Billing

1. Create a [Stripe](https://stripe.com) account
2. In the Stripe dashboard, create two Products with monthly recurring Prices: **Starter** and **Pro**
3. Register the webhook endpoint in the Stripe dashboard:
   - URL: `https://app.akunta.com/api/billing/webhook`
   - Events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`

```bash
STRIPE_SECRET_KEY=sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
```

---

## 6. Upstash QStash — Async OCR queue

Without `QSTASH_TOKEN`, receipt OCR runs synchronously as a dev fallback. For production scale, async processing via QStash is required.

**Prerequisite:** `NEXT_PUBLIC_APP_URL` must point to a publicly reachable HTTPS URL before QStash can POST callbacks to `/api/queue/ocr`.

1. Create an [Upstash](https://upstash.com) account
2. Create a QStash project
3. Copy the token and signing keys from the QStash console

```bash
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
QSTASH_TOKEN=...
QSTASH_CURRENT_SIGNING_KEY=sig_...
QSTASH_NEXT_SIGNING_KEY=sig_...
```

---

## 7. Skatteverket API

Five integrations are built and ready (Beskattningsengagemang, Momsdeklaration, Skattekonto, Kundhändelser, Arbetsgivardeklaration) but none will fire until credentials are configured.

### Step 1 — Register on the Skatteverket developer portal

- Register your organisation at Skatteverkets API portal
- Apply for access to each API — Momsdeklaration and Skattekonto require separate signed agreements

### Step 2 — Set credentials

```bash
SKV_API_BASE_URL=https://api.skatteverket.se
SKV_TOKEN_URL=https://auth.skatteverket.se/oauth2/token
SKV_API_CLIENT_ID=...
SKV_API_CLIENT_SECRET=...
```

### Step 3 — Per-business setup

Once a user registers, call `GET /api/integrations/skatteverket/beskattningsengagemang` during onboarding. This returns the business's F-skatt status, VAT registration, and employer registration, and writes `skvActorId` and `skvAuthorizationStatus` to the `Business` record.

### Step 4 — Kundhändelser sync cron

The TaxEvents table (shown on the compliance page) is only populated when `syncKundhandelserToDB()` is triggered. Add a daily cron to `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/integrations/skatteverket/events/sync", "schedule": "0 6 * * *" }
  ]
}
```

The sync endpoint must verify the `CRON_SECRET` in the `Authorization` header.

---

## 8. BankID authentication

BankID requires a formal Relying Party agreement with Finansiell ID-Teknik BID AB. Allow several weeks to months for approval.

### Step 1 — Apply as a Relying Party

Apply at [bankid.com/en/foretag/skaffa-bankid-for-foretag](https://www.bankid.com/en/foretag/skaffa-bankid-for-foretag). You will need a Swedish organisation number.

### Step 2 — Receive and configure certificates

Once approved, you receive a PKCS#12 client certificate for the test environment and a separate one for production.

```bash
BANKID_ENV=test                          # or "production"
BANKID_CERT_P12_BASE64=<base64 of .p12>
BANKID_CERT_PASSPHRASE=<passphrase>
BANKID_CA_CERT_BASE64=<base64 of BankID root CA PEM>
```

To base64-encode a certificate file:
```bash
base64 -i FPTestCert3.p12 | tr -d '\n'
```

The BankID CA certificate is available from the BankID RP technical documentation portal.

### Step 3 — Add BankID button to the login page

The API routes `/api/auth/bankid/start` and `/api/auth/bankid/collect` are built. The login page (`app/login/page.tsx`) only has the email/password form. You need to add:

1. A "Logga in med BankID" button that calls `POST /api/auth/bankid/start`
2. A polling loop that calls `POST /api/auth/bankid/collect` every 2 seconds with the returned `orderRef`
3. On `status: "complete"` the cookie is set automatically and the user is redirected to `/dashboard`
4. Show `hintCode` messages to the user while pending (e.g. "Start your BankID app")

---

## 9. PEPPOL e-invoice delivery

The `/api/invoices/[id]/deliver` route with `method: "peppol"` generates valid PEPPOL BIS Billing 3.0 UBL 2.1 XML and saves a Filing record, but **does not transmit it** — it returns the XML as a file download.

### To enable live delivery

1. Contract with a Swedish PEPPOL Access Point provider:
   - [Inexchange](https://www.inexchange.se)
   - [Pagero](https://www.pagero.com)
   - [Svea Exchange](https://www.sveaexchange.se)
   - [Visma](https://www.visma.se)

2. Register your PEPPOL participant ID (format: `0007:<orgnummer>`) — set this on the `Business` record in Settings

3. In `app/api/invoices/[id]/deliver/route.ts`, after the `prisma.filing.create(...)` call in the `method === "peppol"` branch, add an HTTP POST to your Access Point's transmission API with the generated XML

---

## 10. Inkomstdeklaration 1 — electronic submission

The `GET/POST /api/integrations/skatteverket/id1` endpoints prepare and cache a full ID1 draft (NE-bilaga figures, tax box 10.1/10.2, egenavgifter estimate) but **do not submit it electronically**. Skatteverket's API for individual income declarations is not yet generally available.

### Current state

- The draft is computed from ledger data and saved as a Filing record
- All figures are available for the user to review and manually enter into Skatteverkets e-tjänst (Mina Sidor)

### When the Skatteverket API opens

Add the submission call inside `prepareId1Draft()` in `lib/integrations/skatteverket/inkomstdeklaration1.ts`, using `skvRequest()` from the existing Skatteverket client.

---

## 11. Audit logging — add calls to business logic routes

`writeAuditLog()` exists in `lib/auth/context.ts` and the helper is ready to use. It is currently only called in 2 routes. The audit trail page at `/audit` will show limited entries until you add calls to the routes that matter for compliance.

### Recommended routes to instrument

| Route | Action | Priority |
|---|---|---|
| `POST /api/receipts/upload` | `CREATE` | High |
| `PUT /api/receipts/[id]` | `UPDATE` | High |
| `POST /api/invoices` | `CREATE` | High |
| `POST /api/invoices/[id]/pay` | `PAY` | High |
| `POST /api/invoices/[id]/deliver` | `SUBMIT` | High |
| `POST /api/year-end/close` | `LOCK` | High |
| `POST /api/year-end/opening-balances` | `UPDATE` | Medium |
| `PUT /api/salaries/salary/[id]/approve` | `APPROVE` | Medium |
| `POST /api/salaries/salary/[id]/pay` | `PAY` | Medium |
| `DELETE /api/transactions/[id]` | `DELETE` | High |
| `POST /api/integrations/skatteverket/moms/submit` | `SUBMIT` | High |

### Usage

```typescript
import { writeAuditLog } from "@/lib/auth/context";

await writeAuditLog(businessId, userId, "Invoice", invoice.id, "CREATE", null, invoice);
```

---

## 12. Session cleanup cron

`scripts/cleanup-sessions.ts` exists but is never run automatically. Add to `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/cleanup-sessions", "schedule": "0 3 * * *" }
  ]
}
```

Then create `app/api/cron/cleanup-sessions/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  if (request.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const deleted = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return NextResponse.json({ deleted: deleted.count });
}
```

---

## 13. Production first user

There is no automatic production seed. After running `prisma db push` on the prod database:

```bash
curl -X POST https://app.akunta.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"...","fullName":"Your Name","businessName":"Your Business"}'
```

Or use the registration UI at `/api/auth/register` before locking it behind invite-only if needed.

---

## 14. Sentry — observability

1. Create a project at [sentry.io](https://sentry.io)
2. Install the Next.js Sentry SDK: `npm install @sentry/nextjs`
3. Run `npx @sentry/wizard@latest -i nextjs` to generate `sentry.client.config.ts`, `sentry.server.config.ts`, and the Sentry plugin config in `next.config.mjs`

```bash
SENTRY_DSN=https://...@sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
```

---

## 15. Phase 11 multi-country schema — decision required

Phase 11 added `CountryTaxProfile`, `IncomeTaxBand`, and several `Business` fields (`countryCode`, `countryResolutionSource`, `taxProfileTemplateVersion`, `lastCountryConfirmedAt`) to the schema. These contradict the Sweden-only plan and are currently causing TypeScript errors in `app/api/reports/tax-estimate/route.ts`.

**Option A — Remove (recommended for Sweden-only):**

Delete the following from `prisma/schema.prisma`:
- `model CountryTaxProfile { ... }`
- `model IncomeTaxBand { ... }`
- The four `countryCode`, `countryResolutionSource`, `taxProfileTemplateVersion`, `lastCountryConfirmedAt` fields from `Business`
- The `countryTaxProfile CountryTaxProfile?` relation from `Business`

Then run `prisma db push --accept-data-loss` and delete the routes under `app/api/tax/profiles/` and `app/api/onboarding/country/`.

**Option B — Keep (if international expansion is planned):**

Fix the TypeScript errors in `app/api/reports/tax-estimate/route.ts` by updating the `CountryTaxProfileRow` type to use `Decimal` instead of `string | number`.

---

## Summary by urgency

| Priority | Item |
|---|---|
| **Must have before any user** | Supabase PostgreSQL, `SESSION_SECRET`, SMTP, first user creation |
| **Must have for core features** | `OPENAI_API_KEY`, Stripe, `STORAGE_PROVIDER=supabase` |
| **Must have for compliance features** | SKV API credentials, Kundhändelser cron, audit log calls in routes |
| **Must have for async at scale** | QStash (`QSTASH_TOKEN` + signing keys + public app URL) |
| **Requires third-party agreement** | BankID RP agreement + certificates, PEPPOL Access Point contract |
| **Requires future SKV API** | ID1 electronic submission |
| **Cleanup / decision** | Phase 11 multi-country schema, Sentry setup, session cleanup cron |
