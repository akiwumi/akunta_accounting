"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AccountPicker } from "@/components/journal/AccountPicker";
import { EntryPreview } from "@/components/journal/EntryPreview";
import {
  journalErrorText,
  parseAmount,
  validAmount,
  type PickerAccount,
  type PreviewEntryView
} from "@/components/journal/shared";
import { situationGroups, type Situation, type SituationId } from "@/components/journal/situations";
import { formatMoney } from "@/lib/data/format";
import { type Locale } from "@/lib/i18n/locale";

type GuidedEntryProps = {
  locale: Locale;
  /** Active accounts of the business. */
  accounts: PickerAccount[];
  today: string;
  /** The year the year-end situations open on. */
  defaultYear: number;
  years: number[];
  /** Last day of the most recent VAT period that has ended. */
  defaultVatPeriodEnd: string;
  cashMethod: boolean;
};

type Notice =
  | { code: "VAT_DIFFERENCE"; ledgerNet: number; paid: number; difference: number }
  | { code: "VAT_ROUNDING"; amount: number }
  | { code: "VAT_NOTHING_TO_CLEAR" };

type Preview = { key: string; entries: PreviewEntryView[]; notices: Notice[]; error: string | null };

type VatBalances = { key: string; outputTotal: number; inputTotal: number; net: number };

type DepreciationSuggestion = {
  year: number;
  totals: { equipment: number; vehicle: number; building: number; intangible: number };
  assets: Array<{ description: string; category: string; amount: number }>;
  assetCount: number;
  alreadyBooked: number;
};

type ReceivablesSuggestion = {
  year: number;
  totals: { sales25: number; sales12: number; sales6: number; sales0: number };
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    outstanding: number;
    currency: string;
    ratePercent: number;
    included: boolean;
  }>;
  cashMethod: boolean;
  alreadyBooked: boolean;
};

type Bill = { key: number; text: string; gross: string; vat: string; accountId: string };

type Values = {
  date: string;
  amount: string;
  bankAccount: string;
  text: string;
  fromAccount: string;
  toAccount: string;
  amortization: string;
  interest: string;
  fee: string;
  periodEnd: string;
  taxKind: "preliminary" | "other";
  confirmPrivate: boolean;
  year: number;
  equipment: string;
  vehicle: string;
  building: string;
  intangible: string;
  sales25: string;
  sales12: string;
  sales6: string;
  sales0: string;
  reverse: boolean;
};

const SIMPLE: SituationId[] = [
  "owner_withdrawal",
  "owner_deposit",
  "bank_fee",
  "interest_received",
  "interest_paid",
  "loan_taken"
];
const MONEY_IN: SituationId[] = ["owner_deposit", "interest_received", "loan_taken", "vat_refund"];
const DEPRECIATION_KEYS = ["equipment", "vehicle", "building", "intangible"] as const;
const SALES_KEYS = ["sales25", "sales12", "sales6", "sales0"] as const;

/** An optional amount: empty counts as zero, nonsense as invalid (null). */
const optionalAmount = (raw: string): number | null => {
  const value = parseAmount(raw);
  if (value === null) return 0;
  return Number.isFinite(value) ? value : null;
};

const amountText = (value: number, sv: boolean) => (value > 0 ? value.toFixed(2).replace(".", sv ? "," : ".") : "");

type BuildMessages = { invalid: string; sameAccount: string; vatDateOrder: string; vatTooLarge: string };

/**
 * From the form to the template input. `input` is null until the form is
 * complete; `problem` says what is wrong when something typed cannot be used.
 */
