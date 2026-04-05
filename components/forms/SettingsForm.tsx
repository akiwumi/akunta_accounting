"use client";

import { useState } from "react";
import { Jurisdictions, type Jurisdiction } from "@/lib/domain/enums";
import { type Locale } from "@/lib/i18n/locale";

type SettingsFormProps = {
  locale: Locale;
  initial: {
    name: string;
    jurisdiction: Jurisdiction;
    locale: string;
    baseCurrency: string;
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
          invoicing: "Fakturainställningar",
          numberingPattern: "Fakturanummermönster",
          numberingHint: "Använd {YYYY}, {YY}, {MM}, {DD} och {SEQ} eller {SEQ:4}.",
          senderName: "Avsändarnamn",
          senderAddress: "Avsändaradress",
          senderOrgNumber: "Org.nr",
          senderEmail: "Avsändar-e-post",
          senderPhone: "Avsändartelefon",
          senderWebsite: "Avsändarwebbplats",
          emailFrom: "Från-adress för faktura-e-post",
          logo: "Standardlogotyp",
          signature: "Standardsignatur",
          chooseImage: "Välj bild",
          clearImage: "Rensa",
          taxRates: "Skatteprognosnivåer",
          taxRatesNote: "Ange decimalvärden. Exempel: 0.32 = 32%.",
          municipalTax: "Kommunal skattesats",
          socialContribution: "Egenavgifter",
          deduction: "Allmänt avdrag",
          save: "Spara inställningar",
          saving: "Sparar...",
          saved: "Inställningarna sparades.",
          failed: "Kunde inte spara inställningar",
          unknownError: "Okänt fel"
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
          invoicing: "Invoice Settings",
          numberingPattern: "Invoice number pattern",
          numberingHint: "Use {YYYY}, {YY}, {MM}, {DD} and {SEQ} or {SEQ:4}.",
          senderName: "Sender name",
          senderAddress: "Sender address",
          senderOrgNumber: "Registration no.",
          senderEmail: "Sender email",
          senderPhone: "Sender phone",
          senderWebsite: "Sender website",
          emailFrom: "Invoice email from address",
          logo: "Default logo",
          signature: "Default signature",
          chooseImage: "Choose image",
          clearImage: "Clear",
          taxRates: "Tax Projection Rates",
          taxRatesNote: "Set decimal rates. Example: 0.32 = 32%.",
          municipalTax: "Municipal tax rate",
          socialContribution: "Social contribution rate",
          deduction: "General deduction rate",
          save: "Save Settings",
          saving: "Saving...",
          saved: "Settings saved.",
          failed: "Failed to save settings",
          unknownError: "Unknown error"
        };

  const [name, setName] = useState(initial.name);
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(initial.jurisdiction);
  const [locale, setLocale] = useState(initial.locale || "en");
  const [baseCurrency, setBaseCurrency] = useState(initial.baseCurrency || "SEK");
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
  const [municipalTaxRate, setMunicipalTaxRate] = useState(
    initial.taxConfig?.municipalTaxRate ?? 0.32
  );
  const [socialContributionRate, setSocialContributionRate] = useState(
    initial.taxConfig?.socialContributionRate ?? 0.2897
  );
  const [generalDeductionRate, setGeneralDeductionRate] = useState(
    initial.taxConfig?.generalDeductionRate ?? 0.25
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          jurisdiction,
          locale,
          baseCurrency,
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
          municipalTaxRate: Number(municipalTaxRate),
          socialContributionRate: Number(socialContributionRate),
          generalDeductionRate: Number(generalDeductionRate)
        })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? copy.failed);
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale })
      });
      setSuccess(copy.saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.unknownError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      <label className="stack">
        {copy.businessName}
        <input value={name} onChange={(event) => setName(event.target.value)} />
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

      <h3>{copy.invoicing}</h3>

      <label className="stack">
        {copy.numberingPattern}
        <input
          value={invoiceNumberPattern}
          onChange={(event) => setInvoiceNumberPattern(event.target.value)}
          placeholder="INV-{YYYY}-{SEQ:4}"
        />
        <span className="note">{copy.numberingHint}</span>
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

      <label className="stack">
        {copy.senderAddress}
        <textarea
          rows={3}
          value={invoiceSenderAddress}
          onChange={(event) => setInvoiceSenderAddress(event.target.value)}
        />
      </label>

      <div className="row">
        <label className="stack">
          {copy.logo}
          <input type="file" accept="image/*" onChange={(event) => onImageSelect(event, setInvoiceDefaultLogo)} />
          {invoiceDefaultLogo ? (
            <div className="row">
              <img src={invoiceDefaultLogo} alt="Invoice logo preview" style={{ maxHeight: 42 }} />
              <button
                type="button"
                className="secondary"
                onClick={() => setInvoiceDefaultLogo("")}
              >
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
              <img src={invoiceDefaultSignature} alt="Invoice signature preview" style={{ maxHeight: 42 }} />
              <button
                type="button"
                className="secondary"
                onClick={() => setInvoiceDefaultSignature("")}
              >
                {copy.clearImage}
              </button>
            </div>
          ) : (
            <span className="note">{copy.chooseImage}</span>
          )}
        </label>
      </div>

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
