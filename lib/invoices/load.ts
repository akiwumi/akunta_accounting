import { asNumber } from "@/lib/accounting/math";
import { prisma } from "@/lib/db";

export const loadInvoiceForOutput = async (input: { businessId: string; invoiceId: string }) => {
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: input.invoiceId,
      businessId: input.businessId
    },
    include: {
      business: {
        select: {
          name: true,
          invoiceSenderName: true,
          invoiceSenderAddress: true,
          invoiceSenderOrgNumber: true,
          invoiceSenderEmail: true,
          invoiceSenderPhone: true,
          invoiceSenderWebsite: true,
          invoiceEmailFrom: true
        }
      },
      items: {
        orderBy: { sortOrder: "asc" }
      },
      paidTransaction: {
        select: { id: true }
      }
    }
  });

  if (!invoice) return null;

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    projectName: invoice.projectName,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    description: invoice.description,
    notes: invoice.notes,
    paymentMethod: invoice.paymentMethod,
    paymentDetails: invoice.paymentDetails,
    currency: invoice.currency,
    status: invoice.status,
    sentAt: invoice.sentAt,
    paidAt: invoice.paidAt,
    emailTo: invoice.emailTo,
    customerName: invoice.customerName,
    customerEmail: invoice.customerEmail,
    customerPhone: invoice.customerPhone,
    customerWebsite: invoice.customerWebsite,
    customerAddress: invoice.customerAddress,
    senderName: invoice.senderName ?? invoice.business.invoiceSenderName ?? invoice.business.name,
    senderAddress: invoice.senderAddress ?? invoice.business.invoiceSenderAddress ?? null,
    senderOrgNumber: invoice.senderOrgNumber ?? invoice.business.invoiceSenderOrgNumber ?? null,
    senderEmail: invoice.senderEmail ?? invoice.business.invoiceSenderEmail ?? null,
    senderPhone: invoice.senderPhone ?? invoice.business.invoiceSenderPhone ?? null,
    senderWebsite: invoice.senderWebsite ?? invoice.business.invoiceSenderWebsite ?? null,
    logoDataUrl: invoice.logoDataUrl,
    signatureDataUrl: invoice.signatureDataUrl,
    subtotalAmount: asNumber(invoice.subtotalAmount),
    vatAmount: asNumber(invoice.vatAmount),
    grossAmount: asNumber(invoice.grossAmount),
    vatRate: asNumber(invoice.vatRate),
    paidTransactionId: invoice.paidTransaction?.id ?? null,
    businessInvoiceEmailFrom: invoice.business.invoiceEmailFrom,
    items: invoice.items.map((item) => ({
      id: item.id,
      sortOrder: item.sortOrder,
      description: item.description,
      quantity: asNumber(item.quantity),
      unitPrice: asNumber(item.unitPrice),
      vatMode: item.vatMode,
      vatRate: asNumber(item.vatRate),
      netAmount: asNumber(item.netAmount),
      vatAmount: asNumber(item.vatAmount),
      totalAmount: asNumber(item.totalAmount)
    }))
  };
};