const buildInput = ({
  situation,
  values,
  bills,
  costAccounts,
  copy
}: {
  situation: Situation | null;
  values: Values;
  bills: Bill[];
  costAccounts: PickerAccount[];
  copy: BuildMessages;
}): { input: Record<string, unknown> | null; problem: string | null } => {
  let problem: string | null = null;
  const make = (): Record<string, unknown> | null => {
    if (!situation) return null;
    const id = situation.id;
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(values.date);
    const text = values.text.trim() || undefined;
    const invalid = (raw: string) => Number.isNaN(parseAmount(raw));

    if (SIMPLE.includes(id)) {
      if (invalid(values.amount)) problem = copy.invalid;
      const amount = validAmount(values.amount);
      if (!dated || amount === null) return null;
      return { date: values.date, amount, bankAccount: values.bankAccount, text };
    }
    if (id === "transfer") {
      if (invalid(values.amount)) problem = copy.invalid;
      if (values.fromAccount === values.toAccount) {
        problem = copy.sameAccount;
        return null;
      }
      const amount = validAmount(values.amount);
      if (!dated || amount === null) return null;
      return { date: values.date, amount, fromAccount: values.fromAccount, toAccount: values.toAccount, text };
    }
    if (id === "loan_repayment") {
      const amortization = optionalAmount(values.amortization);
      const interest = optionalAmount(values.interest);
      const fee = optionalAmount(values.fee);
      if (amortization === null || interest === null || fee === null) {
        problem = copy.invalid;
        return null;
      }
      if (!dated || amortization + interest + fee <= 0) return null;
      return { date: values.date, amortization, interest, fee, bankAccount: values.bankAccount, text };
    }
    if (id === "vat_paid" || id === "vat_refund") {
      if (invalid(values.amount)) problem = copy.invalid;
      const amount = validAmount(values.amount);
      if (!dated || !/^\d{4}-\d{2}-\d{2}$/.test(values.periodEnd) || amount === null) return null;
      if (values.periodEnd > values.date) {
        problem = copy.vatDateOrder;
        return null;
      }
      return {
        date: values.date,
        kind: id === "vat_paid" ? "paid" : "refund",
        amount,
        periodEnd: values.periodEnd,
        bankAccount: values.bankAccount
      };
    }
    if (id === "tax_payment") {
      if (invalid(values.amount)) problem = copy.invalid;
      const amount = validAmount(values.amount);
      if (!dated || amount === null || !values.confirmPrivate) return null;
      return { date: values.date, amount, kind: values.taxKind, confirmPrivate: true, bankAccount: values.bankAccount, text };
    }
    if (id === "depreciation" || id === "year_end_receivables") {
      const keys = id === "depreciation" ? DEPRECIATION_KEYS : SALES_KEYS;
      const amounts: Record<string, number> = {};
      let total = 0;
      for (const key of keys) {
        const value = optionalAmount(values[key]);
        if (value === null) {
          problem = copy.invalid;
          return null;
        }
        amounts[key] = value;
        total += value;
      }
      if (total <= 0) return null;
      return id === "depreciation" ? { year: values.year, ...amounts } : { year: values.year, ...amounts, reverse: values.reverse };
    }
    // year_end_payables
    const rows = [];
    for (const bill of bills) {
      const blank = !bill.text.trim() && !bill.gross.trim() && !bill.vat.trim() && !bill.accountId;
      if (blank && bills.length > 1) continue;
      const gross = validAmount(bill.gross);
      const vat = optionalAmount(bill.vat);
      if (invalid(bill.gross) || vat === null) {
        problem = copy.invalid;
        return null;
      }
      const account = costAccounts.find((candidate) => candidate.id === bill.accountId);
      if (gross === null || !bill.text.trim() || !account) return null;
      if (vat >= gross) {
        problem = copy.vatTooLarge;
        return null;
      }
      rows.push({ text: bill.text.trim(), gross, vat, accountCode: account.code });
    }
    if (rows.length === 0) return null;
    return { year: values.year, bills: rows, reverse: values.reverse };
  };
  const made = make();
  return { input: made, problem };
};

