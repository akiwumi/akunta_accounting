import { InvoicesManager } from "@/components/invoices/InvoicesManager";
import { SectionExportBar } from "@/components/layout/SectionExportBar";
import { asNumber } from "@/lib/accounting/math";
import { ensureBusiness } from "@/lib/data/business";
import { calendarMonthPeriod, calendarYearPeriod, parseMonth, parseTaxYear } from "@/lib/data/period";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";

type InvoicesPageProps = {
  searchParams?: {
    year?: string;
    month?: string;
    q?: string;
  };
};

export default async function InvoicesPage({ searchParams }: InvoicesPageProps) {
  const locale = getRequestLocale();
  const copy =
    locale === "sv"
      ? {
          title: "Fakturor",
          subtitle: "Skapa kundfakturor, e-posta PDF och följ betalstatus i huvudboken."
        }
      : {
          title: "Invoices",
          subtitle: "Create customer invoices, email PDF copies, and track payment status in the ledger."
        };

  const business = await ensureBusiness();
  const nowYear = new Date().getUTCFullYear();
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
  const period = selectedMonth ? calendarMonthPeriod(selectedYear, selectedMonth) : calendarYearPeriod(selectedYear);

  const invoices = await prisma.invoice.findMany({
    where: {
      businessId: business.id,
      issueDate: {
        gte: period.from,
        lte: period.to
      },
      ...(query
        ? {
            OR: [
              { invoiceNumber: { contains: query } },
              { customerName: { contains: query } },
              { projectName: { contains: query } }
            ]
          }
        : {})
    },
    include: {
      paidTransaction: {
        select: { id: true }
      }
    },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 500
  });

  const customers = await prisma.customer.findMany({
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
  });

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
        rows={invoices.map((invoice) => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          customerEmail: invoice.customerEmail,
          issueDate: invoice.issueDate.toISOString(),
          dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
          grossAmount: asNumber(invoice.grossAmount),
          currency: invoice.currency,
          status: invoice.status,
          paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
          sentAt: invoice.sentAt ? invoice.sentAt.toISOString() : null,
          paidTransactionId: invoice.paidTransaction?.id ?? null
        }))}
        customers={customers}
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
          defaultSignature: business.invoiceDefaultSignature ?? ""
        }}
        filters={{
          year: selectedYear,
          month: selectedMonth,
          query,
          yearOptions
        }}
      />
    </section>
  );
}
