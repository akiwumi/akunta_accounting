export const dynamic = "force-dynamic";

import { InvoicesManager } from "@/components/invoices/InvoicesManager";
import { RotRutRequests } from "@/components/invoices/RotRutRequests";
import { SectionExportBar } from "@/components/layout/SectionExportBar";
import { ensureBusiness } from "@/lib/data/business";
import { calendarMonthPeriod, calendarYearPeriod, parseMonth, parseTaxYear } from "@/lib/data/period";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { invoiceBalanceInclude } from "@/lib/invoices/balance";
import { computeInvoiceTotals } from "@/lib/invoices/calculations";
import { stockholmToday } from "@/lib/invoices/dates";
import { paymentAccountLines } from "@/lib/invoices/payment-accounts";
import { parseRecurringItems, recurringState } from "@/lib/invoices/recurring";
import { loadRotRutQueue } from "@/lib/invoices/rotrut-actions";
import { summarizeOpenInvoices, toInvoiceRow } from "@/lib/invoices/view";

type InvoicesPageProps = {
  searchParams?: Promise<{
    year?: string;
    month?: string;
    q?: string;
    show?: string;
    customer?: string;
  }>;
};

export default async function InvoicesPage(props: InvoicesPageProps) {
  const searchParams = await props.searchParams;
  const locale = await getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Fakturor",
          subtitle: "Skapa en faktura, skicka den och se direkt vad som är betalt, obetalt och försenat."
        }
      : {
          title: "Invoices",
          subtitle: "Create an invoice, send it and see at a glance what is paid, unpaid and overdue."
        };

  const business = await ensureBusiness();
  const today = stockholmToday();
  const accrual = business.bookkeepingMethod === "fakturametoden";
  const nowYear = today.getUTCFullYear();
  const minIssue = await prisma.invoice.aggregate({
    where: { businessId: business.id },
    _min: { issueDate: true }
  });
  const minYear = minIssue._min.issueDate?.getUTCFullYear() ?? nowYear;
  const startYear = Math.min(minYear, nowYear);
  const yearOptions = Array.from({ length: nowYear - startYear + 1 }, (_item, index) => nowYear - index);

  const requestedYear = parseTaxYear(searchParams?.year);
  const selectedYear =
    requestedYear && requestedYear >= startYear && requestedYear <= nowYear ? requestedYear : nowYear;
  const selectedMonth = parseMonth(searchParams?.month);
  const query = searchParams?.q?.trim() || "";
  const show = searchParams?.show === "open" || searchParams?.show === "overdue" ? searchParams.show : "period";
  const period = selectedMonth ? calendarMonthPeriod(selectedYear, selectedMonth) : calendarYearPeriod(selectedYear);

  const search = query
    ? {
        OR: [
          { invoiceNumber: { contains: query, mode: "insensitive" as const } },
          { customerName: { contains: query, mode: "insensitive" as const } },
          { projectName: { contains: query, mode: "insensitive" as const } },
          { ocrReference: { contains: query } }
        ]
      }
    : {};

  const [periodInvoices, openInvoices, customers, templates, rotRutQueue] = await Promise.all([
    show === "period"
      ? prisma.invoice.findMany({
          where: { businessId: business.id, issueDate: { gte: period.from, lte: period.to }, ...search },
          include: invoiceBalanceInclude,
          orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
          take: 500
        })
      : Promise.resolve([]),
    // Everything not yet settled, whatever the period: the basis for the totals and the "unpaid" views.
    prisma.invoice.findMany({
      where: { businessId: business.id, status: { in: ["UNPAID", "PARTIAL"] } },
      include: invoiceBalanceInclude,
      orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }],
      take: 1000
    }),
    prisma.customer.findMany({
      where: { businessId: business.id },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 300,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        website: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        postalCode: true,
        country: true
      }
    }),
    prisma.recurringInvoice.findMany({
      where: { businessId: business.id },
      orderBy: [{ active: "desc" }, { nextRunDate: "asc" }],
      include: { _count: { select: { invoices: true } } },
      take: 200
    }),
    // ROT/RUT invoices Skatteverket has not paid yet. The rows carry the personnummer masked only.
    loadRotRutQueue(prisma, { businessId: business.id, today })
  ]);

  const openRows = openInvoices.map((invoice) => toInvoiceRow(invoice, today, locale, accrual)).filter((row) => row.remaining > 0);
  // Totals are in the business currency; invoices in other currencies are listed but not summed in.
  const totals = summarizeOpenInvoices(openRows.filter((row) => row.currency === business.baseCurrency));

  const matchesQuery = (row: { invoiceNumber: string; customerName: string }) =>
    !query || `${row.invoiceNumber} ${row.customerName}`.toLowerCase().includes(query.toLowerCase());
  const rows =
    show === "period"
      ? periodInvoices.map((invoice) => toInvoiceRow(invoice, today, locale, accrual))
      : openRows.filter((row) => (show === "overdue" ? row.overdue : true)).filter(matchesQuery);

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>
      <SectionExportBar
        locale={locale}
        section="invoices"
        params={{
          year: String(selectedYear),
          month: selectedMonth ? String(selectedMonth) : undefined,
          q: query || undefined
        }}
      />

      <InvoicesManager
        locale={locale}
        afterSummary={<RotRutRequests locale={locale} rows={rotRutQueue.rows} />}
        rows={rows}
        customers={customers}
        prefillCustomerId={searchParams?.customer ?? null}
        totals={{ ...totals, currency: business.baseCurrency }}
        recurring={templates.map((template) => ({
          id: template.id,
          customerId: template.customerId,
          customerName: template.customerName,
          description: template.description,
          frequency: template.frequency,
          nextRunDate: template.nextRunDate.toISOString(),
          endDate: template.endDate ? template.endDate.toISOString() : null,
          autoSend: template.autoSend,
          state: recurringState(template, today),
          currency: template.currency,
          grossAmount: computeInvoiceTotals(parseRecurringItems(template.itemsJson)).grossAmount,
          invoiceCount: template._count.invoices
        }))}
        defaults={{
          businessName: business.name,
          invoiceNumberPattern: business.invoiceNumberPattern,
          nextInvoiceSequence: business.nextInvoiceSequence,
          senderName: business.invoiceSenderName ?? business.name,
          senderAddress: business.invoiceSenderAddress ?? "",
          senderOrgNumber: business.invoiceSenderOrgNumber ?? "",
          senderEmail: business.invoiceSenderEmail ?? "",
          senderPhone: business.invoiceSenderPhone ?? "",
          senderWebsite: business.invoiceSenderWebsite ?? "",
          defaultLogo: business.invoiceDefaultLogo ?? "",
          defaultSignature: business.invoiceDefaultSignature ?? "",
          paymentTermsDays: business.defaultPaymentTermsDays,
          vatRegistered: business.vatRegistered,
          fSkattRegistered: business.fSkattRegistered,
          accrual,
          currency: business.baseCurrency,
          paymentLines: paymentAccountLines(business)
        }}
        filters={{
          year: selectedYear,
          month: selectedMonth,
          query,
          show,
          yearOptions
        }}
      />
    </section>
  );
}
