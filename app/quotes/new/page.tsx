export const dynamic = "force-dynamic";

import Link from "next/link";

import { customerFromOption } from "@/lib/invoices/drafts";
import { QuoteForm } from "@/components/quotes/QuoteForm";
import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";
import { formatInvoiceNumber } from "@/lib/invoices/numbering";
import { stockholmToday } from "@/lib/invoices/dates";

type NewQuotePageProps = { searchParams?: Promise<{ customer?: string }> };

export default async function NewQuotePage(props: NewQuotePageProps) {
  const searchParams = await props.searchParams;
  const locale = await getRequestLocale();
  const sv = locale === "sv";
  const business = await ensureBusiness();

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
  const prefill = searchParams?.customer ? customers.find((customer) => customer.id === searchParams.customer) : undefined;
  const nextNumber = formatInvoiceNumber({
    pattern: business.quoteNumberPattern,
    sequence: business.nextQuoteSequence,
    issueDate: stockholmToday()
  });

  return (
    <section className="page">
      <p className="note">
        <Link className="textLink" href="/quotes">
          {sv ? "Alla offerter" : "All quotes"}
        </Link>
      </p>
      <h1 className="title">{sv ? "Ny offert" : "New quote"}</h1>
      <p className="subtitle">
        {sv
          ? `Får nummer ${nextNumber} när du sparar. En offert bokförs inte och kan ändras tills den blivit en faktura.`
          : `Gets number ${nextNumber} when you save. A quote is not booked and can be changed until it has become an invoice.`}
      </p>
      <article className="card">
        <QuoteForm
          locale={locale}
          customers={customers}
          vatRegistered={business.vatRegistered}
          defaultCurrency={business.baseCurrency}
          prefillCustomer={prefill ? customerFromOption(prefill) : null}
        />
      </article>
    </section>
  );
}
