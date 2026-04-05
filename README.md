# NorthLedger

Sweden-first accounting web app for sole traders (`enskild firma`) with:

- `kontantmetoden` bookkeeping flow
- yearly VAT (`moms`) reporting support
- receipt capture (photo, PDF, and email webhook)
- manual receipt entry (no file upload needed)
- receipt deletion (with linked ledger transaction cleanup)
- payment received entry (manual income logging)
- dedicated ledger page for full transaction register
- input review pages for receipts and transaction entries
- inline review editing for receipt metadata and transaction details
- manual bank CSV import
- P&L, Balance Sheet, VAT report, tax estimate, and NE-bilaga draft
- one-click Excel workbook export
- architecture prepared for later EU/UK tax engine expansion

## Stack

- Next.js (App Router) + TypeScript
- Prisma + SQLite (local first)
- XLSX export
- Optional OpenAI-powered receipt extraction

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create env:

```bash
cp .env.example .env
```

3. Generate client and sync DB:

```bash
npm run prisma:generate
npm run db:push
npm run db:seed
```

4. Start app:

```bash
npm run dev
```

5. Open:

`http://localhost:3000`

## CSV Import Format

Required columns:

- `date`
- `description`
- `amount`

Optional columns:

- `vat_rate` (default `0.25`)
- `category` (e.g. `sales`, `office`, `bank_fee`)
- `currency` (default `SEK`)

## Receipt Email Forwarding

Send POST requests to:

- `/api/receipts/email-webhook`

Headers:

- `x-email-webhook-secret: <EMAIL_WEBHOOK_SECRET>`

Payload shape (Postmark-style):

```json
{
  "Subject": "Taxi receipt",
  "Attachments": [
    {
      "Name": "receipt.jpg",
      "ContentType": "image/jpeg",
      "Content": "<base64>"
    }
  ]
}
```

## Sweden Tax Notes

- Tax calculations are projections (for planning), not filing-grade legal output by default.
- Check and update tax-rate assumptions yearly in Settings before using results for declarations.
- NE-bilaga mapping is draft-level and should be reviewed per line before submission.

## EU/UK Expansion Path

Tax engines are modular under `lib/tax`:

- `sweden.ts` active
- `eu-template.ts` placeholder
- `uk-template.ts` placeholder

Add local-country rules per jurisdiction without changing receipt/import/report pipelines.

## Cloud + Local

- Local: SQLite (`DATABASE_URL=file:./dev.db`)
- Cloud: move Prisma datasource to PostgreSQL (EU-hosted), keep the same API/UI surface
# business_accounting
