"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { formatMoney } from "@/lib/data/format";
import { computeInvoiceTotals, normalizeVatRate } from "@/lib/invoices/calculations";
import { formatInvoiceNumber } from "@/lib/invoices/numbering";
import { InvoiceVatModes, type InvoiceVatMode } from "@/lib/invoices/types";
import { type Locale } from "@/lib/i18n/locale";

type InvoiceItemDraft = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatMode: InvoiceVatMode;
  vatRate: string;
};

type CustomerDraft = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  country: string;
};

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string | null;
  issueDate: string;
  dueDate: string | null;
  grossAmount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  sentAt: string | null;
  paidTransactionId: string | null;
};

type CustomerOption = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
};

type InvoicesManagerProps = {
  locale: Locale;
  rows: InvoiceRow[];
  customers: CustomerOption[];
  defaults: {
    businessName: string;
    invoiceNumberPattern: string;
    nextInvoiceSequence: number;
    senderName: string;
    senderAddress: string;
    senderOrgNumber: string;
    senderEmail: string;
    senderPhone: string;
    senderWebsite: string;
    defaultLogo: string;
    defaultSignature: string;
  };
  filters: {
    year: number;
    month: number | null;
    query: string;
    yearOptions: number[];
  };
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const dueDateIso = (days = 14) => {
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + days);
  return target.toISOString().slice(0, 10);
};

const makeItem = (overrides: Partial<InvoiceItemDraft> = {}): InvoiceItemDraft => ({
  key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  description: "",
  quantity: "1",
  unitPrice: "",
  vatMode: InvoiceVatModes.NO_VAT,
  vatRate: "0.25",
  ...overrides
});

const toNumber = (value: string) => Number(value.replace(",", "."));

const readFileAsDataUrl = async (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read selected file."));
    reader.readAsDataURL(file);
  });

