"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CustomerPicker } from "@/components/invoices/CustomerPicker";
import { InvoiceActions, type InvoiceActionData } from "@/components/invoices/InvoiceActions";
import { LineItemsEditor } from "@/components/invoices/LineItemsEditor";
import { type RotRutDraft, RotRutForm, rotRutPayload } from "@/components/invoices/RotRutForm";
import {
  type CustomerDraft,
  type CustomerOption,
  customerAddressLine,
  customerFromOption,
  customerPayload,
  draftsToItems,
  draftsToRotRutItems,
  emptyCustomer,
  type LineItemDraft,
  makeLineItem,
  rotRutDraftLines,
  totalsOfDrafts
} from "@/lib/invoices/drafts";
import { computeRotRut } from "@/lib/invoices/rotrut";
import { RecurringList, type RecurringRow } from "@/components/invoices/RecurringList";
import { formatMoney } from "@/lib/data/format";
import { formatInvoiceNumber } from "@/lib/invoices/numbering";
import { type InvoiceStatusKind } from "@/lib/invoices/status";
import { type Locale } from "@/lib/i18n/locale";

export type InvoiceRow = InvoiceActionData & {
  customerId: string | null;
  statusLabel: string;
  statusTone: "good" | "warn" | "";
};

type InvoicesManagerProps = {
  locale: Locale;
  rows: InvoiceRow[];
  customers: CustomerOption[];
  recurring: RecurringRow[];
  /** Customer to start a new invoice for (from the customer register). */
  prefillCustomerId?: string | null;
  /** Shown between the totals and the form: what needs doing now (ROT/RUT requests). */
  afterSummary?: React.ReactNode;
  totals: { outstanding: number; overdue: number; overdueCount: number; currency: string };
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
    paymentTermsDays: number;
    vatRegistered: boolean;
    /** ROT/RUT is only offered to a business approved for F-skatt. */
    fSkattRegistered: boolean;
    /** Fakturametoden: ROT/RUT is not available there yet. */
    accrual: boolean;
    currency: string;
    /** Bankgiro, plusgiro, Swish, IBAN as set in settings. Empty when none is set. */
    paymentLines: { label: string; value: string }[];
  };
  filters: {
    year: number;
    month: number | null;
    query: string;
    show: "period" | "open" | "overdue";
    yearOptions: number[];
  };
};

const localIso = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const todayIso = () => localIso(new Date());
const addDaysIso = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const readFileAsDataUrl = async (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read selected file."));
    reader.readAsDataURL(file);
  });

