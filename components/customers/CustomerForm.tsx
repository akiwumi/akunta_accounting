"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

export type CustomerFormValues = {
  name: string;
  email: string;
  phone: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string;
  notes: string;
};

type CustomerFormProps = {
  locale: Locale;
  /** Set when editing an existing customer. */
  customerId?: string;
  initial?: Partial<CustomerFormValues>;
  /** Shown instead of the delete button when the customer cannot be deleted. */
  deleteBlockedReason?: string | null;
};

const blank: CustomerFormValues = {
  name: "",
  email: "",
  phone: "",
  website: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  city: "",
  country: "",
  notes: ""
};

export const CustomerForm = ({ locale, customerId, initial, deleteBlockedReason }: CustomerFormProps) => {
  const router = useRouter();
  const sv = locale === "sv";
  const editing = Boolean(customerId);
  const [values, setValues] = useState<CustomerFormValues>({ ...blank, ...initial });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const copy = sv
    ? {
        name: "Namn",
        namePlaceholder: "Företag eller person",
        email: "E-post",
        emailHint: "Hit skickas fakturor, offerter och påminnelser.",
        phone: "Telefon",
        website: "Webbplats",
        address1: "Adress",
        address2: "Adressrad 2",
        postal: "Postnummer",
        city: "Ort",
        country: "Land",
        notes: "Egna anteckningar (visas aldrig för kunden)",
        create: "Lägg till kund",
        save: "Spara ändringar",
        saving: "Sparar...",
        saved: "Kunden är sparad.",
        created: "Kunden är tillagd.",
        updatedExisting: "Det fanns redan en kund med den e-postadressen. Uppgifterna är uppdaterade.",
        remove: "Ta bort kund",
        confirmRemove: "Ta bort kunden för gott?",
        yesRemove: "Ja, ta bort",
        cancel: "Avbryt",
        failed: "Det gick inte att spara. Försök igen."
      }
    : {
        name: "Name",
        namePlaceholder: "Company or person",
        email: "Email",
        emailHint: "Invoices, quotes and reminders are sent here.",
        phone: "Phone",
        website: "Website",
        address1: "Address",
        address2: "Address line 2",
        postal: "Postal code",
        city: "City",
        country: "Country",
        notes: "Your own notes (never shown to the customer)",
        create: "Add customer",
        save: "Save changes",
        saving: "Saving...",
        saved: "The customer is saved.",
        created: "The customer has been added.",
        updatedExisting: "There was already a customer with that email address. The details have been updated.",
        remove: "Delete customer",
        confirmRemove: "Delete this customer for good?",
        yesRemove: "Yes, delete",
        cancel: "Cancel",
        failed: "Could not save. Please try again."
      };

  const set = (patch: Partial<CustomerFormValues>) => setValues((current) => ({ ...current, ...patch }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(editing ? `/api/customers/${customerId}` : "/api/customers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        customer?: { id: string };
        updatedExisting?: boolean;
      };
      if (!response.ok || !json.customer) throw new Error(json.error || copy.failed);

      if (editing) {
        setSuccess(copy.saved);
        router.refresh();
      } else {
        setSuccess(json.updatedExisting ? copy.updatedExisting : copy.created);
        setValues(blank);
        router.push(`/customers/${json.customer.id}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/${customerId}`, { method: "DELETE" });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error || copy.failed);
      router.push("/customers");
      router.refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : copy.failed);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="row">
        <label className="stack">
          {copy.name}
          <input
            value={values.name}
            placeholder={copy.namePlaceholder}
            onChange={(event) => set({ name: event.target.value })}
            maxLength={120}
            required
          />
        </label>
        <label className="stack">
          {copy.email}
          <input type="email" value={values.email} onChange={(event) => set({ email: event.target.value })} maxLength={120} />
        </label>
      </div>
      <p className="note">{copy.emailHint}</p>
      <div className="row">
        <label className="stack">
          {copy.address1}
          <input value={values.addressLine1} onChange={(event) => set({ addressLine1: event.target.value })} />
        </label>
        <label className="stack">
          {copy.address2}
          <input value={values.addressLine2} onChange={(event) => set({ addressLine2: event.target.value })} />
        </label>
      </div>
      <div className="row">
        <label className="stack">
          {copy.postal}
          <input value={values.postalCode} onChange={(event) => set({ postalCode: event.target.value })} />
        </label>
        <label className="stack">
          {copy.city}
          <input value={values.city} onChange={(event) => set({ city: event.target.value })} />
        </label>
        <label className="stack">
          {copy.country}
          <input value={values.country} onChange={(event) => set({ country: event.target.value })} />
        </label>
      </div>
      <div className="row">
        <label className="stack">
          {copy.phone}
          <input value={values.phone} onChange={(event) => set({ phone: event.target.value })} />
        </label>
        <label className="stack">
          {copy.website}
          <input value={values.website} onChange={(event) => set({ website: event.target.value })} />
        </label>
      </div>
      <label className="stack">
        {copy.notes}
        <textarea rows={2} value={values.notes} onChange={(event) => set({ notes: event.target.value })} maxLength={500} />
      </label>

      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? copy.saving : editing ? copy.save : copy.create}
        </button>
        {editing && !deleteBlockedReason && !confirmDelete && (
          <button type="button" className="secondary" onClick={() => setConfirmDelete(true)}>
            {copy.remove}
          </button>
        )}
        {editing && confirmDelete && (
          <>
            <span className="note">{copy.confirmRemove}</span>
            <button type="button" className="secondary" onClick={() => void remove()} disabled={busy}>
              {copy.yesRemove}
            </button>
            <button type="button" className="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
              {copy.cancel}
            </button>
          </>
        )}
      </div>
      {editing && deleteBlockedReason && <p className="note">{deleteBlockedReason}</p>}
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
    </form>
  );
};
