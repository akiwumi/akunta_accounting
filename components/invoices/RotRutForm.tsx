"use client";

import { formatMoney } from "@/lib/data/format";
import { type LineItemDraft, rotRutDraftLines } from "@/lib/invoices/drafts";
import {
  computeRotRut,
  parseOrgNumber,
  parsePersonnummer,
  rotRutErrorText,
  rotRutRateFor,
  rotRutRuleFor,
  type RotRutType
} from "@/lib/invoices/rotrut";
import { type Locale } from "@/lib/i18n/locale";

/** What the invoice form holds for ROT/RUT while the user is typing. */
export type RotRutDraft = {
  type: RotRutType;
  personnummer: string;
  housing: "property" | "apartment";
  propertyDesignation: string;
  brfOrgNumber: string;
  apartmentNumber: string;
  subcontractor: boolean;
  staffingAgency: boolean;
};

export const emptyRotRutDraft = (): RotRutDraft => ({
  type: "ROT",
  personnummer: "",
  housing: "property",
  propertyDesignation: "",
  brfOrgNumber: "",
  apartmentNumber: "",
  subcontractor: false,
  staffingAgency: false
});

/** The ROT/RUT part of the invoice request body. */
export const rotRutPayload = (draft: RotRutDraft) => ({
  type: draft.type,
  personnummer: draft.personnummer.trim(),
  ...(draft.type === "ROT"
    ? draft.housing === "apartment"
      ? { housing: "apartment" as const, brfOrgNumber: draft.brfOrgNumber.trim(), apartmentNumber: draft.apartmentNumber.trim() }
      : { housing: "property" as const, propertyDesignation: draft.propertyDesignation.trim() }
    : {}),
  subcontractor: draft.subcontractor,
  staffingAgency: draft.staffingAgency
});

type RotRutFormProps = {
  locale: Locale;
  /** Null: the customer gets neither. */
  value: RotRutDraft | null;
  onChange: (value: RotRutDraft | null) => void;
  /** False: the business is not approved for F-skatt, so the question is not asked. */
  fSkatt: boolean;
  /** True: fakturametoden, where ROT/RUT is not available yet. */
  accrual: boolean;
  currency: string;
  issueDate: string;
  dueDate: string;
  items: LineItemDraft[];
};

/**
 * "Does the customer get ROT or RUT on this invoice?" and, when the answer
 * is yes, the buyer's details and what everyone pays, worked out live.
 */
