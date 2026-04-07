export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  date: string; // ISO date string
  author: string;
  body: string; // Plain text / light markdown
};

export const blogPosts: BlogPost[] = [
  {
    slug: "getting-started-with-akunta",
    title: "Getting started with Akunta",
    excerpt: "A quick walkthrough of the core bookkeeping workflow — from uploading your first receipt to generating a VAT report.",
    date: "2026-03-01",
    author: "Akunta Team",
    body: `Akunta is designed for Swedish sole traders who want accurate books without an accountant on speed-dial.

**Step 1 — Upload receipts**
Drag a receipt image or PDF onto the Receipts page. Akunta's OCR engine extracts the vendor, amount, VAT, and date automatically.

**Step 2 — Import bank transactions**
Download your bank's CSV export and import it under Bank CSV. Each row becomes a bookkeeping entry, matched against your Swedish BAS chart of accounts.

**Step 3 — Review and approve**
The Review queue shows anything that needs your attention — currency conversions, missing VAT rates, or low-confidence OCR reads.

**Step 4 — Generate reports**
Head to Reports and generate your P&L, balance sheet, VAT summary, or NE-bilaga draft. Export the full workbook to Excel for your accountant.

That's it. Most users complete their first month's books in under 20 minutes.`
  },
  {
    slug: "understanding-swedish-vat",
    title: "Understanding Swedish VAT for sole traders",
    excerpt: "A plain-language guide to VAT rates, reporting periods, and when to file your momsdeklaration.",
    date: "2026-03-10",
    author: "Akunta Team",
    body: `Swedish VAT (moms) has three standard rates: 25%, 12%, and 6%. Most business purchases and sales use 25%.

**When do you need to register?**
If your annual turnover exceeds 80,000 SEK you must register for VAT with Skatteverket. Below that threshold, VAT registration is optional.

**Reporting periods**
- Annual (yearly): for businesses with turnover under 40 million SEK — file once per year.
- Quarterly: an option for businesses up to 40 million SEK.
- Monthly: required above 40 million SEK.

Akunta tracks your output VAT (charged on sales) and input VAT (paid on purchases) separately so the momsdeklaration calculation is always accurate.

**Input VAT deductions**
You can deduct VAT paid on business expenses. Keep your receipts — Akunta stores them with the original file attached to every transaction.

**Filing via Skatteverket**
Akunta generates a ready-to-submit momsdeklaration. When the Skatteverket integration is enabled, you can submit directly from the Compliance page.`
  },
  {
    slug: "bookkeeping-method-choice",
    title: "Kontantmetoden vs. fakturametoden — which should you choose?",
    excerpt: "The two Swedish bookkeeping methods have different cash-flow and VAT timing implications. Here's how to decide.",
    date: "2026-03-18",
    author: "Akunta Team",
    body: `Swedish sole traders can choose between two bookkeeping methods:

**Kontantmetoden (cash method)**
Revenue is recognised when payment is received. Expenses are recognised when paid. VAT is reported in the period cash moves.

Best for: service businesses with straightforward cash flows and no significant outstanding receivables.

**Fakturametoden (accrual/invoice method)**
Revenue is recognised when an invoice is issued. Expenses are recognised when billed. VAT is reported in the period the invoice is dated.

Best for: businesses with long payment terms, significant deferred income, or those who want GAAP-aligned books.

**Which does Akunta support?**
Both. You select your method in Settings. Akunta's posting engine automatically applies the correct journal entries and VAT timing rules based on your choice. Switching methods mid-year requires a reconciliation step — contact your accountant before changing.`
  },
  {
    slug: "payroll-for-sole-traders",
    title: "Running payroll as a Swedish sole trader",
    excerpt: "If you pay yourself or an employee a salary, here's what Skatteverket expects and how Akunta handles it.",
    date: "2026-03-25",
    author: "Akunta Team",
    body: `Many sole traders pay themselves a regular salary rather than taking ad-hoc owner withdrawals. This requires employer registration and monthly declarations.

**What you need to set up**
1. Register as an employer with Skatteverket.
2. Apply the correct tax table for each employee (including yourself if you pay a salary).
3. Withhold preliminary tax (preliminärskatt) each month.
4. Pay employer contributions (arbetsgivaravgifter) — currently 31.42% for most sole traders.

**Monthly obligations**
Each month you must submit an arbetsgivardeklaration to Skatteverket showing gross salary, withheld tax, and employer contributions. Payment is due by the 12th of the following month.

**How Akunta handles it**
The Salaries module lets you approve monthly salary entries for each employee. Akunta calculates withholding and contributions automatically using the rates you configure per employee. The Compliance page tracks declaration status and due dates.

Payslips are generated as PDF and can be emailed directly to employees.`
  }
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function getLatestBlogPosts(count: number): BlogPost[] {
  return [...blogPosts]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, count);
}