export const GuidedEntry = ({ locale, accounts, today, defaultYear, years, defaultVatPeriodEnd, cashMethod }: GuidedEntryProps) => {
  const router = useRouter();
  const sv = locale === "sv";
  const money = (value: number) => formatMoney(value, "SEK", sv ? "sv-SE" : "en-GB");
  const groups = situationGroups(sv);

  const copy = sv
    ? {
        choose: "Vad har hänt?",
        chooseHelp: "Välj det som stämmer. Du fyller i ett par uppgifter och ser exakt vad som bokförs innan något sparas.",
        back: "Välj en annan händelse",
        date: "Datum",
        dateHelp: "Dagen då pengarna drogs eller kom in, enligt kontoutdraget.",
        amount: "Belopp",
        amountKr: "kr",
        fromAccount: "Från konto",
        toAccount: "Till konto",
        note: "Egen anteckning (valfritt)",
        notePlaceholder: "Till exempel vad det gällde",
        amortization: "Amortering",
        amortizationHelp: "Den del som minskar skulden.",
        interest: "Ränta",
        fee: "Avgift (om banken tog en)",
        vatDate: "Datum då momsen betalades",
        vatDateRefund: "Datum då pengarna kom in",
        periodEnd: "Momsperiodens sista dag",
        periodEndHelp: "Den sista dagen i perioden som betalningen gäller, till exempel 31 mars för första kvartalet.",
        vatAmountPaid: "Belopp du betalade",
        vatAmountRefund: "Belopp du fick tillbaka",
        vatBooks: (end: string, out: string, inn: string) =>
          `Enligt bokföringen till och med ${end}: utgående moms ${out}, ingående moms ${inn}.`,
        vatToPay: (amount: string) => `Att betala: ${amount}.`,
        vatToGet: (amount: string) => `Att få tillbaka: ${amount}.`,
        vatNothing: "Det finns ingen moms bokförd att reglera för perioden.",
        vatWrongWay: "Enligt bokföringen går momsen åt andra hållet för den här perioden. Kontrollera perioden och beloppet.",
        vatDateOrder: "Betalningen kan inte vara daterad före periodens sista dag.",
        noticeRounding: (amount: string) =>
          `Skillnaden på ${amount} mot bokföringen beror på att deklarationen görs i hela kronor. Den bokförs som öresutjämning.`,
        noticeDifference: (books: string, paid: string, diff: string) =>
          `Momskontona visar ${books} men beloppet du angav är ${paid}. Skillnaden på ${diff} blir kvar på konto 2650 tills den är utredd. Kontrollera beloppet och periodens sista dag.`,
        noticeNothing:
          "Det finns inget på momskontona för perioden, så bara betalningen bokförs. Beloppet blir kvar på konto 2650.",
        taxKind: "Vilken skatt?",
        taxPreliminary: "Preliminärskatt (F-skatt)",
        taxOther: "Annan egen skatt, till exempel kvarskatt",
        taxConfirm: "Jag förstår att skatten bokförs som eget uttag och inte som kostnad i firman",
        taxConfirmHelp:
          "Preliminärskatten är en förskottsbetalning av din egen inkomstskatt och dina egenavgifter. Momsen bokförs inte här: använd Jag betalade moms till Skatteverket.",
        year: "År",
        depEquipment: "Inventarier och verktyg",
        depVehicle: "Bilar och transportmedel",
        depBuilding: "Byggnader",
        depIntangible: "Immateriella tillgångar",
        depFromRegister: "Förslaget kommer från ditt inventarieregister. Du kan ändra beloppen.",
        depNoAssets:
          "Det finns inga inventarier i registret för det här året, så det finns inget förslag. Lägg in dem under Inventarier, eller fyll i beloppen själv.",
        depAlready: (amount: string) =>
          `Det finns redan ${amount} bokfört som avskrivning det här året. Kontrollera att du inte bokför samma avskrivning två gånger.`,
        depAssumes:
          "Avskrivning förutsätter att inköpet är bokfört som en tillgång (till exempel konto 1220 Inventarier) och inte redan som en kostnad. Annars dras kostnaden två gånger.",
        assetsLink: "Öppna inventarieregistret",
        loading: "Hämtar förslag...",
        sales25: "Fakturor med 25 % moms",
        sales12: "Fakturor med 12 % moms",
        sales6: "Fakturor med 6 % moms",
        sales0: "Fakturor utan moms",
        inclVat: "Summa att få betalt, inklusive moms.",
        recFromInvoices: (n: number) =>
          n === 1
            ? "Förslaget bygger på 1 faktura som var obetald vid årets slut. Du kan ändra beloppen."
            : `Förslaget bygger på ${n} fakturor som var obetalda vid årets slut. Du kan ändra beloppen.`,
        recNone: "Inga obetalda fakturor hittades i Akunta för det året. Har du fakturerat på annat sätt, fyll i beloppen själv.",
        recExcluded: "Inte med i förslaget (annan valuta eller blandad moms). Räkna om till kronor och lägg till själv:",
        recAlready: "Obetalda kundfakturor är redan bokförda för det här året. Bokför inte samma fakturor igen.",
        payAlready: "Obetalda leverantörsfakturor är redan bokförda för det här året. Bokför inte samma fakturor igen.",
        notCashMethod:
          "Firman använder faktureringsmetoden. Då bokförs fakturor redan när de skickas eller tas emot, och det här steget behövs normalt inte.",
        reverse: "Bokför också återföringen den 1 januari",
        reverseHelp:
          "Rekommenderas. Annars räknas försäljningen eller kostnaden en gång till när betalningen bokförs nästa år.",
        billFrom: "Från vem?",
        billGross: "Att betala, inklusive moms",
        billVat: "Varav moms",
        billAccount: "Vad gäller kostnaden?",
        billAccountPlaceholder: "Sök kostnadskonto",
        noMatch: "Inget konto matchar.",
        addBill: "Lägg till en faktura",
        removeBill: "Ta bort",
        bill: (n: number) => `Faktura ${n}`,
        invalid: "Skriv belopp med siffror, till exempel 1 250,50.",
        sameAccount: "Välj två olika konton.",
        vatTooLarge: "Momsen kan inte vara lika stor som hela fakturan.",
        fillIn: "Fyll i uppgifterna ovan, så visas vad som kommer att bokföras.",
        working: "Räknar...",
        save: "Bokför",
        saveMany: (n: number) => `Bokför ${n} poster`,
        saving: "Bokför...",
        failed: "Det gick inte att bokföra. Försök igen.",
        doneOne: (n: number) => `Klart. Bokfört som verifikation ${n}.`,
        doneMany: (list: string) => `Klart. Bokfört som verifikation ${list}.`,
        doneHelp: "Posten finns nu i huvudboken. Blev något fel kan du makulera den där, då bokförs en rättelse.",
        seeLedger: "Visa i huvudboken",
        another: "Bokför en händelse till",
        newAccount: "nytt konto"
      }
    : {
        choose: "What happened?",
        chooseHelp: "Pick what fits. You fill in a couple of details and see exactly what will be booked before anything is saved.",
        back: "Choose another situation",
        date: "Date",
        dateHelp: "The day the money left or arrived, according to the bank statement.",
        amount: "Amount",
        amountKr: "SEK",
        fromAccount: "From account",
        toAccount: "To account",
        note: "Your own note (optional)",
        notePlaceholder: "For example what it was for",
        amortization: "Repayment",
        amortizationHelp: "The part that reduces the debt.",
        interest: "Interest",
        fee: "Fee (if the bank charged one)",
        vatDate: "Date the VAT was paid",
        vatDateRefund: "Date the money arrived",
        periodEnd: "Last day of the VAT period",
        periodEndHelp: "The last day of the period the payment is for, for example 31 March for the first quarter.",
        vatAmountPaid: "Amount you paid",
        vatAmountRefund: "Amount you got back",
        vatBooks: (end: string, out: string, inn: string) =>
          `According to the books up to and including ${end}: output VAT ${out}, input VAT ${inn}.`,
        vatToPay: (amount: string) => `To pay: ${amount}.`,
        vatToGet: (amount: string) => `To get back: ${amount}.`,
        vatNothing: "There is no VAT booked to settle for the period.",
        vatWrongWay: "According to the books the VAT goes the other way for this period. Check the period and the amount.",
        vatDateOrder: "The payment cannot be dated before the last day of the period.",
        noticeRounding: (amount: string) =>
          `The difference of ${amount} from the books is because the return is made in whole kronor. It is booked as rounding.`,
        noticeDifference: (books: string, paid: string, diff: string) =>
          `The VAT accounts show ${books} but the amount you entered is ${paid}. The difference of ${diff} stays on account 2650 until it is sorted out. Check the amount and the last day of the period.`,
        noticeNothing:
          "There is nothing on the VAT accounts for the period, so only the payment is booked. The amount stays on account 2650.",
        taxKind: "Which tax?",
        taxPreliminary: "Preliminary tax (F-skatt)",
        taxOther: "Other tax of your own, for example back tax",
        taxConfirm: "I understand that the tax is booked as an owner withdrawal and not as a cost in the business",
        taxConfirmHelp:
          "Preliminary tax is an advance payment of your own income tax and social contributions. VAT is not booked here: use I paid VAT to Skatteverket.",
        year: "Year",
        depEquipment: "Equipment and tools",
        depVehicle: "Cars and other vehicles",
        depBuilding: "Buildings",
        depIntangible: "Intangible assets",
        depFromRegister: "The suggestion comes from your fixed asset register. You can change the amounts.",
        depNoAssets:
          "There are no assets in the register for this year, so there is no suggestion. Add them under Assets, or fill in the amounts yourself.",
        depAlready: (amount: string) =>
          `${amount} is already booked as depreciation this year. Check that you do not book the same depreciation twice.`,
        depAssumes:
          "Depreciation assumes the purchase is booked as an asset (for example account 1220 Inventarier) and not already as a cost. Otherwise the cost is deducted twice.",
        assetsLink: "Open the asset register",
        loading: "Fetching a suggestion...",
        sales25: "Invoices with 25% VAT",
        sales12: "Invoices with 12% VAT",
        sales6: "Invoices with 6% VAT",
        sales0: "Invoices without VAT",
        inclVat: "Total to be paid, including VAT.",
        recFromInvoices: (n: number) =>
          n === 1
            ? "The suggestion is based on 1 invoice that was unpaid at the end of the year. You can change the amounts."
            : `The suggestion is based on ${n} invoices that were unpaid at the end of the year. You can change the amounts.`,
        recNone: "No unpaid invoices were found in Akunta for that year. If you invoiced some other way, fill in the amounts yourself.",
        recExcluded: "Not in the suggestion (other currency or mixed VAT). Convert to kronor and add them yourself:",
        recAlready: "Unpaid customer invoices are already booked for this year. Do not book the same invoices again.",
        payAlready: "Unpaid supplier bills are already booked for this year. Do not book the same bills again.",
        notCashMethod:
          "The business uses the invoice method (faktureringsmetoden). Invoices are then booked when they are sent or received, and this step is normally not needed.",
        reverse: "Also book the reversal on 1 January",
        reverseHelp: "Recommended. Otherwise the sale or the cost is counted once more when the payment is booked next year.",
        billFrom: "Who is it from?",
        billGross: "To pay, including VAT",
        billVat: "Of which VAT",
        billAccount: "What is the cost for?",
        billAccountPlaceholder: "Search cost account",
        noMatch: "No account matches.",
        addBill: "Add a bill",
        removeBill: "Remove",
        bill: (n: number) => `Bill ${n}`,
        invalid: "Write amounts with digits only, for example 1250.50.",
        sameAccount: "Choose two different accounts.",
        vatTooLarge: "The VAT cannot be as large as the whole bill.",
        fillIn: "Fill in the details above to see what will be booked.",
        working: "Working it out...",
        save: "Book it",
        saveMany: (n: number) => `Book ${n} entries`,
        saving: "Booking...",
        failed: "The entry could not be booked. Please try again.",
        doneOne: (n: number) => `Done. Booked as verification ${n}.`,
        doneMany: (list: string) => `Done. Booked as verifications ${list}.`,
        doneHelp: "The entry is now in the ledger. If something is wrong you can cancel it there, which books a correction.",
        seeLedger: "Show in the ledger",
        another: "Book another event",
        newAccount: "new account"
      };

  const cashAccounts = accounts.filter((account) => /^19\d{2}$/.test(account.code));
  // 1940 is offered for transfers even before it exists: it is created on first use.
  const transferAccounts = cashAccounts.some((account) => account.code === "1940")
    ? cashAccounts
    : [
        ...cashAccounts,
        {
          id: "new-1940",
          code: "1940",
          name: sv ? `Övriga bankkonton, till exempel sparkonto (${copy.newAccount})` : `Other bank account, for example savings (${copy.newAccount})`,
          type: "ASSET"
        }
      ].sort((a, b) => a.code.localeCompare(b.code));
  const costAccounts = accounts.filter((account) => /^[4-8]\d{3}$/.test(account.code) && account.type === "EXPENSE");
  const defaultBank = cashAccounts.find((account) => account.code === "1930")?.code ?? cashAccounts[0]?.code ?? "1930";

  const initialValues = (): Values => ({
    date: today,
    amount: "",
    bankAccount: defaultBank,
    text: "",
    fromAccount: defaultBank,
    toAccount: transferAccounts.find((account) => account.code !== defaultBank)?.code ?? "1940",
    amortization: "",
    interest: "",
    fee: "",
    periodEnd: defaultVatPeriodEnd,
    taxKind: "preliminary",
    confirmPrivate: false,
    year: defaultYear,
    equipment: "",
    vehicle: "",
    building: "",
    intangible: "",
    sales25: "",
    sales12: "",
    sales6: "",
    sales0: "",
    reverse: true
  });

  const [situation, setSituation] = useState<Situation | null>(null);
  const [values, setValues] = useState<Values>(initialValues);
  const [bills, setBills] = useState<Bill[]>([{ key: 1, text: "", gross: "", vat: "", accountId: "" }]);
  const nextBillKey = useRef(2);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [vatBalances, setVatBalances] = useState<VatBalances | null>(null);
  const [depreciation, setDepreciation] = useState<DepreciationSuggestion | null>(null);
  const [receivables, setReceivables] = useState<ReceivablesSuggestion | null>(null);
  const [payablesBooked, setPayablesBooked] = useState<{ year: number; alreadyBooked: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number[] | null>(null);
  /** Guards against a slow suggestion overwriting a newer one. */
  const requestId = useRef(0);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setDone(null);
    setError(null);
    setValues((current) => ({ ...current, [key]: value }));
  };

  // ─── Suggestions from the books ────────────────────────────────────────────

  const fetchJson = async <T,>(query: string): Promise<T | null> => {
    try {
      const response = await fetch(`/api/journal/suggestions?${query}`);
      return response.ok ? ((await response.json()) as T) : null;
    } catch {
      return null;
    }
  };

  const loadYearSuggestion = async (id: SituationId, year: number) => {
    const request = ++requestId.current;
    if (id === "depreciation") {
      const fetched = await fetchJson<DepreciationSuggestion>(`kind=depreciation&year=${year}`);
      if (request !== requestId.current) return;
      // Without an answer the form still works: the amounts are typed by hand.
      const result = fetched ?? {
        year,
        totals: { equipment: 0, vehicle: 0, building: 0, intangible: 0 },
        assets: [],
        assetCount: 0,
        alreadyBooked: 0
      };
      setDepreciation(result);
      setValues((current) => ({
        ...current,
        equipment: amountText(result.totals.equipment, sv),
        vehicle: amountText(result.totals.vehicle, sv),
        building: amountText(result.totals.building, sv),
        intangible: amountText(result.totals.intangible, sv)
      }));
    } else if (id === "year_end_receivables") {
      const fetched = await fetchJson<ReceivablesSuggestion>(`kind=receivables&year=${year}`);
      if (request !== requestId.current) return;
      const result = fetched ?? {
        year,
        totals: { sales25: 0, sales12: 0, sales6: 0, sales0: 0 },
        invoices: [],
        cashMethod: true,
        alreadyBooked: false
      };
      setReceivables(result);
      setValues((current) => ({
        ...current,
        sales25: amountText(result.totals.sales25, sv),
        sales12: amountText(result.totals.sales12, sv),
        sales6: amountText(result.totals.sales6, sv),
        sales0: amountText(result.totals.sales0, sv)
      }));
    } else if (id === "year_end_payables") {
      const result = await fetchJson<{ year: number; alreadyBooked: boolean }>(`kind=payables&year=${year}`);
      if (request !== requestId.current || !result) return;
      setPayablesBooked(result);
    }
  };

  const loadVatBalances = async (id: SituationId, periodEnd: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return;
    const request = ++requestId.current;
    const result = await fetchJson<{
      output: Array<{ amount: number }>;
      input: Array<{ amount: number }>;
      net: number;
    }>(`kind=vat&periodEnd=${periodEnd}`);
    if (request !== requestId.current || !result) return;
    const sum = (rows: Array<{ amount: number }>) => Math.round(rows.reduce((total, row) => total + row.amount, 0) * 100) / 100;
    setVatBalances({ key: periodEnd, outputTotal: sum(result.output), inputTotal: sum(result.input), net: result.net });
    // Suggest the whole-krona amount of the return when the books point the same way.
    const owed = id === "vat_paid" ? result.net : -result.net;
    setValues((current) => ({ ...current, amount: owed >= 1 ? String(Math.trunc(owed)) : "" }));
  };

  const open = (next: Situation) => {
    const fresh = initialValues();
    setSituation(next);
    setValues(fresh);
    setBills([{ key: nextBillKey.current++, text: "", gross: "", vat: "", accountId: "" }]);
    setPreview(null);
    setVatBalances(null);
    setDepreciation(null);
    setReceivables(null);
    setPayablesBooked(null);
    setError(null);
    setDone(null);
    if (next.template === "vat_settlement") void loadVatBalances(next.id, fresh.periodEnd);
    else void loadYearSuggestion(next.id, fresh.year);
  };

  // ─── From the form to the template input ───────────────────────────────────

  const { input, problem } = buildInput({ situation, values, bills, costAccounts, copy });

  const template = situation?.template ?? null;
  const inputKey = input && template ? JSON.stringify({ template, input }) : null;

  // Ask the server what will be booked, a moment after the form stops changing.
  useEffect(() => {
    if (!inputKey) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/journal/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: inputKey,
          signal: controller.signal
        });
        const json = (await response.json().catch(() => ({}))) as {
          entries?: PreviewEntryView[];
          notices?: Notice[];
          error?: string;
          code?: string;
        };
        if (!response.ok || !json.entries) {
          setPreview({
            key: inputKey,
            entries: [],
            notices: [],
            error: journalErrorText(locale === "sv", json.code, json.error ?? "")
          });
          return;
        }
        setPreview({ key: inputKey, entries: json.entries, notices: json.notices ?? [], error: null });
      } catch {
        // Aborted because the form changed again: the next request answers.
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [inputKey, locale]);

  const current = preview && preview.key === inputKey ? preview : null;
  const blocked = current ? current.entries.some((entry) => entry.locked) : false;
  const canSave = Boolean(current && current.entries.length > 0 && !current.error && !blocked && !saving);

  const save = async () => {
    if (!canSave || !inputKey) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "template", ...(JSON.parse(inputKey) as object) })
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        entries?: Array<{ verificationNumber: number }>;
      };
      if (!response.ok || !json.entries) throw new Error(journalErrorText(sv, json.code, json.error ?? copy.failed));
      setDone(json.entries.map((entry) => entry.verificationNumber));
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.failed);
    } finally {
      setSaving(false);
    }
  };

  // ─── The list of situations ────────────────────────────────────────────────

  if (!situation) {
    return (
      <div className="stack" style={{ gap: 24 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 style={{ margin: 0 }}>{copy.choose}</h2>
          <p className="note" style={{ maxWidth: "70ch" }}>{copy.chooseHelp}</p>
        </div>
        {groups.map((group) => (
          <div className="stack" key={group.id} style={{ gap: 8 }}>
            <p className="label">{group.title}</p>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
              {group.situations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="secondary"
                  onClick={() => open(item)}
                  style={{ justifyContent: "flex-start", textAlign: "left", padding: "14px 16px", lineHeight: 1.35 }}
                >
                  {item.title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ─── After saving ──────────────────────────────────────────────────────────

  if (done) {
    return (
      <div className="stack" role="status" style={{ gap: 14 }}>
        <h2 style={{ margin: 0 }}>{situation.title}</h2>
        <p className="success" style={{ fontSize: "1rem" }}>
          {done.length === 1 ? copy.doneOne(done[0]) : copy.doneMany(done.join(", "))}
        </p>
        <p className="note" style={{ maxWidth: "70ch" }}>{copy.doneHelp}</p>
        <div className="row">
          <button type="button" onClick={() => setSituation(null)}>
            {copy.another}
          </button>
          <Link className="button secondary" href="/ledger?source=JOURNAL">
            {copy.seeLedger}
          </Link>
        </div>
      </div>
    );
  }

  // ─── The form ──────────────────────────────────────────────────────────────

  const id = situation.id;
  const moneyIn = MONEY_IN.includes(id);
  const amountStyle = { textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const };

  const amountField = (key: keyof Values & string, label: string, help?: string, autoFocus = false) => (
    <label className="stack" style={{ flex: "1 1 200px", maxWidth: 280 }}>
      {label} ({copy.amountKr})
      <input
        type="text"
        inputMode="decimal"
        autoFocus={autoFocus}
        value={values[key] as string}
        aria-invalid={Number.isNaN(parseAmount(values[key] as string))}
        style={amountStyle}
        onChange={(event) => set(key as "amount", event.target.value)}
      />
      {help ? <span className="note">{help}</span> : null}
    </label>
  );

  const dateField = (label: string, help?: string) => (
    <label className="stack" style={{ flex: "0 1 200px" }}>
      {label}
      <input type="date" value={values.date} onChange={(event) => set("date", event.target.value)} required />
      {help ? <span className="note">{help}</span> : null}
    </label>
  );

  const accountSelect = (key: "bankAccount" | "fromAccount" | "toAccount", label: string, options: PickerAccount[]) => (
    <label className="stack" style={{ flex: "1 1 240px", maxWidth: 360 }}>
      {label}
      <select value={values[key]} onChange={(event) => set(key, event.target.value)}>
        {options.map((account) => (
          <option key={account.id} value={account.code}>
            {account.code} {account.name}
          </option>
        ))}
      </select>
    </label>
  );

  const noteField = (
    <label className="stack" style={{ flex: "2 1 280px" }}>
      {copy.note}
      <input
        type="text"
        value={values.text}
        maxLength={120}
        placeholder={copy.notePlaceholder}
        onChange={(event) => set("text", event.target.value)}
      />
    </label>
  );

  const yearField = (
    <label className="stack" style={{ flex: "0 1 140px" }}>
      {copy.year}
      <select
        value={values.year}
        onChange={(event) => {
          const year = Number(event.target.value);
          set("year", year);
          void loadYearSuggestion(id, year);
        }}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </label>
  );

  const reverseField = (
    <label className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
      <input
        type="checkbox"
        checked={values.reverse}
        onChange={(event) => set("reverse", event.target.checked)}
        style={{ marginTop: 4 }}
      />
      <span>
        {copy.reverse}
        <span className="note" style={{ display: "block" }}>{copy.reverseHelp}</span>
      </span>
    </label>
  );

  const bankLabel = moneyIn ? copy.toAccount : copy.fromAccount;
  const vatOwed = vatBalances ? (id === "vat_paid" ? vatBalances.net : -vatBalances.net) : 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 6 }}>
        <div>
          <button type="button" className="tertiary" onClick={() => setSituation(null)}>
            ← {copy.back}
          </button>
        </div>
        <h2 style={{ margin: 0 }}>{situation.title}</h2>
        <p style={{ margin: 0, maxWidth: "72ch", color: "var(--muted)" }}>{situation.blurb}</p>
      </div>

      {SIMPLE.includes(id) ? (
        <div className="row" style={{ alignItems: "flex-start" }}>
          {amountField("amount", copy.amount, undefined, true)}
          {dateField(copy.date, copy.dateHelp)}
          {accountSelect("bankAccount", bankLabel, cashAccounts)}
          {noteField}
        </div>
      ) : null}

      {id === "transfer" ? (
        <div className="row" style={{ alignItems: "flex-start" }}>
          {amountField("amount", copy.amount, undefined, true)}
          {dateField(copy.date)}
          {accountSelect("fromAccount", copy.fromAccount, transferAccounts)}
          {accountSelect("toAccount", copy.toAccount, transferAccounts)}
          {noteField}
        </div>
      ) : null}

      {id === "loan_repayment" ? (
        <div className="row" style={{ alignItems: "flex-start" }}>
          {amountField("amortization", copy.amortization, copy.amortizationHelp, true)}
          {amountField("interest", copy.interest)}
          {amountField("fee", copy.fee)}
          {dateField(copy.date, copy.dateHelp)}
          {accountSelect("bankAccount", copy.fromAccount, cashAccounts)}
          {noteField}
        </div>
      ) : null}

      {id === "vat_paid" || id === "vat_refund" ? (
        <div className="stack">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="stack" style={{ flex: "0 1 220px" }}>
              {copy.periodEnd}
              <input
                type="date"
                value={values.periodEnd}
                onChange={(event) => {
                  set("periodEnd", event.target.value);
                  void loadVatBalances(id, event.target.value);
                }}
                required
              />
              <span className="note">{copy.periodEndHelp}</span>
            </label>
            {amountField("amount", id === "vat_paid" ? copy.vatAmountPaid : copy.vatAmountRefund)}
            {dateField(id === "vat_paid" ? copy.vatDate : copy.vatDateRefund)}
            {accountSelect("bankAccount", bankLabel, cashAccounts)}
          </div>
          {vatBalances && vatBalances.key === values.periodEnd ? (
            <p className="note" style={{ maxWidth: "80ch" }}>
              {vatBalances.outputTotal === 0 && vatBalances.inputTotal === 0
                ? copy.vatNothing
                : `${copy.vatBooks(values.periodEnd, money(vatBalances.outputTotal), money(vatBalances.inputTotal))} ${
                    vatBalances.net >= 0 ? copy.vatToPay(money(vatBalances.net)) : copy.vatToGet(money(-vatBalances.net))
                  }`}
              {(vatBalances.outputTotal !== 0 || vatBalances.inputTotal !== 0) && vatOwed < 0 ? ` ${copy.vatWrongWay}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {id === "tax_payment" ? (
        <div className="stack">
          <div className="row" style={{ alignItems: "flex-start" }}>
            {amountField("amount", copy.amount, undefined, true)}
            {dateField(copy.date, copy.dateHelp)}
            <label className="stack" style={{ flex: "1 1 240px", maxWidth: 360 }}>
              {copy.taxKind}
              <select value={values.taxKind} onChange={(event) => set("taxKind", event.target.value as Values["taxKind"])}>
                <option value="preliminary">{copy.taxPreliminary}</option>
                <option value="other">{copy.taxOther}</option>
              </select>
            </label>
            {accountSelect("bankAccount", copy.fromAccount, cashAccounts)}
          </div>
          <div className="stack" style={{ gap: 8, padding: 16, borderRadius: 12, background: "var(--surface-container-low)" }}>
            <p style={{ margin: 0, maxWidth: "76ch" }}>{situation.effect}</p>
            <p className="note" style={{ maxWidth: "76ch" }}>{copy.taxConfirmHelp}</p>
            <label className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              <input
                type="checkbox"
                checked={values.confirmPrivate}
                onChange={(event) => set("confirmPrivate", event.target.checked)}
                style={{ marginTop: 4 }}
              />
              <span>{copy.taxConfirm}</span>
            </label>
          </div>
        </div>
      ) : null}

      {id === "depreciation" ? (
        <div className="stack">
          <div className="row" style={{ alignItems: "flex-start" }}>
            {yearField}
            {amountField("equipment", copy.depEquipment)}
            {amountField("vehicle", copy.depVehicle)}
            {amountField("building", copy.depBuilding)}
            {amountField("intangible", copy.depIntangible)}
          </div>
          {!depreciation || depreciation.year !== values.year ? (
            <p className="note">{copy.loading}</p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {depreciation.assets.length > 0 ? (
                <>
                  <p className="note">{copy.depFromRegister}</p>
                  <ul className="note" style={{ margin: 0, paddingLeft: 18 }}>
                    {depreciation.assets.map((asset, index) => (
                      <li key={`${asset.description}-${index}`}>
                        {asset.description}: {money(asset.amount)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="note" style={{ maxWidth: "76ch" }}>{copy.depNoAssets}</p>
              )}
              {depreciation.alreadyBooked > 0 ? (
                <p className="error" role="alert">{copy.depAlready(money(depreciation.alreadyBooked))}</p>
              ) : null}
              <p className="note" style={{ maxWidth: "76ch" }}>{copy.depAssumes}</p>
              <p className="note">
                <Link className="textLink" href="/assets">
                  {copy.assetsLink}
                </Link>
              </p>
            </div>
          )}
        </div>
      ) : null}

      {id === "year_end_receivables" ? (
        <div className="stack">
          {!cashMethod ? <p className="badge warn" style={{ borderRadius: 12, padding: "8px 12px" }}>{copy.notCashMethod}</p> : null}
          <div className="row" style={{ alignItems: "flex-start" }}>
            {yearField}
            {amountField("sales25", copy.sales25, copy.inclVat)}
            {amountField("sales12", copy.sales12)}
            {amountField("sales6", copy.sales6)}
            {amountField("sales0", copy.sales0)}
          </div>
          {!receivables || receivables.year !== values.year ? (
            <p className="note">{copy.loading}</p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {receivables.alreadyBooked ? <p className="error" role="alert">{copy.recAlready}</p> : null}
              {receivables.invoices.length === 0 ? (
                <p className="note" style={{ maxWidth: "76ch" }}>{copy.recNone}</p>
              ) : (
                <>
                  <p className="note">{copy.recFromInvoices(receivables.invoices.filter((invoice) => invoice.included).length)}</p>
                  <ul className="note" style={{ margin: 0, paddingLeft: 18 }}>
                    {receivables.invoices
                      .filter((invoice) => invoice.included)
                      .map((invoice) => (
                        <li key={invoice.id}>
                          {invoice.invoiceNumber} {invoice.customerName}: {money(invoice.outstanding)} ({invoice.ratePercent} %)
                        </li>
                      ))}
                  </ul>
                  {receivables.invoices.some((invoice) => !invoice.included) ? (
                    <>
                      <p className="note">{copy.recExcluded}</p>
                      <ul className="note" style={{ margin: 0, paddingLeft: 18 }}>
                        {receivables.invoices
                          .filter((invoice) => !invoice.included)
                          .map((invoice) => (
                            <li key={invoice.id}>
                              {invoice.invoiceNumber} {invoice.customerName}: {invoice.outstanding.toFixed(2)} {invoice.currency} (
                              {invoice.ratePercent} %)
                            </li>
                          ))}
                      </ul>
                    </>
                  ) : null}
                </>
              )}
            </div>
          )}
          {reverseField}
        </div>
      ) : null}

      {id === "year_end_payables" ? (
        <div className="stack">
          {!cashMethod ? <p className="badge warn" style={{ borderRadius: 12, padding: "8px 12px" }}>{copy.notCashMethod}</p> : null}
          {payablesBooked && payablesBooked.year === values.year && payablesBooked.alreadyBooked ? (
            <p className="error" role="alert">{copy.payAlready}</p>
          ) : null}
          <div className="row" style={{ alignItems: "flex-start" }}>{yearField}</div>
          {bills.map((bill, index) => {
            const change = (patch: Partial<Bill>) => {
              setDone(null);
              setBills((list) => list.map((row) => (row.key === bill.key ? { ...row, ...patch } : row)));
            };
            return (
              <div className="row" role="group" aria-label={copy.bill(index + 1)} key={bill.key} style={{ alignItems: "flex-end" }}>
                <label className="stack" style={{ flex: "2 1 200px" }}>
                  {copy.billFrom}
                  <input type="text" value={bill.text} maxLength={80} onChange={(event) => change({ text: event.target.value })} />
                </label>
                <label className="stack" style={{ flex: "1 1 150px" }}>
                  {copy.billGross}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={bill.gross}
                    style={amountStyle}
                    aria-invalid={Number.isNaN(parseAmount(bill.gross))}
                    onChange={(event) => change({ gross: event.target.value })}
                  />
                </label>
                <label className="stack" style={{ flex: "1 1 120px" }}>
                  {copy.billVat}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={bill.vat}
                    style={amountStyle}
                    aria-invalid={Number.isNaN(parseAmount(bill.vat))}
                    onChange={(event) => change({ vat: event.target.value })}
                  />
                </label>
                <div className="stack" style={{ flex: "2 1 240px", gap: 12 }}>
                  <span>{copy.billAccount}</span>
                  <AccountPicker
                    accounts={costAccounts}
                    value={bill.accountId}
                    onChange={(accountId) => change({ accountId })}
                    ariaLabel={`${copy.bill(index + 1)}: ${copy.billAccount}`}
                    placeholder={copy.billAccountPlaceholder}
                    noMatch={copy.noMatch}
                  />
                </div>
                <button
                  type="button"
                  className="tertiary"
                  disabled={bills.length <= 1}
                  onClick={() => setBills((list) => list.filter((row) => row.key !== bill.key))}
                >
                  {copy.removeBill}
                </button>
              </div>
            );
          })}
          <div>
            <button
              type="button"
              className="secondary"
              disabled={bills.length >= 20}
              onClick={() =>
                setBills((list) => [...list, { key: nextBillKey.current++, text: "", gross: "", vat: "", accountId: "" }])
              }
            >
              {copy.addBill}
            </button>
          </div>
          {reverseField}
        </div>
      ) : null}

      {problem ? <p className="error" role="alert">{problem}</p> : null}

      <div className="stack" style={{ gap: 14, padding: 18, borderRadius: 14, background: "var(--surface-container-low)" }}>
        {!inputKey ? (
          <p className="note">{copy.fillIn}</p>
        ) : !current ? (
          <p className="note">{copy.working}</p>
        ) : current.error ? (
          <p className="error" role="alert">{current.error}</p>
        ) : (
          <>
            <EntryPreview locale={locale} entries={current.entries} effect={id === "tax_payment" ? undefined : situation.effect} />
            {current.notices.map((notice) => (
              <p
                key={notice.code}
                className={notice.code === "VAT_ROUNDING" ? "note" : "error"}
                role={notice.code === "VAT_ROUNDING" ? undefined : "alert"}
                style={{ maxWidth: "80ch" }}
              >
                {notice.code === "VAT_ROUNDING"
                  ? copy.noticeRounding(money(notice.amount))
                  : notice.code === "VAT_DIFFERENCE"
                    ? copy.noticeDifference(money(Math.abs(notice.ledgerNet)), money(Math.abs(notice.paid)), money(Math.abs(notice.difference)))
                    : copy.noticeNothing}
              </p>
            ))}
          </>
        )}
      </div>

      <div className="row">
        <button type="button" disabled={!canSave} onClick={() => void save()}>
          {saving ? copy.saving : current && current.entries.length > 1 ? copy.saveMany(current.entries.length) : copy.save}
        </button>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
};