export const InvoicesManager = ({ locale, rows, customers, defaults, filters }: InvoicesManagerProps) => {
  const router = useRouter();
  const numberLocale = locale === "sv" ? "sv-SE" : "en-GB";

  const copy =
    locale === "sv"
      ? {
          createTitle: "Skapa ny faktura",
          previewTitle: "Förhandsvisning",
          saveInvoice: "Spara faktura",
          savingInvoice: "Sparar...",
          invoiceSaved: "Faktura skapad.",
          createFailed: "Kunde inte skapa fakturan.",
          unknownError: "Okänt fel",
          invoiceNumber: "Fakturanummer",
          usePatternNumber: "Använd mönsternummer",
          project: "Projekt",
          issueDate: "Fakturadatum",
          dueDate: "Förfallodatum",
          currency: "Valuta",
          myDetails: "Mina uppgifter",
          clientDetails: "Kunduppgifter",
          paymentDetails: "Betalningsuppgifter",
          addNotes: "Anteckning",
          addSignature: "Signatur och logotyp",
          emailDetails: "E-post",
          senderName: "Avsändare",
          senderAddress: "Adress",
          senderOrg: "Org.nr",
          senderEmail: "E-post",
          senderPhone: "Telefon",
          senderWebsite: "Webbplats",
          customerName: "Kundnamn",
          customerEmail: "Kundens e-post",
          customerPhone: "Kundens telefon",
          customerWebsite: "Kundens webbplats",
          customerAddress1: "Adressrad 1",
          customerAddress2: "Adressrad 2",
          customerPostal: "Postnummer",
          customerCity: "Stad",
          customerCountry: "Land",
          saveCustomer: "Spara kundprofil",
          customerSaved: "Kundprofil sparad.",
          itemsTitle: "Fakturarader",
          description: "Beskrivning",
          units: "Antal",
          price: "Pris",
          vatMode: "Momsläge",
          noVat: "Ingen moms",
          vatInc: "Inkl. moms",
          vatEx: "Exkl. moms",
          vatRate: "Momssats",
          addItem: "Lägg till rad",
          remove: "Radera",
          subtotal: "Delsumma",
          vatAmount: "Moms",
          total: "Totalt",
          notes: "Notering",
          paymentMethod: "Betalningsmetod",
          paymentInfo: "Betalningsinstruktion",
          emailTo: "E-post till faktura",
          logo: "Logotyp",
          signature: "Signatur",
          clearImage: "Rensa",
          savePdf: "PDF",
          emailPdf: "E-posta",
          emailPrompt: "Ange e-postadress för fakturan",
          emailing: "Skickar...",
          emailed: "Fakturan skickades.",
          emailFailed: "Kunde inte e-posta fakturan.",
          invoiceListTitle: "Fakturor",
          filterTitle: "Sök fakturor",
          year: "År",
          month: "Månad",
          allMonths: "Alla månader",
          search: "Sök",
          searchPlaceholder: "Fakturanummer, kund eller projekt",
          filter: "Filtrera",
          status: "Status",
          paid: "Betald",
          unpaid: "Obetald",
          paidDate: "Betald datum",
          sentDate: "Skickad",
          action: "Åtgärd",
          paymentDatePrompt: "Ange betalningsdatum (ÅÅÅÅ-MM-DD)",
          markPaid: "Markera betald",
          markingPaid: "Markerar...",
          payFailed: "Kunde inte markera fakturan som betald.",
          reviewPayment: "Granska betalning",
          downloadPdf: "Ladda ner PDF",
          noInvoices: "Inga fakturor hittades.",
          notSavedYet: "Spara fakturan först för PDF/e-post."
        }
      : {
          createTitle: "Create New Invoice",
          previewTitle: "Preview",
          saveInvoice: "Save Invoice",
          savingInvoice: "Saving...",
          invoiceSaved: "Invoice created.",
          createFailed: "Failed to create invoice.",
          unknownError: "Unknown error",
          invoiceNumber: "Invoice Number",
          usePatternNumber: "Use pattern number",
          project: "Project",
          issueDate: "Issue Date",
          dueDate: "Due Date",
          currency: "Currency",
          myDetails: "My Details",
          clientDetails: "Client Details",
          paymentDetails: "Payment Details",
          addNotes: "Add Notes",
          addSignature: "Add Signature",
          emailDetails: "Email Details",
          senderName: "Sender name",
          senderAddress: "Address",
          senderOrg: "Registration no.",
          senderEmail: "Email",
          senderPhone: "Phone",
          senderWebsite: "Website",
          customerName: "Customer name",
          customerEmail: "Customer email",
          customerPhone: "Customer phone",
          customerWebsite: "Customer website",
          customerAddress1: "Address line 1",
          customerAddress2: "Address line 2",
          customerPostal: "Postal code",
          customerCity: "City",
          customerCountry: "Country",
          saveCustomer: "Save customer profile",
          customerSaved: "Customer profile saved.",
          itemsTitle: "Invoice Items",
          description: "Description",
          units: "Units",
          price: "Price",
          vatMode: "VAT Mode",
          noVat: "No VAT",
          vatInc: "Incl. VAT",
          vatEx: "Excl. VAT",
          vatRate: "VAT Rate",
          addItem: "Add item",
          remove: "Remove",
          subtotal: "Subtotal",
          vatAmount: "VAT",
          total: "Total Amount",
          notes: "Note",
          paymentMethod: "Payment method",
          paymentInfo: "Payment instructions",
          emailTo: "Invoice email",
          logo: "Logo",
          signature: "Signature",
          clearImage: "Clear",
          savePdf: "PDF",
          emailPdf: "Email",
          emailPrompt: "Enter recipient email",
          emailing: "Emailing...",
          emailed: "Invoice emailed.",
          emailFailed: "Failed to email invoice.",
          invoiceListTitle: "Invoices",
          filterTitle: "Search Invoices",
          year: "Year",
          month: "Month",
          allMonths: "All months",
          search: "Search",
          searchPlaceholder: "Invoice number, customer or project",
          filter: "Filter",
          status: "Status",
          paid: "Paid",
          unpaid: "Unpaid",
          paidDate: "Paid Date",
          sentDate: "Sent",
          action: "Action",
          paymentDatePrompt: "Enter payment date (YYYY-MM-DD)",
          markPaid: "Mark as paid",
          markingPaid: "Marking...",
          payFailed: "Failed to mark invoice as paid.",
          reviewPayment: "Review payment",
          downloadPdf: "Download PDF",
          noInvoices: "No invoices found.",
          notSavedYet: "Save the invoice first to use PDF and email."
        };

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceNumberTouched, setInvoiceNumberTouched] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(dueDateIso(14));
  const [currency, setCurrency] = useState("SEK");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Bank transfer");
  const [paymentDetails, setPaymentDetails] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [senderName, setSenderName] = useState(defaults.senderName || defaults.businessName);
  const [senderAddress, setSenderAddress] = useState(defaults.senderAddress || "");
  const [senderOrg, setSenderOrg] = useState(defaults.senderOrgNumber || "");
  const [senderEmail, setSenderEmail] = useState(defaults.senderEmail || "");
  const [senderPhone, setSenderPhone] = useState(defaults.senderPhone || "");
  const [senderWebsite, setSenderWebsite] = useState(defaults.senderWebsite || "");
  const [logoDataUrl, setLogoDataUrl] = useState(defaults.defaultLogo || "");
  const [signatureDataUrl, setSignatureDataUrl] = useState(defaults.defaultSignature || "");
  const [customer, setCustomer] = useState<CustomerDraft>({
    name: "",
    email: "",
    phone: "",
    website: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    postalCode: "",
    country: ""
  });
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>(customers);
  const [items, setItems] = useState<InvoiceItemDraft[]>([
    makeItem({
      description: "",
      quantity: "1",
      unitPrice: ""
    })
  ]);
  const [saving, setSaving] = useState(false);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastSavedInvoiceId, setLastSavedInvoiceId] = useState<string | null>(null);

  const suggestedInvoiceNumber = useMemo(() => {
    const parsedIssueDate = new Date(`${issueDate}T00:00:00.000Z`);
    if (Number.isNaN(parsedIssueDate.valueOf())) return "";
    return formatInvoiceNumber({
      pattern: defaults.invoiceNumberPattern,
      sequence: defaults.nextInvoiceSequence,
      issueDate: parsedIssueDate
    });
  }, [defaults.invoiceNumberPattern, defaults.nextInvoiceSequence, issueDate]);

  useEffect(() => {
    if (!invoiceNumberTouched) {
      setInvoiceNumber(suggestedInvoiceNumber);
    }
  }, [invoiceNumberTouched, suggestedInvoiceNumber]);

  const computed = useMemo(
    () =>
      computeInvoiceTotals(
        items.map((item) => ({
          description: item.description,
          quantity: toNumber(item.quantity || "0"),
          unitPrice: toNumber(item.unitPrice || "0"),
          vatMode: item.vatMode,
          vatRate: normalizeVatRate(toNumber(item.vatRate || "0"))
        }))
      ),
    [items]
  );

  const monthLabels = useMemo(
    () =>
      Array.from({ length: 12 }).map((_value, index) => ({
        value: index + 1,
        label: new Intl.DateTimeFormat(numberLocale, { month: "long" }).format(
          new Date(Date.UTC(2026, index, 1))
        )
      })),
    [numberLocale]
  );

  const customerSuggestions = useMemo(() => {
    const q = customer.name.trim().toLowerCase();
    if (!q) return customerOptions.slice(0, 6);
    return customerOptions
      .filter((option) => {
        const haystack = [option.name, option.email ?? "", option.phone ?? ""].join(" ").toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 6);
  }, [customer.name, customerOptions]);

  const customerAddressPreview = [
    customer.addressLine1,
    customer.addressLine2,
    customer.postalCode,
    customer.city,
    customer.country
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");

  const resetDraft = () => {
    setInvoiceNumberTouched(false);
    setProjectName("");
    setDescription("");
    setNotes("");
    setIssueDate(todayIso());
    setDueDate(dueDateIso(14));
    setCurrency("SEK");
    setCustomer({
      name: "",
      email: "",
      phone: "",
      website: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      postalCode: "",
      country: ""
    });
    setItems([makeItem()]);
    setEmailTo("");
  };

  const updateItem = (key: string, patch: Partial<InvoiceItemDraft>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const onSaveCustomer = async () => {
    if (!customer.name.trim()) return;
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customer.name.trim(),
          email: customer.email.trim() || undefined,
          phone: customer.phone.trim() || undefined,
          website: customer.website.trim() || undefined,
          addressLine1: customer.addressLine1.trim() || undefined,
          addressLine2: customer.addressLine2.trim() || undefined,
          city: customer.city.trim() || undefined,
          postalCode: customer.postalCode.trim() || undefined,
          country: customer.country.trim() || undefined
        })
      });
      const json = (await response.json()) as { error?: string; customer?: CustomerOption };
      if (!response.ok || !json.customer) {
        throw new Error(json.error ?? copy.unknownError);
      }

      setCustomer((current) => ({ ...current, id: json.customer!.id }));
      setCustomerOptions((current) => [json.customer!, ...current.filter((item) => item.id !== json.customer!.id)]);
      setSuccess(copy.customerSaved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.unknownError);
    }
  };

  const onCreateInvoice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: invoiceNumber.trim() || undefined,
          projectName: projectName.trim() || undefined,
          description: description.trim() || undefined,
          notes: notes.trim() || undefined,
          issueDate,
          dueDate: dueDate || undefined,
          currency,
          paymentMethod: paymentMethod.trim() || undefined,
          paymentDetails: paymentDetails.trim() || undefined,
          emailTo: emailTo.trim() || undefined,
          logoDataUrl: logoDataUrl || undefined,
          signatureDataUrl: signatureDataUrl || undefined,
          sender: {
            name: senderName.trim() || undefined,
            address: senderAddress.trim() || undefined,
            registration: senderOrg.trim() || undefined,
            email: senderEmail.trim() || undefined,
            phone: senderPhone.trim() || undefined,
            website: senderWebsite.trim() || undefined
          },
          customer: {
            id: customer.id || undefined,
            name: customer.name.trim(),
            email: customer.email.trim() || undefined,
            phone: customer.phone.trim() || undefined,
            website: customer.website.trim() || undefined,
            addressLine1: customer.addressLine1.trim() || undefined,
            addressLine2: customer.addressLine2.trim() || undefined,
            city: customer.city.trim() || undefined,
            postalCode: customer.postalCode.trim() || undefined,
            country: customer.country.trim() || undefined
          },
          items: items.map((item) => ({
            description: item.description,
            quantity: toNumber(item.quantity || "0"),
            unitPrice: toNumber(item.unitPrice || "0"),
            vatMode: item.vatMode,
            vatRate: normalizeVatRate(toNumber(item.vatRate || "0"))
          }))
        })
      });

      const json = (await response.json()) as {
        error?: string;
        invoice?: {
          id: string;
        };
      };

      if (!response.ok || !json.invoice) {
        throw new Error(json.error ?? copy.createFailed);
      }

      setLastSavedInvoiceId(json.invoice.id);
      setSuccess(copy.invoiceSaved);
      resetDraft();
      router.refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : copy.unknownError);
    } finally {
      setSaving(false);
    }
  };

  const onMarkPaid = async (invoiceId: string) => {
    const paymentDate = window.prompt(copy.paymentDatePrompt, todayIso());
    if (!paymentDate) return;

    setPayingId(invoiceId);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentDate })
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? copy.payFailed);
      }
      router.refresh();
    } catch (payError) {
      setError(payError instanceof Error ? payError.message : copy.unknownError);
    } finally {
      setPayingId(null);
    }
  };

  const onEmailInvoice = async (invoiceId: string, preferredEmail: string | null) => {
    const to = window.prompt(copy.emailPrompt, preferredEmail ?? emailTo ?? "");
    if (!to) return;

    setEmailingId(invoiceId);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/invoices/${invoiceId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to })
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? copy.emailFailed);
      }
      setSuccess(copy.emailed);
      router.refresh();
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : copy.unknownError);
    } finally {
      setEmailingId(null);
    }
  };

  const onImageSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
    setter: (value: string) => void
  ) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setter(dataUrl);
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : copy.unknownError);
    } finally {
      event.currentTarget.value = "";
    }
  };

  return (
    <div className="stack">
      <section className="invoiceWorkspace" id="new-invoice">
        <form className="invoiceBuilder card" onSubmit={onCreateInvoice}>
          <h2>{copy.createTitle}</h2>
          <p className="note">{copy.notSavedYet}</p>

          <details open>
            <summary>{copy.myDetails}</summary>
            <div className="stack invoiceSectionBody">
              <label className="stack">
                {copy.senderName}
                <input value={senderName} onChange={(event) => setSenderName(event.target.value)} />
              </label>
              <label className="stack">
                {copy.senderAddress}
                <textarea rows={3} value={senderAddress} onChange={(event) => setSenderAddress(event.target.value)} />
              </label>
              <div className="row">
                <label className="stack">
                  {copy.senderOrg}
                  <input value={senderOrg} onChange={(event) => setSenderOrg(event.target.value)} />
                </label>
                <label className="stack">
                  {copy.senderEmail}
                  <input type="email" value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)} />
                </label>
              </div>
              <div className="row">
                <label className="stack">
                  {copy.senderPhone}
                  <input value={senderPhone} onChange={(event) => setSenderPhone(event.target.value)} />
                </label>
                <label className="stack">
                  {copy.senderWebsite}
                  <input value={senderWebsite} onChange={(event) => setSenderWebsite(event.target.value)} />
                </label>
              </div>
            </div>
          </details>

          <details open>
            <summary>{copy.clientDetails}</summary>
            <div className="stack invoiceSectionBody">
              <label className="stack">
                {copy.customerName}
                <input
                  value={customer.name}
                  onChange={(event) =>
                    setCustomer((current) => ({ ...current, id: undefined, name: event.target.value }))
                  }
                  required
                />
              </label>

              {customerSuggestions.length > 0 && customer.name.trim().length > 0 && (
                <div className="invoiceCustomerSuggestions">
                  {customerSuggestions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="invoiceCustomerOption"
                      onClick={() =>
                        setCustomer({
                          id: option.id,
                          name: option.name,
                          email: option.email ?? "",
                          phone: option.phone ?? "",
                          website: option.website ?? "",
                          addressLine1: option.addressLine1 ?? "",
                          addressLine2: option.addressLine2 ?? "",
                          city: option.city ?? "",
                          postalCode: option.postalCode ?? "",
                          country: option.country ?? ""
                        })
                      }
                    >
                      <strong>{option.name}</strong>
                      <span>{option.email ?? "-"}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="row">
                <label className="stack">
                  {copy.customerEmail}
                  <input
                    type="email"
                    value={customer.email}
                    onChange={(event) => setCustomer((current) => ({ ...current, email: event.target.value }))}
                  />
                </label>
                <label className="stack">
                  {copy.customerPhone}
                  <input
                    value={customer.phone}
                    onChange={(event) => setCustomer((current) => ({ ...current, phone: event.target.value }))}
                  />
                </label>
              </div>
              <div className="row">
                <label className="stack">
                  {copy.customerWebsite}
                  <input
                    value={customer.website}
                    onChange={(event) => setCustomer((current) => ({ ...current, website: event.target.value }))}
                  />
                </label>
              </div>
              <label className="stack">
                {copy.customerAddress1}
                <input
                  value={customer.addressLine1}
                  onChange={(event) =>
                    setCustomer((current) => ({ ...current, addressLine1: event.target.value }))
                  }
                />
              </label>
              <label className="stack">
                {copy.customerAddress2}
                <input
                  value={customer.addressLine2}
                  onChange={(event) =>
                    setCustomer((current) => ({ ...current, addressLine2: event.target.value }))
                  }
                />
              </label>
              <div className="row">
                <label className="stack">
                  {copy.customerPostal}
                  <input
                    value={customer.postalCode}
                    onChange={(event) =>
                      setCustomer((current) => ({ ...current, postalCode: event.target.value }))
                    }
                  />
                </label>
                <label className="stack">
                  {copy.customerCity}
                  <input
                    value={customer.city}
                    onChange={(event) => setCustomer((current) => ({ ...current, city: event.target.value }))}
                  />
                </label>
                <label className="stack">
                  {copy.customerCountry}
                  <input
                    value={customer.country}
                    onChange={(event) => setCustomer((current) => ({ ...current, country: event.target.value }))}
                  />
                </label>
              </div>
              <div className="row">
                <button type="button" className="secondary" onClick={onSaveCustomer}>
                  {copy.saveCustomer}
                </button>
              </div>
            </div>
          </details>

          <details open>
            <summary>{copy.itemsTitle}</summary>
            <div className="stack invoiceSectionBody">
              <div className="row">
                <label className="stack">
                  {copy.invoiceNumber}
                  <input
                    value={invoiceNumber}
                    onChange={(event) => {
                      setInvoiceNumberTouched(true);
                      setInvoiceNumber(event.target.value);
                    }}
                    required
                  />
                </label>
                <label className="stack">
                  {copy.project}
                  <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
                </label>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setInvoiceNumberTouched(false);
                  setInvoiceNumber(suggestedInvoiceNumber);
                }}
              >
                {copy.usePatternNumber}
              </button>
              <div className="row">
                <label className="stack">
                  {copy.issueDate}
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(event) => setIssueDate(event.target.value)}
                    required
                  />
                </label>
                <label className="stack">
                  {copy.dueDate}
                  <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                </label>
                <label className="stack">
                  {copy.currency}
                  <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                    <option value="SEK">SEK</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </label>
              </div>

              {items.map((item) => (
                <div key={item.key} className="invoiceItemCard">
                  <div className="row">
                    <label className="stack" style={{ flex: 1 }}>
                      {copy.description}
                      <input
                        value={item.description}
                        onChange={(event) => updateItem(item.key, { description: event.target.value })}
                        required
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}
                      disabled={items.length <= 1}
                    >
                      {copy.remove}
                    </button>
                  </div>
                  <div className="row">
                    <label className="stack">
                      {copy.units}
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={item.quantity}
                        onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                        required
                      />
                    </label>
                    <label className="stack">
                      {copy.price}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                        required
                      />
                    </label>
                    <label className="stack">
                      {copy.vatRate}
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={item.vatRate}
                        onChange={(event) => updateItem(item.key, { vatRate: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label>
                      <input
                        type="radio"
                        checked={item.vatMode === InvoiceVatModes.NO_VAT}
                        onChange={() => updateItem(item.key, { vatMode: InvoiceVatModes.NO_VAT })}
                      />{" "}
                      {copy.noVat}
                    </label>
                    <label>
                      <input
                        type="radio"
                        checked={item.vatMode === InvoiceVatModes.INCLUSIVE}
                        onChange={() => updateItem(item.key, { vatMode: InvoiceVatModes.INCLUSIVE })}
                      />{" "}
                      {copy.vatInc}
                    </label>
                    <label>
                      <input
                        type="radio"
                        checked={item.vatMode === InvoiceVatModes.EXCLUSIVE}
                        onChange={() => updateItem(item.key, { vatMode: InvoiceVatModes.EXCLUSIVE })}
                      />{" "}
                      {copy.vatEx}
                    </label>
                  </div>
                </div>
              ))}

              <button type="button" className="secondary" onClick={() => setItems((current) => [...current, makeItem()])}>
                {copy.addItem}
              </button>
            </div>
          </details>

          <details>
            <summary>{copy.paymentDetails}</summary>
            <div className="stack invoiceSectionBody">
              <label className="stack">
                {copy.paymentMethod}
                <input value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} />
              </label>
              <label className="stack">
                {copy.paymentInfo}
                <textarea rows={4} value={paymentDetails} onChange={(event) => setPaymentDetails(event.target.value)} />
              </label>
            </div>
          </details>

          <details>
            <summary>{copy.addNotes}</summary>
            <div className="stack invoiceSectionBody">
              <label className="stack">
                {copy.notes}
                <textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <label className="stack">
                {copy.description}
                <input value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </div>
          </details>

          <details>
            <summary>{copy.addSignature}</summary>
            <div className="stack invoiceSectionBody">
              <label className="stack">
                {copy.logo}
                <input type="file" accept="image/*" onChange={(event) => onImageSelect(event, setLogoDataUrl)} />
                {logoDataUrl && (
                  <div className="row">
                    <img src={logoDataUrl} alt="Invoice logo" style={{ maxHeight: 38 }} />
                    <button type="button" className="secondary" onClick={() => setLogoDataUrl("")}>
                      {copy.clearImage}
                    </button>
                  </div>
                )}
              </label>
              <label className="stack">
                {copy.signature}
                <input type="file" accept="image/*" onChange={(event) => onImageSelect(event, setSignatureDataUrl)} />
                {signatureDataUrl && (
                  <div className="row">
                    <img src={signatureDataUrl} alt="Invoice signature" style={{ maxHeight: 38 }} />
                    <button type="button" className="secondary" onClick={() => setSignatureDataUrl("")}>
                      {copy.clearImage}
                    </button>
                  </div>
                )}
              </label>
            </div>
          </details>

          <details>
            <summary>{copy.emailDetails}</summary>
            <div className="stack invoiceSectionBody">
              <label className="stack">
                {copy.emailTo}
                <input type="email" value={emailTo} onChange={(event) => setEmailTo(event.target.value)} />
              </label>
            </div>
          </details>

          <button type="submit" disabled={saving}>
            {saving ? copy.savingInvoice : copy.saveInvoice}
          </button>
        </form>

        <aside className="invoicePreview card">
          <div className="invoicePreviewActions">
            <h2>{copy.previewTitle}</h2>
            <div className="row">
              {lastSavedInvoiceId ? (
                <>
                  <a className="button secondary" href={`/api/invoices/${lastSavedInvoiceId}/pdf`}>
                    {copy.savePdf}
                  </a>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onEmailInvoice(lastSavedInvoiceId, emailTo || customer.email || null)}
                    disabled={emailingId === lastSavedInvoiceId}
                  >
                    {emailingId === lastSavedInvoiceId ? copy.emailing : copy.emailPdf}
                  </button>
                </>
              ) : (
                <span className="note">{copy.notSavedYet}</span>
              )}
            </div>
          </div>

          <div className="invoicePaper">
            <div className="invoicePaperHeader">
              <div>
                <h3>Invoice</h3>
                <p>#{invoiceNumber || "-"}</p>
              </div>
              {logoDataUrl ? <img className="invoiceLogo" src={logoDataUrl} alt="Invoice logo" /> : null}
            </div>

            <div className="invoiceMetaGrid">
              <div>
                <p className="label">{copy.project}</p>
                <p>{projectName || "-"}</p>
              </div>
              <div>
                <p className="label">{copy.issueDate}</p>
                <p>{issueDate || "-"}</p>
              </div>
              <div>
                <p className="label">{copy.dueDate}</p>
                <p>{dueDate || "-"}</p>
              </div>
            </div>

            <div className="invoicePartyGrid">
              <div>
                <p className="label">From</p>
                <p>
                  <strong>{senderName || defaults.businessName}</strong>
                </p>
                {senderAddress && <p>{senderAddress}</p>}
                {senderOrg && <p>{senderOrg}</p>}
                {senderEmail && <p>{senderEmail}</p>}
                {senderPhone && <p>{senderPhone}</p>}
                {senderWebsite && <p>{senderWebsite}</p>}
              </div>
              <div>
                <p className="label">To</p>
                <p>
                  <strong>{customer.name || "-"}</strong>
                </p>
                {customerAddressPreview && <p>{customerAddressPreview}</p>}
                {customer.email && <p>{customer.email}</p>}
                {customer.phone && <p>{customer.phone}</p>}
                {customer.website && <p>{customer.website}</p>}
              </div>
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>{copy.description}</th>
                    <th>{copy.units}</th>
                    <th>{copy.price}</th>
                    <th>{copy.vatAmount}</th>
                    <th>{copy.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.items.map((item) => (
                    <tr key={item.description + item.quantity + item.unitPrice}>
                      <td>{item.description}</td>
                      <td>{item.quantity}</td>
                      <td>{formatMoney(item.unitPrice, currency, numberLocale)}</td>
                      <td>{formatMoney(item.vatAmount, currency, numberLocale)}</td>
                      <td>{formatMoney(item.totalAmount, currency, numberLocale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="invoiceTotals">
              <p>
                {copy.subtotal}: <strong>{formatMoney(computed.subtotal, currency, numberLocale)}</strong>
              </p>
              <p>
                {copy.vatAmount}: <strong>{formatMoney(computed.vatAmount, currency, numberLocale)}</strong>
              </p>
              <p>
                {copy.total}: <strong>{formatMoney(computed.grossAmount, currency, numberLocale)}</strong>
              </p>
            </div>

            {notes && <p className="invoiceNote">{notes}</p>}

            {(paymentMethod || paymentDetails) && (
              <div className="invoicePayment">
                <h4>{copy.paymentMethod}</h4>
                <p>{paymentMethod || "-"}</p>
                {paymentDetails && <p>{paymentDetails}</p>}
              </div>
            )}

            {signatureDataUrl && (
              <div className="invoiceSignatureRow">
                <img className="invoiceSignature" src={signatureDataUrl} alt="Invoice signature" />
              </div>
            )}
          </div>
        </aside>
      </section>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      <article className="card" id="invoice-filters">
        <h2>{copy.filterTitle}</h2>
        <form className="row" method="get">
          <label className="stack">
            {copy.year}
            <select name="year" defaultValue={String(filters.year)}>
              {filters.yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label className="stack">
            {copy.month}
            <select name="month" defaultValue={filters.month ? String(filters.month) : ""}>
              <option value="">{copy.allMonths}</option>
              {monthLabels.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>

          <label className="stack" style={{ minWidth: 260 }}>
            {copy.search}
            <input name="q" defaultValue={filters.query} placeholder={copy.searchPlaceholder} />
          </label>

          <div className="row" style={{ alignItems: "end" }}>
            <button type="submit">{copy.filter}</button>
          </div>
        </form>
      </article>

      <article className="card" id="invoice-list">
        <h2>{copy.invoiceListTitle}</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{copy.invoiceNumber}</th>
                <th>{copy.customerName}</th>
                <th>{copy.issueDate}</th>
                <th>{copy.dueDate}</th>
                <th>{copy.total}</th>
                <th>{copy.status}</th>
                <th>{copy.paidDate}</th>
                <th>{copy.sentDate}</th>
                <th>{copy.action}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoiceNumber}</td>
                  <td>{invoice.customerName}</td>
                  <td>{invoice.issueDate.slice(0, 10)}</td>
                  <td>{invoice.dueDate ? invoice.dueDate.slice(0, 10) : "-"}</td>
                  <td>{formatMoney(invoice.grossAmount, invoice.currency, numberLocale)}</td>
                  <td>
                    <span className={invoice.status === "PAID" ? "badge good" : "badge warn"}>
                      {invoice.status === "PAID" ? copy.paid : copy.unpaid}
                    </span>
                  </td>
                  <td>{invoice.paidAt ? invoice.paidAt.slice(0, 10) : "-"}</td>
                  <td>{invoice.sentAt ? invoice.sentAt.slice(0, 10) : "-"}</td>
                  <td>
                    <div className="row">
                      <a className="button secondary" href={`/api/invoices/${invoice.id}/pdf`}>
                        {copy.downloadPdf}
                      </a>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => onEmailInvoice(invoice.id, invoice.customerEmail)}
                        disabled={emailingId === invoice.id}
                      >
                        {emailingId === invoice.id ? copy.emailing : copy.emailPdf}
                      </button>
                      {invoice.status === "PAID" ? (
                        invoice.paidTransactionId ? (
                          <Link href={`/review/transactions/${invoice.paidTransactionId}`}>{copy.reviewPayment}</Link>
                        ) : (
                          "-"
                        )
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          disabled={payingId === invoice.id}
                          onClick={() => onMarkPaid(invoice.id)}
                        >
                          {payingId === invoice.id ? copy.markingPaid : copy.markPaid}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9}>{copy.noInvoices}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
};
