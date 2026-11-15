"use client";

import { formatMoney } from "@/lib/data/format";
import { computeInvoiceItem } from "@/lib/invoices/calculations";
import { draftsToItems, type LineItemDraft, makeLineItem, ROT_RUT_OTHER_COST, rotRutDraftLines } from "@/lib/invoices/drafts";
import { type RotRutType, rotRutWorkTypes } from "@/lib/invoices/rotrut";
import { InvoiceVatModes, type InvoiceVatMode } from "@/lib/invoices/types";
import { type Locale } from "@/lib/i18n/locale";

const VAT_CHOICES = ["0.25", "0.12", "0.06", "0"];

type LineItemsEditorProps = {
  locale: Locale;
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  currency: string;
  vatRegistered: boolean;
  /**
   * Set on an invoice where the customer gets ROT or RUT: each line then says
   * whether it is labour, and labour lines carry a type of work and hours.
   * Left out (quotes, ordinary invoices) nothing extra is shown.
   */
  rotRut?: { type: RotRutType };
};

export const LineItemsEditor = ({ locale, items, onChange, currency, vatRegistered, rotRut }: LineItemsEditorProps) => {
  const numberLocale = locale === "sv" ? "sv-SE" : "en-GB";
  const copy =
    locale === "sv"
      ? {
          description: "Beskrivning",
          descriptionHint: "Vad har du sålt?",
          quantity: "Antal",
          price: "Pris per styck",
          vat: "Moms",
          noVat: "Ingen moms",
          priceIs: "Priset är",
          exclusive: "exkl. moms",
          inclusive: "inkl. moms",
          lineTotal: "Radsumma inkl. moms",
          add: "Lägg till rad",
          remove: "Ta bort rad",
          labour: (word: string) => `Arbete som ger ${word}avdrag`,
          labourHint: "Bara arbete räknas. Bocka ur rader för material, resor, utrustning och administration.",
          workType: "Typ av arbete",
          hours: "Arbetade timmar",
          hoursHint: "Faktiska timmar, även vid fast pris",
          countsAs: "Raden är",
          materialFor: (work: string) => `Material (${work})`,
          otherCost: "Övrig kostnad: resa, utrustning, administration"
        }
      : {
          description: "Description",
          descriptionHint: "What did you sell?",
          quantity: "Quantity",
          price: "Price each",
          vat: "VAT",
          noVat: "No VAT",
          priceIs: "The price is",
          exclusive: "excl. VAT",
          inclusive: "incl. VAT",
          lineTotal: "Line total incl. VAT",
          add: "Add line",
          remove: "Remove line",
          labour: (word: string) => `Labour that qualifies for ${word}`,
          labourHint: "Only labour counts. Untick lines for material, travel, equipment and administration.",
          workType: "Type of work",
          hours: "Hours worked",
          hoursHint: "Actual hours, also for fixed-price work",
          countsAs: "This line is",
          materialFor: (work: string) => `Material (${work})`,
          otherCost: "Other cost: travel, equipment, administration"
        };

  // ROT/RUT: what each line counts as, with the defaults filled in.
  const rotRutLines = rotRut ? rotRutDraftLines(items, rotRut.type) : null;
  const workTypes = rotRut ? rotRutWorkTypes(rotRut.type) : [];
  const workLabel = (code: string) => workTypes.find((row) => row.code === code)?.[locale === "sv" ? "sv" : "en"] ?? code;
  const labourTypes = rotRutLines
    ? [...new Set(rotRutLines.filter((line) => line.labour && line.workType).map((line) => line.workType as string))]
    : [];

  const update = (key: string, patch: Partial<LineItemDraft>) =>
    onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const onVatChange = (item: LineItemDraft, value: string) => {
    if (value === "0") {
      update(item.key, { vatRate: "0", vatMode: InvoiceVatModes.NO_VAT });
      return;
    }
    update(item.key, {
      vatRate: value,
      vatMode: item.vatMode === InvoiceVatModes.NO_VAT ? InvoiceVatModes.EXCLUSIVE : item.vatMode
    });
  };

  return (
    <div className="stack">
      {rotRut && <p className="note">{copy.labourHint}</p>}
      {items.map((item, index) => {
        const rotRutLine = rotRutLines?.[index];
        const vatValue = item.vatMode === InvoiceVatModes.NO_VAT ? "0" : item.vatRate;
        const computed = computeInvoiceItem(draftsToItems([item])[0]);
        return (
          <div key={item.key} className="invoiceItemCard">
            <label className="stack">
              {copy.description}
              <input
                value={item.description}
                placeholder={copy.descriptionHint}
                onChange={(event) => update(item.key, { description: event.target.value })}
                maxLength={240}
                required
              />
            </label>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="stack" style={{ flex: "1 1 80px" }}>
                {copy.quantity}
                <input
                  inputMode="decimal"
                  value={item.quantity}
                  onChange={(event) => update(item.key, { quantity: event.target.value })}
                  required
                />
              </label>
              <label className="stack" style={{ flex: "1 1 110px" }}>
                {copy.price}
                <input
                  inputMode="decimal"
                  value={item.unitPrice}
                  placeholder="0,00"
                  onChange={(event) => update(item.key, { unitPrice: event.target.value })}
                  required
                />
              </label>
              <label className="stack" style={{ flex: "1 1 110px" }}>
                {copy.vat}
                <select value={vatValue} onChange={(event) => onVatChange(item, event.target.value)}>
                  {(VAT_CHOICES.includes(vatValue) ? VAT_CHOICES : [vatValue, ...VAT_CHOICES]).map((rate) => (
                    <option key={rate} value={rate}>
                      {rate === "0" ? copy.noVat : `${Math.round(Number(rate) * 10000) / 100} %`}
                    </option>
                  ))}
                </select>
              </label>
              {item.vatMode !== InvoiceVatModes.NO_VAT && (
                <label className="stack" style={{ flex: "1 1 120px" }}>
                  {copy.priceIs}
                  <select
                    value={item.vatMode}
                    onChange={(event) => update(item.key, { vatMode: event.target.value as InvoiceVatMode })}
                  >
                    <option value={InvoiceVatModes.EXCLUSIVE}>{copy.exclusive}</option>
                    <option value={InvoiceVatModes.INCLUSIVE}>{copy.inclusive}</option>
                  </select>
                </label>
              )}
            </div>
            {rotRut && rotRutLine && (
              <div className="row" style={{ alignItems: "flex-end" }}>
                <label style={{ flex: "1 1 200px" }}>
                  <input
                    type="checkbox"
                    checked={rotRutLine.labour}
                    onChange={(event) => update(item.key, { rotRutLabour: event.target.checked, rotRutWorkType: undefined })}
                  />{" "}
                  {copy.labour(rotRut.type === "ROT" ? "rot" : locale === "sv" ? "rut" : "RUT")}
                </label>
                {rotRutLine.labour ? (
                  <>
                    <label className="stack" style={{ flex: "1 1 170px" }}>
                      {copy.workType}
                      <select
                        value={rotRutLine.workType ?? ""}
                        onChange={(event) => update(item.key, { rotRutWorkType: event.target.value })}
                      >
                        {workTypes.map((row) => (
                          <option key={row.code} value={row.code}>
                            {row[locale === "sv" ? "sv" : "en"]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="stack" style={{ flex: "1 1 110px" }}>
                      {copy.hours}
                      <input
                        inputMode="decimal"
                        value={item.rotRutHours ?? item.quantity}
                        title={copy.hoursHint}
                        onChange={(event) => update(item.key, { rotRutHours: event.target.value })}
                        required
                      />
                    </label>
                  </>
                ) : (
                  <label className="stack" style={{ flex: "2 1 240px" }}>
                    {copy.countsAs}
                    <select
                      value={rotRutLine.workType ?? ROT_RUT_OTHER_COST}
                      onChange={(event) => update(item.key, { rotRutWorkType: event.target.value })}
                    >
                      {(labourTypes.length > 0 ? labourTypes : [workTypes[0].code]).map((code) => (
                        <option key={code} value={code}>
                          {copy.materialFor(workLabel(code))}
                        </option>
                      ))}
                      <option value={ROT_RUT_OTHER_COST}>{copy.otherCost}</option>
                    </select>
                  </label>
                )}
              </div>
            )}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="note">
                {copy.lineTotal}: <strong>{formatMoney(computed.totalAmount, currency, numberLocale)}</strong>
              </span>
              {items.length > 1 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onChange(items.filter((row) => row.key !== item.key))}
                >
                  {copy.remove}
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div className="row">
        <button type="button" className="secondary" onClick={() => onChange([...items, makeLineItem(vatRegistered)])}>
          {copy.add}
        </button>
      </div>
    </div>
  );
};