export const RotRutForm = ({ locale, value, onChange, fSkatt, accrual, currency, issueDate, dueDate, items }: RotRutFormProps) => {
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";
  const money = (amount: number) => formatMoney(amount, "SEK", numberLocale);

  if (!fSkatt) return null;

  const copy = sv
    ? {
        question: "Kunden får rot- eller rutavdrag på den här fakturan",
        accrual:
          "Rot och rut går ännu inte att använda med fakturametoden i Akunta, eftersom bokföringen av fakturor där inte är klar. Med kontantmetoden fungerar det.",
        currency: "Rot och rut kräver en faktura i svenska kronor. Byt valuta till SEK.",
        which: "Vilket avdrag?",
        rot: "Rot: reparation, ombyggnad, tillbyggnad",
        rut: "Rut: städning, trädgård, flytt och andra hushållsnära tjänster",
        buyer: "Kundens personnummer",
        buyerHint: "Den som ska få avdraget. Skrivs på fakturan och i begäran till Skatteverket, och visas inte i listor.",
        oneBuyer:
          "En faktura som ska delas mellan flera personer stöds inte ännu. Gör en faktura per person, med den personens del av arbetet.",
        home: "Var utfördes arbetet?",
        house: "Hus eller ägarlägenhet",
        flat: "Bostadsrätt",
        designation: "Fastighetsbeteckning",
        designationHint: "Till exempel Sollentuna Eken 12. Kunden hittar den i sitt lagfartsbevis eller hos Lantmäteriet.",
        brf: "Bostadsrättsföreningens organisationsnummer",
        apartment: "Lägenhetsnummer",
        apartmentHint: "Föreningens nummer på lägenheten, vanligen fyra siffror.",
        helpers: "Skatteverket frågar efter det här från 1 januari 2027:",
        subcontractor: "Jag anlitade en underentreprenör för arbetet",
        staffing: "Jag anlitade ett bemanningsföretag för arbetet",
        total: "Fakturan totalt",
        labour: "Varav arbete (inkl. moms)",
        reduction: (percent: number) => `Skattereduktion, ${percent} % av arbetet`,
        customerPays: "Kunden betalar",
        youRequest: "Du begär från Skatteverket",
        noLabour: "Ingen rad är markerad som arbete ännu, så det blir inget avdrag.",
        capped: (cap: string) => `Avdraget är begränsat till ${cap}, det högsta en person kan få per år.`,
        cap: (word: string, cap: string, total: string) =>
          `En person kan få högst ${cap} i ${word}avdrag per år (rot och rut tillsammans högst ${total}). Akunta kan inte se hur mycket kunden redan har använt i år. Be kunden kontrollera det i Skatteverkets e-tjänst "Mina skattereduktioner för rot, rut och grön teknik". Betalar Skatteverket ut mindre än du begär får kunden betala mellanskillnaden till dig.`,
        steps:
          "Så går det till: kunden betalar sin del elektroniskt (inte kontant). När betalningen är registrerad här hämtar du en fil och skickar in begäran i Skatteverkets e-tjänst. Akunta visar när och hur.",
        rateChange: (issue: number, due: number) =>
          `Obs: avdraget är ${issue} % för betalningar på fakturadatumet men ${due} % på förfallodatumet. Det är dagen kunden betalar som avgör.`
      }
    : {
        question: "The customer gets ROT or RUT on this invoice",
        accrual:
          "ROT and RUT cannot be used with the invoice method (fakturametoden) in Akunta yet, because invoice bookkeeping there is not finished. It works with the cash method (kontantmetoden).",
        currency: "ROT and RUT need an invoice in Swedish kronor. Change the currency to SEK.",
        which: "Which reduction?",
        rot: "ROT: repairs, conversion, extension",
        rut: "RUT: cleaning, gardening, moving and other household services",
        buyer: "The customer's personnummer",
        buyerHint: "The person who gets the reduction. It is printed on the invoice and in the request to Skatteverket, and not shown in lists.",
        oneBuyer:
          "An invoice split between several people is not supported yet. Make one invoice per person, with that person's share of the work.",
        home: "Where was the work done?",
        house: "House or owner-occupied flat",
        flat: "Flat in a housing society (bostadsrätt)",
        designation: "Property designation (fastighetsbeteckning)",
        designationHint: "For example Sollentuna Eken 12. The customer finds it in the title deed or at Lantmäteriet.",
        brf: "The housing society's organisation number",
        apartment: "Apartment number",
        apartmentHint: "The society's number for the flat, usually four digits.",
        helpers: "Skatteverket asks for this from 1 January 2027:",
        subcontractor: "I used a subcontractor for the work",
        staffing: "I used a staffing agency for the work",
        total: "Invoice total",
        labour: "Of which labour (incl. VAT)",
        reduction: (percent: number) => `Tax reduction, ${percent} % of the labour`,
        customerPays: "The customer pays",
        youRequest: "You request from Skatteverket",
        noLabour: "No line is marked as labour yet, so there is no reduction.",
        capped: (cap: string) => `The reduction is limited to ${cap}, the most one person can get in a year.`,
        cap: (word: string, cap: string, total: string) =>
          `One person can get at most ${cap} in ${word} per year (ROT and RUT together at most ${total}). Akunta cannot see how much the customer has already used this year. Ask the customer to check in Skatteverket's e-service "Mina skattereduktioner för rot, rut och grön teknik". If Skatteverket pays less than you request, the customer pays you the difference.`,
        steps:
          "How it works: the customer pays their part electronically (not in cash). Once the payment is registered here you download a file and send the request in Skatteverket's e-service. Akunta shows you when and how.",
        rateChange: (issue: number, due: number) =>
          `Note: the reduction is ${issue} % for payments on the invoice date but ${due} % on the due date. The day the customer pays decides.`
      };

  if (accrual) return <p className="note">{copy.accrual}</p>;

  const toggle = (
    <label>
      <input type="checkbox" checked={value !== null} onChange={(event) => onChange(event.target.checked ? emptyRotRutDraft() : null)} />{" "}
      <strong>{copy.question}</strong>
    </label>
  );
  if (!value) return toggle;

  const set = (patch: Partial<RotRutDraft>) => onChange({ ...value, ...patch });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(issueDate) ? issueDate : new Date().toISOString().slice(0, 10);
  const result = computeRotRut({ type: value.type, date, lines: rotRutDraftLines(items, value.type) });
  const percent = Math.round(result.rate * 100);
  const dueRate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? rotRutRateFor(value.type, dueDate) : result.rate;
  const word = value.type === "ROT" ? "rot" : sv ? "rut" : "RUT";

  // Problems are shown as soon as something has been typed, never on an empty field.
  const person = value.personnummer.trim() ? parsePersonnummer(value.personnummer) : null;
  const personError = person && !person.ok ? rotRutErrorText(`personnummer_${person.reason}`, sv ? "sv" : "en") : null;
  const brf = value.brfOrgNumber.trim() ? parseOrgNumber(value.brfOrgNumber) : null;
  const brfError = brf && !brf.ok ? rotRutErrorText("brf_org_number", sv ? "sv" : "en") : null;

  return (
    <div className="stack">
      {toggle}
      {currency !== "SEK" && <p className="error">{copy.currency}</p>}

      <fieldset className="stack" style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="label" style={{ padding: 0, marginBottom: 6 }}>
          {copy.which}
        </legend>
        <label>
          <input type="radio" name="rot-rut-type" checked={value.type === "ROT"} onChange={() => set({ type: "ROT" })} /> {copy.rot}
        </label>
        <label>
          <input type="radio" name="rot-rut-type" checked={value.type === "RUT"} onChange={() => set({ type: "RUT" })} /> {copy.rut}
        </label>
      </fieldset>

      <label className="stack">
        {copy.buyer}
        <input
          value={value.personnummer}
          onChange={(event) => set({ personnummer: event.target.value })}
          placeholder={sv ? "ÅÅÅÅMMDD-XXXX" : "YYYYMMDD-XXXX"}
          inputMode="numeric"
          autoComplete="off"
          maxLength={13}
          aria-invalid={Boolean(personError)}
          required
        />
      </label>
      {personError ? <p className="error">{personError}</p> : <p className="note">{copy.buyerHint}</p>}
      <p className="note">{copy.oneBuyer}</p>

      {value.type === "ROT" && (
        <>
          <fieldset className="stack" style={{ border: "none", padding: 0, margin: 0 }}>
            <legend className="label" style={{ padding: 0, marginBottom: 6 }}>
              {copy.home}
            </legend>
            <label>
              <input type="radio" name="rot-housing" checked={value.housing === "property"} onChange={() => set({ housing: "property" })} />{" "}
              {copy.house}
            </label>
            <label>
              <input type="radio" name="rot-housing" checked={value.housing === "apartment"} onChange={() => set({ housing: "apartment" })} />{" "}
              {copy.flat}
            </label>
          </fieldset>
          {value.housing === "property" ? (
            <>
              <label className="stack">
                {copy.designation}
                <input
                  value={value.propertyDesignation}
                  onChange={(event) => set({ propertyDesignation: event.target.value })}
                  maxLength={40}
                  required
                />
              </label>
              <p className="note">{copy.designationHint}</p>
            </>
          ) : (
            <>
              <div className="row">
                <label className="stack">
                  {copy.brf}
                  <input
                    value={value.brfOrgNumber}
                    onChange={(event) => set({ brfOrgNumber: event.target.value })}
                    placeholder="769600-1234"
                    inputMode="numeric"
                    maxLength={13}
                    aria-invalid={Boolean(brfError)}
                    required
                  />
                </label>
                <label className="stack">
                  {copy.apartment}
                  <input
                    value={value.apartmentNumber}
                    onChange={(event) => set({ apartmentNumber: event.target.value })}
                    placeholder="1102"
                    maxLength={25}
                    required
                  />
                </label>
              </div>
              {brfError ? <p className="error">{brfError}</p> : <p className="note">{copy.apartmentHint}</p>}
            </>
          )}
        </>
      )}

      <div className="invoiceTotals" aria-live="polite">
        <p>
          {copy.total}: <strong>{money(result.grossAmount)}</strong>
        </p>
        <p>
          {copy.labour}: <strong>{money(result.labourAmount)}</strong>
        </p>
        <p>
          {copy.reduction(percent)}: <strong>{money(-result.deduction)}</strong>
        </p>
        <p>
          {copy.customerPays}: <strong>{money(result.customerPays)}</strong>
        </p>
        <p>
          {copy.youRequest}: <strong>{money(result.deduction)}</strong>
        </p>
      </div>
      {result.labourAmount <= 0 && <p className="error">{copy.noLabour}</p>}
      {result.capped && <p className="note">{copy.capped(money(result.cap))}</p>}
      {dueRate !== result.rate && <p className="error">{copy.rateChange(percent, Math.round(dueRate * 100))}</p>}
      <p className="note">{copy.cap(word, money(result.cap), money(rotRutRuleFor(date).totalCap))}</p>
      <p className="note">{copy.steps}</p>

      <div className="stack" style={{ gap: 6 }}>
        <p className="note">{copy.helpers}</p>
        <label>
          <input type="checkbox" checked={value.subcontractor} onChange={(event) => set({ subcontractor: event.target.checked })} />{" "}
          {copy.subcontractor}
        </label>
        <label>
          <input type="checkbox" checked={value.staffingAgency} onChange={(event) => set({ staffingAgency: event.target.checked })} />{" "}
          {copy.staffing}
        </label>
      </div>
    </div>
  );
};
