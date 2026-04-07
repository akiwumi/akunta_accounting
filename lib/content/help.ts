export type HelpArticle = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  body: string;
};

export const helpArticles: HelpArticle[] = [
  {
    slug: "upload-a-receipt",
    title: "How to upload a receipt",
    excerpt: "Upload images or PDFs and let Akunta extract the data automatically.",
    category: "Receipts",
    body: `Go to **Receipts** in the sidebar, then click **Upload receipt**.

You can upload:
- JPEG or PNG images (photos of paper receipts)
- PDF files (digital receipts, invoices received as attachments)

Akunta will extract the vendor name, date, gross amount, VAT amount, and currency using OCR. High-contrast images give the best results.

After upload, the receipt appears in the Review queue if confidence is below 80% — check the extracted fields and correct any errors before approving.

**Tips for good OCR results**
- Photograph receipts on a flat, dark background.
- Ensure the full receipt is in frame with no clipping.
- Avoid shadows across the printed text.`
  },
  {
    slug: "import-bank-csv",
    title: "Importing bank transactions via CSV",
    excerpt: "Download your bank's CSV export and import it to create bookkeeping entries automatically.",
    category: "Bank & Transactions",
    body: `Most Swedish banks let you export transactions as a CSV file from their online banking portal.

**Supported formats**
Akunta's CSV importer handles SEB, Handelsbanken, Nordea, Swedbank, and generic CSV files with date/description/amount columns.

**How to import**
1. Download the CSV from your bank (usually under "Transactions" → "Export").
2. Go to **Bank CSV** in Akunta's sidebar.
3. Select your file and click **Import**.
4. Akunta creates a transaction and journal entry for each row.

**Duplicate detection**
Akunta checks for existing transactions on the same date with the same amount to avoid double-posting. If a duplicate is detected, the row is skipped and flagged in the import report.

**Reconciliation**
After import, open **Reconciliation** to match bank lines against existing transactions and mark them as reconciled.`
  },
  {
    slug: "generate-vat-report",
    title: "Generating a VAT report",
    excerpt: "Create a ready-to-submit momsdeklaration for any reporting period.",
    category: "Reports",
    body: `Go to **Reports** and select **VAT Report**.

Choose your reporting period (quarter or full year) and click **Generate**. Akunta calculates:

- **Box 05** — Taxable sales at 25%
- **Box 06** — Taxable sales at 12%
- **Box 07** — Taxable sales at 6%
- **Box 10** — Output VAT total
- **Box 20** — Input VAT (deductible purchases)
- **Box 49** — VAT payable or refundable

You can export the report as a PDF or submit it directly to Skatteverket from the **Compliance** page when the integration is enabled.

**Period locks**
Once you submit a VAT report, Akunta locks that period so historical transactions cannot be edited. You can view locked periods in **Settings → Period Locks**.`
  },
  {
    slug: "create-and-send-invoice",
    title: "Creating and sending an invoice",
    excerpt: "Create a professional invoice, add line items with VAT, and email it directly to your customer.",
    category: "Invoices",
    body: `Go to **Invoices** and click **New invoice**.

**Fill in the details**
- Customer name and email
- Issue date and due date
- Add line items: description, quantity, unit price, and VAT rate

Akunta calculates net, VAT, and gross amounts for each line and totals them automatically.

**Sending**
Click **Send** to email the invoice as a PDF attachment. You can customise the sender name, address, and logo in **Settings → Invoice settings**.

**Tracking payment**
When you receive payment, open the invoice and click **Mark as paid** (for full payment) or **Add partial payment**. Akunta creates the corresponding bookkeeping entry.

**Credit notes**
If you need to cancel or partially reverse an invoice, click **Issue credit note**. Akunta creates the credit note with correct reverse VAT entries.`
  },
  {
    slug: "payroll-approve-and-pay",
    title: "Approving and paying a salary",
    excerpt: "How the approval and payment flow works for salary entries in Akunta.",
    category: "Salaries & Payroll",
    body: `Go to **Salaries** and select the employee.

**Creating a salary entry**
Click **New salary entry**, enter the gross salary for the period, and Akunta calculates:
- Preliminary tax withheld
- Employer contributions (arbetsgivaravgifter)
- Pension contribution
- Net salary

**Approving**
Review the calculated figures and click **Approve**. The entry moves from DRAFT to APPROVED.

**Marking as paid**
Once you have transferred the net salary to the employee's bank account, click **Mark as paid**. Akunta posts the salary expense and tax liability journal entries and generates a payslip PDF.

**Employer declaration**
At month end, go to **Compliance → Payroll declarations** to review the arbetsgivardeklaration for the month and submit it to Skatteverket.`
  },
  {
    slug: "export-accounts-excel",
    title: "Exporting your accounts to Excel",
    excerpt: "Export the full year's bookkeeping as a structured Excel workbook for your accountant.",
    category: "Exports",
    body: `Go to the **Dashboard** and click **Export full accounts (Excel)**, or go to **Reports** and use the **Excel export** button.

The exported workbook contains separate sheets for:
- **P&L** — profit and loss by account
- **Balance sheet** — assets, liabilities, and equity
- **VAT summary** — input and output VAT by period
- **Ledger** — all journal lines in date order
- **Transactions** — all transactions with receipt/invoice references

Select the tax year from the dropdown before exporting to scope the data correctly.

The Excel file is compatible with all major spreadsheet applications and is formatted for handover to an accountant or for direct use in your income tax return (inkomstdeklaration).`
  }
];

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return helpArticles.find((a) => a.slug === slug);
}

export function getHelpArticlesByCategory(): Record<string, HelpArticle[]> {
  const grouped: Record<string, HelpArticle[]> = {};
  for (const article of helpArticles) {
    if (!grouped[article.category]) grouped[article.category] = [];
    grouped[article.category].push(article);
  }
  return grouped;
}
