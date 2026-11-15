"use client";

import { useEffect, useState } from "react";
import { Jurisdictions, type Jurisdiction } from "@/lib/domain/enums";
import { type Locale } from "@/lib/i18n/locale";
import { buildOcrReference } from "@/lib/invoices/ocr";
import {
  type PaymentAccountField,
  parsePaymentAccount,
  paymentAccountLines,
  paymentAccountMessage
} from "@/lib/invoices/payment-accounts";
import { buildReminderMessage, reminderLawNote } from "@/lib/invoices/reminders";
import { HintTip } from "@/components/ui/HintTip";
import { useUserPreferences } from "@/components/providers/UserPreferencesProvider";

type SettingsFormProps = {
  locale: Locale;
  initial: {
    name: string;
    jurisdiction: Jurisdiction;
    locale: string;
    baseCurrency: string;
    bookkeepingMethod: string;
    vatRegistered: boolean;
    vatFrequency: string;
    fiscalYearStartMonth: number;
    sniCode: string;
    vatNumber: string;
    fSkattRegistered: boolean;
    personnummer: string;
    invoiceNumberPattern: string;
    invoiceSenderName: string;
    invoiceSenderAddress: string;
    invoiceSenderOrgNumber: string;
    invoiceSenderEmail: string;
    invoiceSenderPhone: string;
    invoiceSenderWebsite: string;
    invoiceEmailFrom: string;
    invoiceDefaultLogo: string;
    invoiceDefaultSignature: string;
    // Payment details, terms, quotes and reminders. When the page does not
    // pass them, the form reads them from /api/settings once it has loaded.
    bankgiro?: string;
    plusgiro?: string;
    iban?: string;
    bic?: string;
    swishNumber?: string;
    defaultPaymentTermsDays?: number;
    quoteNumberPattern?: string;
    invoiceReminderEnabled?: boolean;
    invoiceReminderDaysAfterDue?: number;
    taxConfig: {
      municipalTaxRate: number;
      socialContributionRate: number;
      generalDeductionRate: number;
    } | null;
  };
};

const readFileAsDataUrl = async (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read selected file."));
    reader.readAsDataURL(file);
  });

const rememberLocale = (value: string) => {
  document.cookie = `locale=${value}; path=/; max-age=31536000; samesite=lax`;
};

