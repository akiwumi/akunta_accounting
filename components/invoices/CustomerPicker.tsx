"use client";

import { useMemo, useState } from "react";

import {
  type CustomerDraft,
  type CustomerOption,
  customerAddressLine,
  customerFromOption
} from "@/lib/invoices/drafts";
import { type Locale } from "@/lib/i18n/locale";

type CustomerPickerProps = {
  locale: Locale;
  value: CustomerDraft;
  onChange: (customer: CustomerDraft) => void;
  options: CustomerOption[];
};

export const CustomerPicker = ({ locale, value, onChange, options }: CustomerPickerProps) => {
  const [focused, setFocused] = useState(false);
  const copy =
    locale === "sv"
      ? {
          name: "Kund",
          namePlaceholder: "Börja skriva för att välja en sparad kund",
          email: "E-post",
          phone: "Telefon",
          website: "Webbplats",
          address1: "Adress",
          address2: "Adressrad 2",
          postal: "Postnummer",
          city: "Ort",
          country: "Land",
          more: "Adress och fler uppgifter",
          saved: "Sparad kund. Ändringar du gör här sparas på kunden.",
          fresh: "Ny kund. Uppgifterna sparas i kundregistret när du sparar."
        }
      : {
          name: "Customer",
          namePlaceholder: "Start typing to pick a saved customer",
          email: "Email",
          phone: "Phone",
          website: "Website",
          address1: "Address",
          address2: "Address line 2",
          postal: "Postal code",
          city: "City",
          country: "Country",
          more: "Address and more details",
          saved: "Saved customer. Changes you make here are saved on the customer.",
          fresh: "New customer. The details are saved to your customer register when you save."
        };

  const suggestions = useMemo(() => {
    const query = value.name.trim().toLowerCase();
    const matches = query
      ? options.filter((option) =>
          [option.name, option.email ?? "", option.phone ?? ""].join(" ").toLowerCase().includes(query)
        )
      : options;
    return matches.slice(0, 6);
  }, [value.name, options]);

  const set = (patch: Partial<CustomerDraft>) => onChange({ ...value, ...patch });
  const showSuggestions = focused && !value.id && suggestions.length > 0;
  const hasAddress = Boolean(customerAddressLine(value) || value.phone || value.website);

  return (
    <div className="stack">
      <label className="stack">
        {copy.name}
        <input
          value={value.name}
          placeholder={copy.namePlaceholder}
          onChange={(event) => set({ id: undefined, name: event.target.value })}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          autoComplete="off"
          maxLength={120}
          required
        />
      </label>

      {showSuggestions && (
        <div className="invoiceCustomerSuggestions">
          {suggestions.map((option) => (
            <button
              key={option.id}
              type="button"
              className="invoiceCustomerOption"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(customerFromOption(option));
                setFocused(false);
              }}
            >
              <strong>{option.name}</strong>
              <span>{[option.email, option.city].filter(Boolean).join(", ") || "-"}</span>
            </button>
          ))}
        </div>
      )}

      {value.name.trim() && <p className="note">{value.id ? copy.saved : copy.fresh}</p>}

      <label className="stack">
        {copy.email}
        <input type="email" value={value.email} onChange={(event) => set({ email: event.target.value })} maxLength={120} />
      </label>

      <details open={hasAddress || undefined}>
        <summary>{copy.more}</summary>
        <div className="stack invoiceSectionBody">
          <label className="stack">
            {copy.address1}
            <input value={value.addressLine1} onChange={(event) => set({ addressLine1: event.target.value })} />
          </label>
          <label className="stack">
            {copy.address2}
            <input value={value.addressLine2} onChange={(event) => set({ addressLine2: event.target.value })} />
          </label>
          <div className="row">
            <label className="stack">
              {copy.postal}
              <input value={value.postalCode} onChange={(event) => set({ postalCode: event.target.value })} />
            </label>
            <label className="stack">
              {copy.city}
              <input value={value.city} onChange={(event) => set({ city: event.target.value })} />
            </label>
            <label className="stack">
              {copy.country}
              <input value={value.country} onChange={(event) => set({ country: event.target.value })} />
            </label>
          </div>
          <div className="row">
            <label className="stack">
              {copy.phone}
              <input value={value.phone} onChange={(event) => set({ phone: event.target.value })} />
            </label>
            <label className="stack">
              {copy.website}
              <input value={value.website} onChange={(event) => set({ website: event.target.value })} />
            </label>
          </div>
        </div>
      </details>
    </div>
  );
};
