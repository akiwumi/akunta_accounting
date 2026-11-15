export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";

import { emptyCustomer, itemsToDrafts } from "@/lib/invoices/drafts";
import { QuoteActions } from "@/components/quotes/QuoteActions";
import { QuoteForm } from "@/components/quotes/QuoteForm";
import { ensureBusiness } from "@/lib/data/business";
import { formatMoney } from "@/lib/data/format";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { isoDate, stockholmToday } from "@/lib/invoices/dates";
import { canEditQuote, effectiveQuoteStatus, loadQuoteForOutput, quoteStatusLabel } from "@/lib/invoices/quotes";

type QuotePageProps = { params: Promise<{ id: string }> };

export default async function QuotePage(props: QuotePageProps) {
  const { id } = await props.params;
  const locale = await getRequestLocale();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const business = await ensureBusiness();

  const quote = await loadQuoteForOutput(prisma, { businessId: business.id, quoteId: id });
  if (!quote) notFound();

  const [customers, linkedCustomer] = await Promise.all([
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
    quote.customerId
      ? prisma.customer.findFirst({ where: { id: quote.customerId, businessId: business.id } })
      : Promise.resolve(null)
  ]);

  const status = effectiveQuoteStatus(quote, stockholmToday());
  const editable = canEditQuote(quote.status);
  const money = (value: number) => formatMoney(value, quote.currency, numberLocale);

  const copy = sv
    ? {
        back: "Alla offerter",
        title: `Offert ${quote.quoteNumber}`,
        to: "Till",
        total: "Summa inkl. moms",
        validUntil: "Giltig till och med",
        sent: "Skickad",
        notSent: "Inte skickad ännu",
        edit: "Ändra offerten",
        editNote: "En offert är inget räkenskapsmaterial. Du kan ändra den fritt tills den gjorts om till en faktura.",
        lockedNote: "Offerten är fakturerad och sparas som den är, som underlag till fakturan.",
        lines: "Rader",
        description: "Beskrivning",
        quantity: "Antal",
        unitPrice: "Pris",
        vat: "Moms",
        amount: "Belopp",
        expiredNote: "Giltighetstiden har gått ut. Ändra datumet om offerten fortfarande gäller, eller gör om den till en faktura ändå."
      }
    : {
        back: "All quotes",
        title: `Quote ${quote.quoteNumber}`,
        to: "To",
        total: "Total incl. VAT",
        validUntil: "Valid until",
        sent: "Sent",
        notSent: "Not sent yet",
        edit: "Edit the quote",
        editNote: "A quote is not an accounting record. You can change it freely until it has been turned into an invoice.",
        lockedNote: "This quote has been invoiced and is kept as it is, as the basis for the invoice.",
        lines: "Lines",
        description: "Description",
        quantity: "Qty",
        unitPrice: "Price",
        vat: "VAT",
        amount: "Amount",
        expiredNote: "The quote has passed its valid until date. Change the date if it still stands, or turn it into an invoice anyway."
      };

  return (
    <section className="page">
      <p className="note">
        <Link className="textLink" href="/quotes">
          {copy.back}
        </Link>
      </p>
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">
        {copy.to}{" "}
        {quote.customerId ? (
          <Link className="textLink" href={`/customers/${quote.customerId}`}>
            {quote.customerName}
          </Link>
        ) : (
          quote.customerName
        )}{" "}
        <span className={status === "ACCEPTED" || status === "INVOICED" ? "badge good" : status === "EXPIRED" ? "badge warn" : "badge"}>
          {quoteStatusLabel(status, locale)}
        </span>
      </p>

      <div className="grid">
        <article className="card">
          <p className="label">{copy.total}</p>
          <p className="kpi">{money(quote.grossAmount)}</p>
        </article>
        <article className="card">
          <p className="label">{copy.validUntil}</p>
          <p className="kpi">{quote.validUntil ? isoDate(quote.validUntil) : "-"}</p>
        </article>
        <article className="card">
          <p className="label">{copy.sent}</p>
          <p className="kpi">{quote.sentAt ? isoDate(quote.sentAt) : "-"}</p>
          {!quote.sentAt && <p className="note">{copy.notSent}</p>}
        </article>
      </div>

      <article className="card">
        <div className="stack">
          {status === "EXPIRED" && <p className="note">{copy.expiredNote}</p>}
          <QuoteActions
            locale={locale}
            variant="detail"
            quote={{
              id: quote.id,
              quoteNumber: quote.quoteNumber,
              customerEmail: quote.customerEmail,
              status,
              invoice: quote.invoice
            }}
          />
        </div>
      </article>

      {editable ? (
        <article className="card">
          <h2>{copy.edit}</h2>
          <p className="note" style={{ marginBottom: 12 }}>
            {copy.editNote}
          </p>
          <QuoteForm
            locale={locale}
            quoteId={quote.id}
            customers={customers}
            vatRegistered={business.vatRegistered}
            defaultCurrency={business.baseCurrency}
            initial={{
              customer: {
                ...emptyCustomer(),
                id: quote.customerId ?? undefined,
                name: quote.customerName,
                email: quote.customerEmail ?? "",
                phone: linkedCustomer?.phone ?? "",
                website: linkedCustomer?.website ?? "",
                addressLine1: linkedCustomer?.addressLine1 ?? quote.customerAddress ?? "",
                addressLine2: linkedCustomer?.addressLine2 ?? "",
                postalCode: linkedCustomer?.postalCode ?? "",
                city: linkedCustomer?.city ?? "",
                country: linkedCustomer?.country ?? ""
              },
              projectName: quote.projectName ?? "",
              description: quote.description ?? "",
              notes: quote.notes ?? "",
              issueDate: isoDate(quote.issueDate),
              validUntil: quote.validUntil ? isoDate(quote.validUntil) : "",
              currency: quote.currency,
              items: itemsToDrafts(quote.items)
            }}
          />
        </article>
      ) : (
        <article className="card">
          <h2>{copy.lines}</h2>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.description}</th>
                  <th>{copy.quantity}</th>
                  <th>{copy.unitPrice}</th>
                  <th>{copy.vat}</th>
                  <th>{copy.amount}</th>
                </tr>
              </thead>
              <tbody>
                {quote.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td>{item.quantity}</td>
                    <td>{money(item.unitPrice)}</td>
                    <td>{money(item.vatAmount)}</td>
                    <td>{money(item.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ marginTop: 12 }}>
            {copy.lockedNote}
          </p>
        </article>
      )}
    </section>
  );
}