export const SettingsForm = ({ initial, locale: uiLocale }: SettingsFormProps) => {
  const copy =
    uiLocale === "sv"
      ? {
          businessName: "Företagsnamn",
          jurisdiction: "Jurisdiktion",
          sweden: "Sverige",
          euGeneric: "EU generell (mall)",
          uk: "Storbritannien (mall)",
          language: "Språk",
          english: "Engelska",
          swedish: "Svenska",
          currency: "Valuta",
          bookkeepingMethod: "Bokföringsmetod",
          kontantmetoden: "Kontantmetoden (kontantbas)",
          fakturametoden: "Fakturametoden (periodiserad)",
          vatRegistered: "Momsregistrerad",
          vatFrequency: "Momsredovisningsperiod",
          vatMonthly: "Månadsvis",
          vatQuarterly: "Kvartalsvis",
          vatYearly: "Årsvis",
          fiscalYearRange: "Skatteår (12 månader)",
          taxYearFrom: "Från månad",
          taxYearTo: "Till månad",
          taxYearHint: "Välj startmånad. Slutmånad beräknas automatiskt.",
          swedishRegSection: "Svenska registreringsuppgifter",
          sniCode: "SNI-kod (branschkod)",
          sniCodeHint: "5-siffrig SNI 2007-kod som beskriver din verksamhet. Hämta på verksamt.se.",
          vatNumber: "Momsregistreringsnummer",
          vatNumberHint: "Format: SE + personnummer/orgnr + 01, t.ex. SE123456789001.",
          fSkattRegistered: "Godkänd för F-skatt",
          fSkattHint: "Anger att du är godkänd för F-skatt av Skatteverket. Ska anges på alla fakturor.",
          personnummer: "Personnummer (för deklaration)",
          personnummerHint: "Ditt personnummer används vid inkomstdeklaration. Lagras lokalt.",
          invoicing: "Fakturainställningar",
          numberingPattern: "Fakturanummermönster",
          numberingHint: "Använd {YYYY}, {YY}, {MM}, {DD} och {SEQ} eller {SEQ:4}.",
          companyAddress: "Företagsadress",
          senderName: "Avsändarnamn",
          senderOrgNumber: "Org.nr / Personnummer",
          senderEmail: "Avsändar-e-post",
          senderPhone: "Avsändartelefon",
          senderWebsite: "Avsändarwebbplats",
          emailFrom: "Från-adress för faktura-e-post",
          logo: "Standardlogotyp",
          signature: "Standardsignatur",
          chooseImage: "Välj bild",
          clearImage: "Rensa",
          paymentSection: "Så betalar dina kunder",
          paymentIntro:
            "Det du fyller i här skrivs ut på varje faktura tillsammans med belopp, förfallodatum och OCR-nummer. Fyll i det du använder, resten kan vara tomt.",
          bankgiro: "Bankgiro",
          plusgiro: "Plusgiro",
          swish: "Swish-nummer",
          iban: "IBAN (för betalningar från utlandet)",
          bic: "BIC (SWIFT)",
          looksRight: "Ser rätt ut",
          bicNeedsIban: "BIC används tillsammans med IBAN. Fyll i IBAN också.",
          ocrHint:
            "Varje ny faktura får ett OCR-nummer med kontrollsiffra och längdsiffra. Det går att använda även utan OCR-avtal med banken, och fungerar med bankens OCR-kontroll om du har ett sådant avtal.",
          paymentTerms: "Betalningsvillkor (dagar)",
          paymentTermsHint: "Förfallodatumet på nya fakturor sätts så här många dagar efter fakturadatumet. 30 dagar är vanligast mellan företag.",
          quotePattern: "Offertnummermönster",
          reminderSection: "Betalningspåminnelser",
          reminderToggle: "Skicka påminnelser automatiskt när en faktura är försenad",
          reminderDays: "Första påminnelsen, antal dagar efter förfallodatum",
          reminderRules: (days: number) =>
            `Första påminnelsen skickas ${days} ${days === 1 ? "dag" : "dagar"} efter förfallodatumet, därefter högst en gång per vecka och aldrig fler än tre per faktura. Bara fakturor som du har skickat och som har en e-postadress får påminnelser. Du kan alltid skicka en påminnelse själv från fakturan.`,
          reminderOff: "Avstängt. Du skickar påminnelser själv från fakturan när du vill.",
          reminderPreview: "Så här ser påminnelsen ut",
          reminderPreviewNote: "Exempel med påhittade uppgifter. Fakturan bifogas som PDF.",
          lawTitle: "Avgifter och ränta",
          loadFailed: "Betalningsuppgifterna kunde inte hämtas. Ladda om sidan innan du sparar.",
          taxRates: "Skatteprognosnivåer",
          taxRatesNote: "Ange decimalvärden. Exempel: 0.32 = 32 %.",
          municipalTax: "Kommunal skattesats",
          socialContribution: "Egenavgifter",
          deduction: "Allmänt avdrag (ca 25 % av egenavgifter)",
          save: "Spara inställningar",
          saving: "Sparar...",
          saved: "Inställningarna sparades.",
          savedLocalOnly: "Inställningarna sparades lokalt på den här datorn.",
          failed: "Kunde inte spara inställningar",
          unknownError: "Okänt fel",
          yes: "Ja",
          no: "Nej"
        }
      : {
          businessName: "Business name",
          jurisdiction: "Jurisdiction",
          sweden: "Sweden",
          euGeneric: "EU Generic (Template)",
          uk: "United Kingdom (Template)",
          language: "Language",
          english: "English",
          swedish: "Swedish",
          currency: "Currency",
          bookkeepingMethod: "Bookkeeping method",
          kontantmetoden: "Cash basis (Kontantmetoden)",
          fakturametoden: "Accrual basis (Fakturametoden)",
          vatRegistered: "VAT registered",
          vatFrequency: "VAT reporting period",
          vatMonthly: "Monthly",
          vatQuarterly: "Quarterly",
          vatYearly: "Annual",
          fiscalYearRange: "Tax Year (12 months)",
          taxYearFrom: "From month",
          taxYearTo: "To month",
          taxYearHint: "Choose the start month. The end month is calculated automatically.",
          swedishRegSection: "Swedish Registration Details",
          sniCode: "SNI code (Industry code)",
          sniCodeHint: "5-digit SNI 2007 code describing your business. Look up at verksamt.se.",
          vatNumber: "VAT registration number (Momsregistreringsnummer)",
          vatNumberHint: "Format: SE + personal/org number + 01, e.g. SE123456789001.",
          fSkattRegistered: "Approved for F-tax (F-skatt)",
          fSkattHint: "Indicates you are approved for F-tax by Skatteverket. Must be stated on all invoices.",
          personnummer: "Personal identity number (for tax return)",
          personnummerHint: "Your personnummer is used when filing Inkomstdeklaration 1. Stored locally only.",
          invoicing: "Invoice Settings",
          numberingPattern: "Invoice number pattern",
          numberingHint: "Use {YYYY}, {YY}, {MM}, {DD} and {SEQ} or {SEQ:4}.",
          companyAddress: "Company address",
          senderName: "Sender name",
          senderOrgNumber: "Org. / Personal number",
          senderEmail: "Sender email",
          senderPhone: "Sender phone",
          senderWebsite: "Sender website",
          emailFrom: "Invoice email from address",
          logo: "Default logo",
          signature: "Default signature",
          chooseImage: "Choose image",
          clearImage: "Clear",
          paymentSection: "How your customers pay",
          paymentIntro:
            "What you fill in here is printed on every invoice together with the amount, due date and OCR reference. Fill in what you use, the rest can stay empty.",
          bankgiro: "Bankgiro",
          plusgiro: "Plusgiro",
          swish: "Swish number",
          iban: "IBAN (for payments from abroad)",
          bic: "BIC (SWIFT)",
          looksRight: "Looks right",
          bicNeedsIban: "BIC is used together with IBAN. Fill in the IBAN too.",
          ocrHint:
            "Every new invoice gets an OCR reference with a check digit and a length digit. It can be used without an OCR agreement with your bank, and works with the bank's OCR control if you have one.",
          paymentTerms: "Payment terms (days)",
          paymentTermsHint: "The due date on new invoices is set this many days after the invoice date. 30 days is the most common between businesses.",
          quotePattern: "Quote number pattern",
          reminderSection: "Payment reminders",
          reminderToggle: "Send reminders automatically when an invoice is overdue",
          reminderDays: "First reminder, days after the due date",
          reminderRules: (days: number) =>
            `The first reminder is sent ${days} ${days === 1 ? "day" : "days"} after the due date, then at most once a week and never more than three per invoice. Only invoices you have sent and that have an email address get reminders. You can always send a reminder yourself from the invoice.`,
          reminderOff: "Off. You send reminders yourself from the invoice whenever you want.",
          reminderPreview: "What the reminder looks like",
          reminderPreviewNote: "Example with made-up details. The invoice is attached as a PDF.",
          lawTitle: "Fees and interest",
          loadFailed: "The payment details could not be loaded. Reload the page before saving.",
          taxRates: "Tax Projection Rates",
          taxRatesNote: "Set decimal rates. Example: 0.32 = 32%.",
          municipalTax: "Municipal tax rate",
          socialContribution: "Social contribution rate (Egenavgifter)",
          deduction: "General deduction (~25% of social contributions)",
          save: "Save Settings",
          saving: "Saving...",
          saved: "Settings saved.",
          savedLocalOnly: "Settings saved locally on this machine.",
          failed: "Failed to save settings",
          unknownError: "Unknown error",
          yes: "Yes",
          no: "No"
        };

  const [name, setName] = useState("");
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(initial.jurisdiction);
  const [locale, setLocale] = useState(initial.locale || "en");
  const [baseCurrency, setBaseCurrency] = useState(initial.baseCurrency || "SEK");
  const [bookkeepingMethod, setBookkeepingMethod] = useState(initial.bookkeepingMethod || "kontantmetoden");
  const [vatRegistered, setVatRegistered] = useState(initial.vatRegistered ?? true);
  const [vatFrequency, setVatFrequency] = useState(initial.vatFrequency || "yearly");
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(
    Number.isInteger(initial.fiscalYearStartMonth) ? initial.fiscalYearStartMonth : 1
  );
  // Swedish registration
  const [sniCode, setSniCode] = useState(initial.sniCode || "");
  const [vatNumber, setVatNumber] = useState(initial.vatNumber || "");
  const [fSkattRegistered, setFSkattRegistered] = useState(initial.fSkattRegistered ?? true);
  const [personnummer, setPersonnummer] = useState(initial.personnummer || "");
  // Invoice
  const [invoiceNumberPattern, setInvoiceNumberPattern] = useState(
    initial.invoiceNumberPattern || "INV-{YYYY}-{SEQ:4}"
  );
  const [invoiceSenderName, setInvoiceSenderName] = useState(initial.invoiceSenderName || "");
  const [invoiceSenderAddress, setInvoiceSenderAddress] = useState(initial.invoiceSenderAddress || "");
  const [invoiceSenderOrgNumber, setInvoiceSenderOrgNumber] = useState(initial.invoiceSenderOrgNumber || "");
  const [invoiceSenderEmail, setInvoiceSenderEmail] = useState(initial.invoiceSenderEmail || "");
  const [invoiceSenderPhone, setInvoiceSenderPhone] = useState(initial.invoiceSenderPhone || "");
  const [invoiceSenderWebsite, setInvoiceSenderWebsite] = useState(initial.invoiceSenderWebsite || "");
  const [invoiceEmailFrom, setInvoiceEmailFrom] = useState(initial.invoiceEmailFrom || "");
  const [invoiceDefaultLogo, setInvoiceDefaultLogo] = useState(initial.invoiceDefaultLogo || "");
  const [invoiceDefaultSignature, setInvoiceDefaultSignature] = useState(initial.invoiceDefaultSignature || "");
  // Payment details, terms, quotes and reminders
  const [bankgiro, setBankgiro] = useState(initial.bankgiro ?? "");
  const [plusgiro, setPlusgiro] = useState(initial.plusgiro ?? "");
  const [iban, setIban] = useState(initial.iban ?? "");
  const [bic, setBic] = useState(initial.bic ?? "");
  const [swishNumber, setSwishNumber] = useState(initial.swishNumber ?? "");
  const [paymentTermsDays, setPaymentTermsDays] = useState(String(initial.defaultPaymentTermsDays ?? 30));
  const [quoteNumberPattern, setQuoteNumberPattern] = useState(initial.quoteNumberPattern ?? "OFF-{YYYY}-{SEQ:4}");
  const [reminderEnabled, setReminderEnabled] = useState(initial.invoiceReminderEnabled ?? false);
  const [reminderDays, setReminderDays] = useState(String(initial.invoiceReminderDaysAfterDue ?? 7));
  // "ready" once the stored values are in the form. Until then they are not sent, so nothing is overwritten.
  const [paymentState, setPaymentState] = useState<"loading" | "ready" | "failed">(
    initial.defaultPaymentTermsDays === undefined ? "loading" : "ready"
  );
  // Tax rates
  const [municipalTaxRate, setMunicipalTaxRate] = useState(initial.taxConfig?.municipalTaxRate ?? 0.32);
  const [socialContributionRate, setSocialContributionRate] = useState(
    initial.taxConfig?.socialContributionRate ?? 0.2897
  );
  const [generalDeductionRate, setGeneralDeductionRate] = useState(
    initial.taxConfig?.generalDeductionRate ?? 0.25
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Hints preference — read/write via DB-backed context
  const { hintsEnabled: hintsOn, setHintsEnabled: setHintsOn } = useUserPreferences();

  const needsPaymentLoad = initial.defaultPaymentTermsDays === undefined;
  useEffect(() => {
    if (!needsPaymentLoad) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((stored: Record<string, unknown>) => {
        if (cancelled) return;
        const text = (key: string) => (typeof stored[key] === "string" ? (stored[key] as string) : "");
        setBankgiro(text("bankgiro"));
        setPlusgiro(text("plusgiro"));
        setIban(text("iban"));
        setBic(text("bic"));
        setSwishNumber(text("swishNumber"));
        if (typeof stored.defaultPaymentTermsDays === "number") setPaymentTermsDays(String(stored.defaultPaymentTermsDays));
        if (text("quoteNumberPattern")) setQuoteNumberPattern(text("quoteNumberPattern"));
        setReminderEnabled(stored.invoiceReminderEnabled === true);
        if (typeof stored.invoiceReminderDaysAfterDue === "number") setReminderDays(String(stored.invoiceReminderDaysAfterDue));
        setPaymentState("ready");
      })
      .catch(() => {
        if (!cancelled) setPaymentState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [needsPaymentLoad]);

  const accountValues: Record<PaymentAccountField, string> = { bankgiro, plusgiro, iban, bic, swishNumber };
  const accountCheck = (field: PaymentAccountField) => {
    const value = accountValues[field].trim();
    if (!value) return null;
    const result = parsePaymentAccount(field, value);
    return result.ok
      ? { ok: true as const, message: `${copy.looksRight}: ${paymentAccountLines({ [field]: result.value }).at(-1)?.value ?? result.value}` }
      : { ok: false as const, message: paymentAccountMessage(field, result.reason, uiLocale) };
  };
  const accountHint = (field: PaymentAccountField) => {
    const check = accountCheck(field);
    if (!check) return null;
    return <span className={check.ok ? "success" : "error"}>{check.message}</span>;
  };
  const termsNumber = Math.min(120, Math.max(0, Math.trunc(Number(paymentTermsDays) || 0)));
  const reminderDaysNumber = Math.min(60, Math.max(1, Math.trunc(Number(reminderDays) || 7)));
  const previewLocale = locale === "sv" ? "sv" : "en";
  const reminderPreview = buildReminderMessage({
    locale: previewLocale,
    senderName: invoiceSenderName || name || initial.name || (previewLocale === "sv" ? "Ditt företag" : "Your business"),
    customerName: previewLocale === "sv" ? "Exempelkund AB" : "Example Customer Ltd",
    invoiceNumber: "INV-2026-0042",
    amount: previewLocale === "sv" ? "12 500,00 kr" : "SEK 12,500.00",
    dueDate: "2026-10-31",
    daysOverdue: reminderDaysNumber,
    reminderNumber: 1,
    paymentLines: paymentAccountLines({
      bankgiro: accountCheck("bankgiro")?.ok ? bankgiro : "",
      plusgiro: accountCheck("plusgiro")?.ok ? plusgiro : "",
      swishNumber: accountCheck("swishNumber")?.ok ? swishNumber : "",
      iban: accountCheck("iban")?.ok ? iban : "",
      bic: accountCheck("bic")?.ok ? bic : ""
    }),
    ocrReference: buildOcrReference("INV-2026-0042")
  });

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

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    // Catch a mistyped account number before it can end up on an invoice.
    if (paymentState === "ready") {
      const fields: PaymentAccountField[] = ["bankgiro", "plusgiro", "swishNumber", "iban", "bic"];
      for (const field of fields) {
        const check = accountCheck(field);
        if (check && !check.ok) {
          setError(check.message);
          document.getElementById("invoice-payment")?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
      if (bic.trim() && !iban.trim()) {
        setError(copy.bicNeedsIban);
        return;
      }
    }

    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // An untouched name field means "keep the current name".
          name: name.trim() || initial.name,
          jurisdiction,
          locale,
          baseCurrency,
          bookkeepingMethod,
          vatRegistered,
          vatFrequency,
          fiscalYearStartMonth,
          sniCode,
          vatNumber,
          fSkattRegistered,
          personnummer,
          invoiceNumberPattern,
          invoiceSenderName,
          invoiceSenderAddress,
          invoiceSenderOrgNumber,
          invoiceSenderEmail,
          invoiceSenderPhone,
          invoiceSenderWebsite,
          invoiceEmailFrom,
          invoiceDefaultLogo,
          invoiceDefaultSignature,
          ...(paymentState === "ready"
            ? {
                bankgiro: bankgiro.trim(),
                plusgiro: plusgiro.trim(),
                iban: iban.trim(),
                bic: bic.trim(),
                swishNumber: swishNumber.trim(),
                defaultPaymentTermsDays: termsNumber,
                quoteNumberPattern: quoteNumberPattern.trim() || undefined,
                invoiceReminderEnabled: reminderEnabled,
                invoiceReminderDaysAfterDue: reminderDaysNumber
              }
            : {}),
          municipalTaxRate: Number(municipalTaxRate),
          socialContributionRate: Number(socialContributionRate),
          generalDeductionRate: Number(generalDeductionRate)
        })
      });

      const raw = await response.text();
      let json: { error?: string; savedLocally?: boolean; warning?: string } | null = null;
      if (raw) {
        try {
          json = JSON.parse(raw) as { error?: string };
        } catch {
          json = null;
        }
      }

      if (!response.ok) {
        const fallback = raw && !raw.startsWith("<") ? raw : copy.failed;
        throw new Error(json?.error ?? fallback);
      }

      // Sync locale cookie so the UI updates without a full reload
      rememberLocale(locale);

      setSuccess(json?.savedLocally ? copy.savedLocalOnly : copy.saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.unknownError);
    } finally {
      setSaving(false);
    }
  };

  const monthFormatter = new Intl.DateTimeFormat(uiLocale === "sv" ? "sv-SE" : "en-GB", { month: "long" });
  const monthOptions = Array.from({ length: 12 }, (_value, index) => ({
    value: index + 1,
    label: monthFormatter.format(new Date(Date.UTC(2026, index, 1)))
  }));
  const fiscalYearEndMonth = fiscalYearStartMonth === 1 ? 12 : fiscalYearStartMonth - 1;

  return (
    <form className="stack" onSubmit={save}>
      {/* ── Business Basics ─────────────────────────────────────────── */}
      <label className="stack">
        {copy.businessName}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={initial.name || (uiLocale === "sv" ? "Ditt företagsnamn" : "Your business name")}
        />
      </label>

      <label className="stack">
        {copy.companyAddress}
        <textarea
          rows={3}
          value={invoiceSenderAddress}
          onChange={(event) => setInvoiceSenderAddress(event.target.value)}
          placeholder={uiLocale === "sv" ? "Gatuadress, postnummer, stad" : "Street address, postcode, city"}
        />
      </label>

      <div className="row">
        <label className="stack">
          {copy.jurisdiction}
          <select
            value={jurisdiction}
            onChange={(event) => setJurisdiction(event.target.value as Jurisdiction)}
          >
            <option value={Jurisdictions.SWEDEN}>{copy.sweden}</option>
            <option value={Jurisdictions.EU_GENERIC}>{copy.euGeneric}</option>
            <option value={Jurisdictions.UK}>{copy.uk}</option>
          </select>
        </label>

        <label className="stack">
          {copy.language}
          <select value={locale} onChange={(event) => setLocale(event.target.value)}>
            <option value="en">{copy.english}</option>
            <option value="sv">{copy.swedish}</option>
          </select>
        </label>

        <label className="stack">
          {copy.currency}
          <select value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value)}>
            <option value="SEK">SEK</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </label>
      </div>

      <div className="row">
        <label className="stack">
          {copy.bookkeepingMethod}
          <select value={bookkeepingMethod} onChange={(event) => setBookkeepingMethod(event.target.value)}>
            <option value="kontantmetoden">{copy.kontantmetoden}</option>
            <option value="fakturametoden">{copy.fakturametoden}</option>
          </select>
        </label>

        <label className="stack">
          {copy.vatFrequency}
          <select value={vatFrequency} onChange={(event) => setVatFrequency(event.target.value)}>
            <option value="monthly">{copy.vatMonthly}</option>
            <option value="quarterly">{copy.vatQuarterly}</option>
            <option value="yearly">{copy.vatYearly}</option>
          </select>
        </label>

        <label className="stack">
          {copy.vatRegistered}
          <select
            value={vatRegistered ? "yes" : "no"}
            onChange={(event) => setVatRegistered(event.target.value === "yes")}
          >
            <option value="yes">{copy.yes}</option>
            <option value="no">{copy.no}</option>
          </select>
        </label>
      </div>

      <h3>{copy.fiscalYearRange}</h3>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="stack">
          {copy.taxYearFrom}
          <select
            value={String(fiscalYearStartMonth)}
            onChange={(event) => setFiscalYearStartMonth(Number(event.target.value))}
          >
            {monthOptions.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
        </label>

        <label className="stack">
          {copy.taxYearTo}
          <input value={monthOptions[fiscalYearEndMonth - 1]?.label ?? ""} readOnly />
        </label>
      </div>
      <HintTip text={copy.taxYearHint} />

      {/* ── Swedish Registration Details ─────────────────────────────── */}
      <h3>{copy.swedishRegSection}</h3>

      <div className="row">
        <label className="stack">
          {copy.sniCode}
          <input
            value={sniCode}
            onChange={(event) => setSniCode(event.target.value)}
            placeholder="62010"
            maxLength={10}
          />
          <HintTip text={copy.sniCodeHint} />
        </label>

        <label className="stack">
          {copy.vatNumber}
          <input
            value={vatNumber}
            onChange={(event) => setVatNumber(event.target.value)}
            placeholder="SE123456789001"
            maxLength={30}
          />
          <HintTip text={copy.vatNumberHint} />
        </label>
      </div>

      <div className="row">
        <label className="stack">
          {copy.fSkattRegistered}
          <select
            value={fSkattRegistered ? "yes" : "no"}
            onChange={(event) => setFSkattRegistered(event.target.value === "yes")}
          >
            <option value="yes">{copy.yes}</option>
            <option value="no">{copy.no}</option>
          </select>
          <HintTip text={copy.fSkattHint} />
        </label>

        <label className="stack">
          {copy.personnummer}
          <input
            value={personnummer}
            onChange={(event) => setPersonnummer(event.target.value)}
            placeholder="YYYYMMDD-XXXX"
            maxLength={20}
            autoComplete="off"
          />
          <HintTip text={copy.personnummerHint} />
        </label>
      </div>

      {/* ── Invoice Settings ─────────────────────────────────────────── */}
      <h3>{copy.invoicing}</h3>

      <label className="stack">
        {copy.numberingPattern}
        <input
          value={invoiceNumberPattern}
          onChange={(event) => setInvoiceNumberPattern(event.target.value)}
          placeholder="INV-{YYYY}-{SEQ:4}"
        />
        <HintTip text={copy.numberingHint} />
      </label>

      <div className="row">
        <label className="stack">
          {copy.senderName}
          <input value={invoiceSenderName} onChange={(event) => setInvoiceSenderName(event.target.value)} />
        </label>
        <label className="stack">
          {copy.senderOrgNumber}
          <input value={invoiceSenderOrgNumber} onChange={(event) => setInvoiceSenderOrgNumber(event.target.value)} />
        </label>
        <label className="stack">
          {copy.senderEmail}
          <input
            type="email"
            value={invoiceSenderEmail}
            onChange={(event) => setInvoiceSenderEmail(event.target.value)}
          />
        </label>
      </div>

      <div className="row">
        <label className="stack">
          {copy.senderPhone}
          <input value={invoiceSenderPhone} onChange={(event) => setInvoiceSenderPhone(event.target.value)} />
        </label>
        <label className="stack">
          {copy.senderWebsite}
          <input value={invoiceSenderWebsite} onChange={(event) => setInvoiceSenderWebsite(event.target.value)} />
        </label>
        <label className="stack">
          {copy.emailFrom}
          <input type="email" value={invoiceEmailFrom} onChange={(event) => setInvoiceEmailFrom(event.target.value)} />
        </label>
      </div>

      <div className="row">
        <label className="stack">
          {copy.logo}
          <input type="file" accept="image/*" onChange={(event) => onImageSelect(event, setInvoiceDefaultLogo)} />
          {invoiceDefaultLogo ? (
            <div className="row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={invoiceDefaultLogo} alt="Invoice logo preview" style={{ maxHeight: 42 }} />
              <button type="button" className="secondary" onClick={() => setInvoiceDefaultLogo("")}>
                {copy.clearImage}
              </button>
            </div>
          ) : (
            <span className="note">{copy.chooseImage}</span>
          )}
        </label>

        <label className="stack">
          {copy.signature}
          <input
            type="file"
            accept="image/*"
            onChange={(event) => onImageSelect(event, setInvoiceDefaultSignature)}
          />
          {invoiceDefaultSignature ? (
            <div className="row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={invoiceDefaultSignature} alt="Invoice signature preview" style={{ maxHeight: 42 }} />
              <button type="button" className="secondary" onClick={() => setInvoiceDefaultSignature("")}>
                {copy.clearImage}
              </button>
            </div>
          ) : (
            <span className="note">{copy.chooseImage}</span>
          )}
        </label>
      </div>

      {/* ── How customers pay ───────────────────────────────────────── */}
      <h3 id="invoice-payment">{copy.paymentSection}</h3>
      <p className="note">{copy.paymentIntro}</p>
      {paymentState === "failed" && <p className="error">{copy.loadFailed}</p>}

      <fieldset className="stack" disabled={paymentState !== "ready"} style={{ border: "none", padding: 0, margin: 0 }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="stack">
            {copy.bankgiro}
            <input
              value={bankgiro}
              onChange={(event) => setBankgiro(event.target.value)}
              placeholder="123-4567"
              inputMode="numeric"
              maxLength={20}
            />
            {accountHint("bankgiro")}
          </label>
          <label className="stack">
            {copy.plusgiro}
            <input
              value={plusgiro}
              onChange={(event) => setPlusgiro(event.target.value)}
              placeholder="12 34 56-7"
              inputMode="numeric"
              maxLength={20}
            />
            {accountHint("plusgiro")}
          </label>
          <label className="stack">
            {copy.swish}
            <input
              value={swishNumber}
              onChange={(event) => setSwishNumber(event.target.value)}
              placeholder="123 456 78 90"
              inputMode="tel"
              maxLength={20}
            />
            {accountHint("swishNumber")}
          </label>
        </div>

        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="stack">
            {copy.iban}
            <input
              value={iban}
              onChange={(event) => setIban(event.target.value)}
              placeholder="SE35 5000 0000 0549 1000 0003"
              maxLength={42}
              autoCapitalize="characters"
            />
            {accountHint("iban")}
          </label>
          <label className="stack">
            {copy.bic}
            <input
              value={bic}
              onChange={(event) => setBic(event.target.value)}
              placeholder="ESSESESS"
              maxLength={14}
              autoCapitalize="characters"
            />
            {accountHint("bic")}
          </label>
        </div>
        <p className="note">{copy.ocrHint}</p>

        <div className="row" style={{ alignItems: "flex-start" }}>
          <label className="stack">
            {copy.paymentTerms}
            <input
              type="number"
              min={0}
              max={120}
              step={1}
              value={paymentTermsDays}
              onChange={(event) => setPaymentTermsDays(event.target.value)}
            />
            <HintTip text={copy.paymentTermsHint} />
          </label>
          <label className="stack">
            {copy.quotePattern}
            <input
              value={quoteNumberPattern}
              onChange={(event) => setQuoteNumberPattern(event.target.value)}
              placeholder="OFF-{YYYY}-{SEQ:4}"
              maxLength={80}
            />
            <HintTip text={copy.numberingHint} />
          </label>
        </div>

        {/* ── Reminders ─────────────────────────────────────────────── */}
        <h3 id="invoice-reminders">{copy.reminderSection}</h3>
        <label>
          <input
            type="checkbox"
            checked={reminderEnabled}
            onChange={(event) => setReminderEnabled(event.target.checked)}
          />{" "}
          {copy.reminderToggle}
        </label>
        {reminderEnabled ? (
          <>
            <div className="row">
              <label className="stack" style={{ maxWidth: 360 }}>
                {copy.reminderDays}
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={reminderDays}
                  onChange={(event) => setReminderDays(event.target.value)}
                />
              </label>
            </div>
            <p className="note">{copy.reminderRules(reminderDaysNumber)}</p>
          </>
        ) : (
          <p className="note">{copy.reminderOff}</p>
        )}

        <details>
          <summary>{copy.reminderPreview}</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <p className="note">{copy.reminderPreviewNote}</p>
            <p>
              <strong>{reminderPreview.subject}</strong>
            </p>
            <p style={{ whiteSpace: "pre-line", margin: 0 }}>{reminderPreview.body}</p>
          </div>
        </details>

        <div className="stack">
          <strong>{copy.lawTitle}</strong>
          {reminderLawNote(uiLocale).map((paragraph) => (
            <p key={paragraph} className="note">
              {paragraph}
            </p>
          ))}
        </div>
      </fieldset>

      {/* ── Tax Projection Rates ─────────────────────────────────────── */}
      <h3>{copy.taxRates}</h3>
      <p className="note">{copy.taxRatesNote}</p>

      <div className="row">
        <label className="stack">
          {copy.municipalTax}
          <input
            type="number"
            step="0.0001"
            min={0}
            max={1}
            value={municipalTaxRate}
            onChange={(event) => setMunicipalTaxRate(Number(event.target.value))}
          />
        </label>

        <label className="stack">
          {copy.socialContribution}
          <input
            type="number"
            step="0.0001"
            min={0}
            max={1}
            value={socialContributionRate}
            onChange={(event) => setSocialContributionRate(Number(event.target.value))}
          />
        </label>

        <label className="stack">
          {copy.deduction}
          <input
            type="number"
            step="0.0001"
            min={0}
            max={1}
            value={generalDeductionRate}
            onChange={(event) => setGeneralDeductionRate(Number(event.target.value))}
          />
        </label>
      </div>

      {/* ── Help hints preference ───────────────────────────────────── */}
      <div className="hintsToggleRow">
        <span className="hintsToggleLabel">
          {uiLocale === "sv" ? "Visa hjälptips i formulär" : "Show help hints in forms"}
        </span>
        <button
          type="button"
          className={`hintsToggleBtn${hintsOn ? " hintsToggleBtnOn" : ""}`}
          onClick={() => void setHintsOn(!hintsOn)}
          aria-pressed={hintsOn}
        >
          {hintsOn
            ? (uiLocale === "sv" ? "På" : "On")
            : (uiLocale === "sv" ? "Av" : "Off")}
        </button>
      </div>

      <div className="row">
        <button type="submit" disabled={saving}>
          {saving ? copy.saving : copy.save}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
    </form>
  );
};