export const InvoicesManager = ({
  locale,
  rows,
  customers,
  recurring,
  prefillCustomerId,
  afterSummary,
  totals,
  defaults,
  filters
}: InvoicesManagerProps) => {
  const router = useRouter();
  const numberLocale = locale === "sv" ? "sv-SE" : "en-GB";

  const copy =
    locale === "sv"
      ? {
          createTitle: "Ny faktura",
          createIntro: "Välj kund, skriv vad du sålt och spara. Nummer, förfallodatum och OCR sätts åt dig.",
          previewTitle: "Förhandsvisning",
          saveInvoice: "Spara faktura",
          savingInvoice: "Sparar...",
          invoiceSaved: (number: string) => `Faktura ${number} är sparad. Skicka den direkt eller ladda ner PDF:en.`,
          createFailed: "Kunde inte skapa fakturan.",
          unknownError: "Okänt fel",
          customerSection: "Kund",
          itemsSection: "Vad fakturan gäller",
          rotRutSection: "Rot och rut",
          rotRutStage: (type: string, stage: string) =>
            `${type === "ROT" ? "Rot" : "Rut"}: ${
              stage === "awaiting_customer"
                ? "väntar på kundens del"
                : stage === "ready"
                  ? "redo att begära från Skatteverket"
                  : stage === "requested"
                    ? "begärt, väntar på Skatteverket"
                    : "utbetalt av Skatteverket"
            }`,
          rotRutReduction: (word: string, percent: number) => `Preliminärt ${word}avdrag ${percent} %`,
          rotRutLabour: "Varav arbete inkl. moms",
          rotRutCustomerPays: "Kunden betalar",
          totalInclVat: "Summa inkl. moms",
          rotRutPreviewNote: (amount: string) =>
            `Resten, ${amount}, begär du från Skatteverket när kunden har betalat. Kunden ska betala elektroniskt.`,
          detailsSection: "Nummer, datum och valuta",
          invoiceNumber: "Fakturanummer",
          usePatternNumber: "Återställ till nästa nummer",
          project: "Projekt eller referens",
          issueDate: "Fakturadatum",
          dueDate: "Förfallodatum",
          dueHint: (days: number) => `Standard: ${days} dagar. Ändras under Inställningar.`,
          currency: "Valuta",
          myDetails: "Mina uppgifter",
          paymentSection: "Så betalar kunden",
          paymentAuto: "Skrivs ut på fakturan tillsammans med belopp, förfallodatum och OCR-nummer:",
          paymentMissing:
            "Du har inte lagt in något bankgiro, plusgiro, Swish eller IBAN ännu, så fakturan säger inte hur kunden ska betala.",
          paymentSettings: "Lägg till betalningsuppgifter",
          paymentExtra: "Extra betalningsinformation (valfritt)",
          notesSection: "Meddelande till kunden",
          brandingSection: "Logotyp och signatur",
          senderName: "Avsändare",
          senderAddress: "Adress",
          senderOrg: "Org.nr",
          senderEmail: "E-post",
          senderPhone: "Telefon",
          senderWebsite: "Webbplats",
          description: "Beskrivning",
          units: "Antal",
          price: "Pris",
          subtotal: "Summa exkl. moms",
          vatAmount: "Moms",
          total: "Att betala",
          notes: "Meddelande på fakturan",
          bookDescription: "Text i bokföringen när fakturan betalas (valfritt)",
          logo: "Logotyp",
          signature: "Signatur",
          clearImage: "Rensa",
          from: "Från",
          to: "Till",
          invoiceWord: "Faktura",
          ocrAuto: "OCR-nummer skapas när du sparar",
          listTitle: "Fakturor",
          show: "Visa",
          showPeriod: "Alla i perioden",
          showOpen: "Obetalda, alla perioder",
          showOverdue: "Försenade, alla perioder",
          year: "År",
          month: "Månad",
          allMonths: "Alla månader",
          search: "Sök",
          searchPlaceholder: "Fakturanummer, kund eller projekt",
          filter: "Visa",
          customer: "Kund",
          amount: "Belopp",
          remaining: "Kvar att betala",
          status: "Status",
          nextStep: "Nästa steg",
          noInvoices: "Inga fakturor här ännu.",
          noInvoicesHint: "Skapa din första faktura i formuläret ovanför.",
          outstanding: "Obetalt just nu",
          overdue: "Försenat",
          overdueCount: (n: number) => (n === 1 ? "1 faktura" : `${n} fakturor`),
          seeOverdue: "Visa försenade",
          customers: "Kundregister",
          quotes: "Offerter"
        }
      : {
          createTitle: "New invoice",
          createIntro: "Pick a customer, write what you sold and save. Number, due date and OCR are set for you.",
          previewTitle: "Preview",
          saveInvoice: "Save invoice",
          savingInvoice: "Saving...",
          invoiceSaved: (number: string) => `Invoice ${number} is saved. Send it right away or download the PDF.`,
          createFailed: "Failed to create invoice.",
          unknownError: "Unknown error",
          customerSection: "Customer",
          itemsSection: "What the invoice is for",
          rotRutSection: "ROT and RUT",
          rotRutStage: (type: string, stage: string) =>
            `${type}: ${
              stage === "awaiting_customer"
                ? "waiting for the customer's part"
                : stage === "ready"
                  ? "ready to request from Skatteverket"
                  : stage === "requested"
                    ? "requested, waiting for Skatteverket"
                    : "paid by Skatteverket"
            }`,
          rotRutReduction: (word: string, percent: number) => `Preliminary ${word} ${percent} %`,
          rotRutLabour: "Of which labour incl. VAT",
          rotRutCustomerPays: "The customer pays",
          totalInclVat: "Total incl. VAT",
          rotRutPreviewNote: (amount: string) =>
            `The rest, ${amount}, you request from Skatteverket once the customer has paid. The customer must pay electronically.`,
          detailsSection: "Number, dates and currency",
          invoiceNumber: "Invoice number",
          usePatternNumber: "Reset to the next number",
          project: "Project or reference",
          issueDate: "Invoice date",
          dueDate: "Due date",
          dueHint: (days: number) => `Default: ${days} days. Change it under Settings.`,
          currency: "Currency",
          myDetails: "My details",
          paymentSection: "How the customer pays",
          paymentAuto: "Printed on the invoice together with the amount, due date and OCR reference:",
          paymentMissing:
            "You have not added a bankgiro, plusgiro, Swish or IBAN yet, so the invoice does not say how the customer should pay.",
          paymentSettings: "Add payment details",
          paymentExtra: "Extra payment information (optional)",
          notesSection: "Message to the customer",
          brandingSection: "Logo and signature",
          senderName: "Sender name",
          senderAddress: "Address",
          senderOrg: "Registration no.",
          senderEmail: "Email",
          senderPhone: "Phone",
          senderWebsite: "Website",
          description: "Description",
          units: "Qty",
          price: "Price",
          subtotal: "Total excl. VAT",
          vatAmount: "VAT",
          total: "To pay",
          notes: "Message on the invoice",
          bookDescription: "Text in the books when the invoice is paid (optional)",
          logo: "Logo",
          signature: "Signature",
          clearImage: "Clear",
          from: "From",
          to: "To",
          invoiceWord: "Invoice",
          ocrAuto: "OCR reference is created when you save",
          listTitle: "Invoices",
          show: "Show",
          showPeriod: "All in the period",
          showOpen: "Unpaid, all periods",
          showOverdue: "Overdue, all periods",
          year: "Year",
          month: "Month",
          allMonths: "All months",
          search: "Search",
          searchPlaceholder: "Invoice number, customer or project",
          filter: "Show",
          customer: "Customer",
          amount: "Amount",
          remaining: "Left to pay",
          status: "Status",
          nextStep: "Next step",
          noInvoices: "No invoices here yet.",
          noInvoicesHint: "Create your first invoice in the form above.",
          outstanding: "Unpaid right now",
          overdue: "Overdue",
          overdueCount: (n: number) => (n === 1 ? "1 invoice" : `${n} invoices`),
          seeOverdue: "Show overdue",
          customers: "Customer register",
          quotes: "Quotes"
        };

  const prefilled = prefillCustomerId ? customers.find((option) => option.id === prefillCustomerId) : undefined;

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceNumberTouched, setInvoiceNumberTouched] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [dueDateTouched, setDueDateTouched] = useState(false);
  const [currency, setCurrency] = useState(defaults.currency || "SEK");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentDetails, setPaymentDetails] = useState("");
  const [senderName, setSenderName] = useState(defaults.senderName || defaults.businessName);
  const [senderAddress, setSenderAddress] = useState(defaults.senderAddress || "");
  const [senderOrg, setSenderOrg] = useState(defaults.senderOrgNumber || "");
  const [senderEmail, setSenderEmail] = useState(defaults.senderEmail || "");
  const [senderPhone, setSenderPhone] = useState(defaults.senderPhone || "");
  const [senderWebsite, setSenderWebsite] = useState(defaults.senderWebsite || "");
  const [logoDataUrl, setLogoDataUrl] = useState(defaults.defaultLogo || "");
  const [signatureDataUrl, setSignatureDataUrl] = useState(defaults.defaultSignature || "");
  const [customer, setCustomer] = useState<CustomerDraft>(prefilled ? customerFromOption(prefilled) : emptyCustomer());
  const [items, setItems] = useState<LineItemDraft[]>(() => [makeLineItem(defaults.vatRegistered)]);
  const [rotRut, setRotRut] = useState<RotRutDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<InvoiceActionData | null>(null);

  const suggestedInvoiceNumber = useMemo(() => {
    const parsedIssueDate = new Date(`${issueDate}T00:00:00.000Z`);
    if (Number.isNaN(parsedIssueDate.valueOf())) return "";
    return formatInvoiceNumber({
      pattern: defaults.invoiceNumberPattern,
      sequence: defaults.nextInvoiceSequence,
      issueDate: parsedIssueDate
    });
  }, [defaults.invoiceNumberPattern, defaults.nextInvoiceSequence, issueDate]);

  // Follow the pattern-suggested number, and the payment terms, until the user edits the field.
  const effectiveInvoiceNumber = invoiceNumberTouched ? invoiceNumber : suggestedInvoiceNumber;
  const effectiveDueDate = dueDateTouched ? dueDate : addDaysIso(issueDate, defaults.paymentTermsDays);

  const computed = useMemo(() => totalsOfDrafts(items), [items]);
  // ROT/RUT: what the customer pays is the total minus the preliminary reduction.
  const rotRutAllowed = defaults.fSkattRegistered && !defaults.accrual;
  const rotRutType = rotRutAllowed && rotRut ? rotRut.type : null;
  const reduction = useMemo(() => {
    if (!rotRutType) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(issueDate) ? issueDate : todayIso();
    return computeRotRut({ type: rotRutType, date, lines: rotRutDraftLines(items, rotRutType) });
  }, [rotRutType, issueDate, items]);
  const customerPays = reduction ? Math.max(0, Math.round((computed.grossAmount - reduction.deduction) * 100) / 100) : computed.grossAmount;
  const rotRutWord = rotRutType === "ROT" ? "rot" : locale === "sv" ? "rut" : "RUT";

  const monthLabels = useMemo(
    () =>
      Array.from({ length: 12 }).map((_value, index) => ({
        value: index + 1,
        label: new Intl.DateTimeFormat(numberLocale, { month: "long" }).format(new Date(Date.UTC(2026, index, 1)))
      })),
    [numberLocale]
  );

  const customerAddressPreview = customerAddressLine(customer);

  const resetDraft = () => {
    setInvoiceNumberTouched(false);
    setDueDateTouched(false);
    setProjectName("");
    setDescription("");
    setNotes("");
    setIssueDate(todayIso());
    setCustomer(emptyCustomer());
    setItems([makeLineItem(defaults.vatRegistered)]);
    setRotRut(null);
  };

  const onCreateInvoice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setLastSaved(null);

    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Untouched means "use the pattern": let the server assign it and advance the sequence.
          invoiceNumber: invoiceNumberTouched ? invoiceNumber.trim() || undefined : undefined,
          projectName: projectName.trim() || undefined,
          description: description.trim() || undefined,
          notes: notes.trim() || undefined,
          issueDate,
          // Untouched means "use my payment terms": the server works out the date.
          dueDate: dueDateTouched ? dueDate || undefined : undefined,
          currency,
          paymentDetails: paymentDetails.trim() || undefined,
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
          customer: customerPayload(customer),
          items: rotRutAllowed && rotRut ? draftsToRotRutItems(items, rotRut.type) : draftsToItems(items),
          rotRut: rotRutAllowed && rotRut ? rotRutPayload(rotRut) : undefined
        })
      });

      const json = (await response.json()) as {
        error?: string;
        invoice?: {
          id: string;
          invoiceNumber: string;
          customerName: string;
          customerEmail: string | null;
          issueDate: string;
          dueDate: string | null;
          grossAmount: number;
          currency: string;
          rotRutType: "ROT" | "RUT" | null;
          rotRutDeduction: number | null;
        };
      };

      if (!response.ok || !json.invoice) {
        throw new Error(json.error ?? copy.createFailed);
      }

      setLastSaved({
        id: json.invoice.id,
        invoiceNumber: json.invoice.invoiceNumber,
        customerName: json.invoice.customerName,
        customerEmail: json.invoice.customerEmail,
        currency: json.invoice.currency,
        grossAmount: json.invoice.grossAmount,
        paidAmount: 0,
        creditedAmount: 0,
        remaining: Math.round((json.invoice.grossAmount - (json.invoice.rotRutDeduction ?? 0)) * 100) / 100,
        rotRut: json.invoice.rotRutType
          ? {
              type: json.invoice.rotRutType,
              skatteverketAmount: json.invoice.rotRutDeduction ?? 0,
              received: 0,
              stage: "awaiting_customer"
            }
          : null,
        statusKind: "DRAFT" satisfies InvoiceStatusKind,
        overdue: false,
        issueDate: json.invoice.issueDate,
        dueDate: json.invoice.dueDate,
        reminderCount: 0
      });
      resetDraft();
      router.refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : copy.unknownError);
    } finally {
      setSaving(false);
    }
  };

  const onImageSelect = async (event: React.ChangeEvent<HTMLInputElement>, setter: (value: string) => void) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      setter(await readFileAsDataUrl(file));
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : copy.unknownError);
    } finally {
      input.value = "";
    }
  };

  return (
    <div className="stack">
      <div className="grid">
        <article className="card">
          <p className="label">{copy.outstanding}</p>
          <p className="kpi">{formatMoney(totals.outstanding, totals.currency, numberLocale)}</p>
        </article>
        <article className="card">
          <p className="label">{copy.overdue}</p>
          <p className="kpi">{formatMoney(totals.overdue, totals.currency, numberLocale)}</p>
          {totals.overdueCount > 0 && (
            <p className="note">
              {copy.overdueCount(totals.overdueCount)}.{" "}
              <Link className="textLink" href="/invoices?show=overdue#invoice-list">
                {copy.seeOverdue}
              </Link>
            </p>
          )}
        </article>
        <article className="card">
          <div className="stack">
            <Link className="textLink" href="/customers">
              {copy.customers}
            </Link>
            <Link className="textLink" href="/quotes">
              {copy.quotes}
            </Link>
          </div>
        </article>
      </div>

      {afterSummary}

      <section className="invoiceWorkspace" id="new-invoice">
        <form className="invoiceBuilder card" onSubmit={onCreateInvoice}>
          <h2>{copy.createTitle}</h2>
          <p className="note">{copy.createIntro}</p>

          <details open>
            <summary>{copy.customerSection}</summary>
            <div className="invoiceSectionBody">
              <CustomerPicker locale={locale} value={customer} onChange={setCustomer} options={customers} />
            </div>
          </details>

          <details open>
            <summary>{copy.itemsSection}</summary>
            <div className="invoiceSectionBody">
              <LineItemsEditor
                locale={locale}
                items={items}
                onChange={setItems}
                currency={currency}
                vatRegistered={defaults.vatRegistered}
                rotRut={rotRutType ? { type: rotRutType } : undefined}
              />
            </div>
          </details>

          {defaults.fSkattRegistered && (
            <details open>
              <summary>{copy.rotRutSection}</summary>
              <div className="invoiceSectionBody">
                <RotRutForm
                  locale={locale}
                  value={rotRutAllowed ? rotRut : null}
                  onChange={setRotRut}
                  fSkatt={defaults.fSkattRegistered}
                  accrual={defaults.accrual}
                  currency={currency}
                  issueDate={issueDate}
                  dueDate={effectiveDueDate}
                  items={items}
                />
              </div>
            </details>
          )}

          <details open>
            <summary>{copy.detailsSection}</summary>
            <div className="stack invoiceSectionBody">
              <div className="row">
                <label className="stack">
                  {copy.issueDate}
                  <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required />
                </label>
                <label className="stack">
                  {copy.dueDate}
                  <input
                    type="date"
                    value={effectiveDueDate}
                    min={issueDate}
                    onChange={(event) => {
                      setDueDateTouched(true);
                      setDueDate(event.target.value);
                    }}
                    required
                  />
                </label>
              </div>
              <p className="note">{copy.dueHint(defaults.paymentTermsDays)}</p>
              <div className="row">
                <label className="stack">
                  {copy.invoiceNumber}
                  <input
                    value={effectiveInvoiceNumber}
                    onChange={(event) => {
                      setInvoiceNumberTouched(true);
                      setInvoiceNumber(event.target.value);
                    }}
                    required
                  />
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
              {invoiceNumberTouched && (
                <div className="row">
                  <button type="button" className="secondary" onClick={() => setInvoiceNumberTouched(false)}>
                    {copy.usePatternNumber}
                  </button>
                </div>
              )}
              <label className="stack">
                {copy.project}
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={180} />
              </label>
            </div>
          </details>

          <details open={defaults.paymentLines.length === 0 || undefined}>
            <summary>{copy.paymentSection}</summary>
            <div className="stack invoiceSectionBody">
              {defaults.paymentLines.length > 0 ? (
                <>
                  <p className="note">{copy.paymentAuto}</p>
                  <p>
                    {defaults.paymentLines.map((line) => (
                      <span key={line.label} style={{ display: "block" }}>
                        {line.label}: <strong>{line.value}</strong>
                      </span>
                    ))}
                  </p>
                </>
              ) : (
                <p className="note">
                  {copy.paymentMissing}{" "}
                  <Link className="textLink" href="/settings#invoice-payment">
                    {copy.paymentSettings}
                  </Link>
                </p>
              )}
              <label className="stack">
                {copy.paymentExtra}
                <textarea rows={2} value={paymentDetails} onChange={(event) => setPaymentDetails(event.target.value)} />
              </label>
            </div>
          </details>

          <details>
            <summary>{copy.notesSection}</summary>
            <div className="stack invoiceSectionBody">
              <label className="stack">
                {copy.notes}
                <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} />
              </label>
              <label className="stack">
                {copy.bookDescription}
                <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} />
              </label>
            </div>
          </details>

          <details>
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

          <details>
            <summary>{copy.brandingSection}</summary>
            <div className="stack invoiceSectionBody">
              <label className="stack">
                {copy.logo}
                <input type="file" accept="image/*" onChange={(event) => onImageSelect(event, setLogoDataUrl)} />
                {logoDataUrl && (
                  <div className="row">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoDataUrl} alt="" style={{ maxHeight: 38 }} />
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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={signatureDataUrl} alt="" style={{ maxHeight: 38 }} />
                    <button type="button" className="secondary" onClick={() => setSignatureDataUrl("")}>
                      {copy.clearImage}
                    </button>
                  </div>
                )}
              </label>
            </div>
          </details>

          <p>
            {reduction ? copy.rotRutCustomerPays : copy.total}:{" "}
            <strong>{formatMoney(customerPays, currency, numberLocale)}</strong>
          </p>
          <div className="row">
            <button type="submit" disabled={saving}>
              {saving ? copy.savingInvoice : copy.saveInvoice}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {lastSaved && (
            <div className="stack">
              <p className="success">{copy.invoiceSaved(lastSaved.invoiceNumber)}</p>
              <InvoiceActions locale={locale} invoice={lastSaved} variant="row" />
            </div>
          )}
        </form>

        <aside className="invoicePreview card">
          <div className="invoicePreviewActions">
            <h2>{copy.previewTitle}</h2>
          </div>

          <div className="invoicePaper">
            <div className="invoicePaperHeader">
              <div>
                <h3>{copy.invoiceWord}</h3>
                <p>{effectiveInvoiceNumber || "-"}</p>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logoDataUrl ? <img className="invoiceLogo" src={logoDataUrl} alt="" /> : null}
            </div>

            <div className="invoiceMetaGrid">
              <div>
                <p className="label">{copy.issueDate}</p>
                <p>{issueDate || "-"}</p>
              </div>
              <div>
                <p className="label">{copy.dueDate}</p>
                <p>{effectiveDueDate || "-"}</p>
              </div>
              <div>
                <p className="label">{copy.project}</p>
                <p>{projectName || "-"}</p>
              </div>
            </div>

            <div className="invoicePartyGrid">
              <div>
                <p className="label">{copy.from}</p>
                <p>
                  <strong>{senderName || defaults.businessName}</strong>
                </p>
                {senderAddress && <p>{senderAddress}</p>}
                {senderOrg && <p>{senderOrg}</p>}
                {senderEmail && <p>{senderEmail}</p>}
                {senderPhone && <p>{senderPhone}</p>}
              </div>
              <div>
                <p className="label">{copy.to}</p>
                <p>
                  <strong>{customer.name || "-"}</strong>
                </p>
                {customerAddressPreview && <p>{customerAddressPreview}</p>}
                {customer.email && <p>{customer.email}</p>}
              </div>
            </div>

            <div className="tableWrap invoicesTableWrap">
              <table>
                <thead>
                  <tr>
                    <th>{copy.description}</th>
                    <th>{copy.units}</th>
                    <th>{copy.vatAmount}</th>
                    <th>{copy.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.items.map((item, index) => (
                    <tr key={`${index}-${item.description}`}>
                      <td>{item.description}</td>
                      <td>{item.quantity}</td>
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
                {reduction ? copy.totalInclVat : copy.total}:{" "}
                <strong>{formatMoney(computed.grossAmount, currency, numberLocale)}</strong>
              </p>
              {reduction && (
                <>
                  <p>
                    {copy.rotRutLabour}: <strong>{formatMoney(reduction.labourAmount, currency, numberLocale)}</strong>
                  </p>
                  <p>
                    {copy.rotRutReduction(rotRutWord, Math.round(reduction.rate * 100))}:{" "}
                    <strong>{formatMoney(-reduction.deduction, currency, numberLocale)}</strong>
                  </p>
                  <p>
                    {copy.total}: <strong>{formatMoney(customerPays, currency, numberLocale)}</strong>
                  </p>
                </>
              )}
            </div>

            {notes && <p className="invoiceNote">{notes}</p>}

            <div className="invoicePayment">
              <h4>{copy.paymentSection}</h4>
              <p>
                {copy.total}: <strong>{formatMoney(customerPays, currency, numberLocale)}</strong>
                {effectiveDueDate ? `, ${copy.dueDate.toLowerCase()} ${effectiveDueDate}` : ""}
              </p>
              {reduction && (
                <p className="note">{copy.rotRutPreviewNote(formatMoney(reduction.deduction, currency, numberLocale))}</p>
              )}
              {defaults.paymentLines.map((line) => (
                <p key={line.label}>
                  {line.label}: {line.value}
                </p>
              ))}
              <p className="note">{copy.ocrAuto}</p>
              {paymentDetails && <p>{paymentDetails}</p>}
            </div>

            {signatureDataUrl && (
              <div className="invoiceSignatureRow">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="invoiceSignature" src={signatureDataUrl} alt="" />
              </div>
            )}
          </div>
        </aside>
      </section>

      <article className="card" id="invoice-filters">
        <form className="row" method="get" style={{ alignItems: "flex-end" }}>
          <label className="stack">
            {copy.show}
            <select name="show" defaultValue={filters.show}>
              <option value="period">{copy.showPeriod}</option>
              <option value="open">{copy.showOpen}</option>
              <option value="overdue">{copy.showOverdue}</option>
            </select>
          </label>

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

          <label className="stack" style={{ minWidth: 240 }}>
            {copy.search}
            <input name="q" defaultValue={filters.query} placeholder={copy.searchPlaceholder} />
          </label>

          <button type="submit">{copy.filter}</button>
        </form>
      </article>

      <article className="card" id="invoice-list">
        <h2>{copy.listTitle}</h2>
        {rows.length === 0 ? (
          <p className="note">
            {copy.noInvoices} {filters.show === "period" && !filters.query ? copy.noInvoicesHint : ""}
          </p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.invoiceNumber}</th>
                  <th>{copy.customer}</th>
                  <th>{copy.dueDate}</th>
                  <th>{copy.amount}</th>
                  <th>{copy.remaining}</th>
                  <th>{copy.status}</th>
                  <th>{copy.nextStep}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link className="textLink" href={`/invoices/${invoice.id}`}>
                        {invoice.invoiceNumber}
                      </Link>
                      <br />
                      <span className="note">{invoice.issueDate.slice(0, 10)}</span>
                    </td>
                    <td>
                      {invoice.customerId ? (
                        <Link className="textLink" href={`/customers/${invoice.customerId}`}>
                          {invoice.customerName}
                        </Link>
                      ) : (
                        invoice.customerName
                      )}
                    </td>
                    <td>{invoice.dueDate ? invoice.dueDate.slice(0, 10) : "-"}</td>
                    <td>{formatMoney(invoice.grossAmount, invoice.currency, numberLocale)}</td>
                    <td>
                      <strong>{formatMoney(invoice.remaining, invoice.currency, numberLocale)}</strong>
                    </td>
                    <td>
                      <span className={`badge ${invoice.statusTone}`.trim()}>{invoice.statusLabel}</span>
                      {invoice.rotRut && invoice.rotRut.stage && invoice.rotRut.stage !== "cancelled" && (
                        <>
                          <br />
                          <span className="note">{copy.rotRutStage(invoice.rotRut.type, invoice.rotRut.stage)}</span>
                        </>
                      )}
                    </td>
                    <td>
                      <InvoiceActions locale={locale} invoice={invoice} variant="row" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <RecurringList locale={locale} rows={recurring} />
    </div>
  );
};
