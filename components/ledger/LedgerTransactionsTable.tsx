"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatMoney } from "@/lib/data/format";
import { type Locale } from "@/lib/i18n/locale";

type LedgerTransactionRow = {
  id: string;
  txnDate: string;
  description: string;
  vendor: string | null;
  direction: string;
  grossAmount: number;
  vatAmount: number;
  currency: string;
  source: string;
  reference: string | null;
  journal: string;
  receiptId: string | null;
};

type LedgerTransactionsTableProps = {
  locale: Locale;
  rows: LedgerTransactionRow[];
  copy: {
    date: string;
    description: string;
    vendor: string;
    direction: string;
    gross: string;
    vat: string;
    sourceCol: string;
    reference: string;
    journal: string;
    input: string;
    erase: string;
    erasing: string;
    none: string;
    reviewReceipt: string;
    reviewTransaction: string;
    deleteConfirm: string;
    deleteFailed: string;
    unknownDeleteError: string;
  };
};

export const LedgerTransactionsTable = ({ locale, rows, copy }: LedgerTransactionsTableProps) => {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async (transactionId: string) => {
    if (!window.confirm(copy.deleteConfirm)) return;

    setDeletingId(transactionId);
    setError(null);
    try {
      const response = await fetch(`/api/transactions/${transactionId}`, {
        method: "DELETE"
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? copy.deleteFailed);
      }
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : copy.unknownDeleteError);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>{copy.date}</th>
              <th>{copy.description}</th>
              <th>{copy.vendor}</th>
              <th>{copy.direction}</th>
              <th>{copy.gross}</th>
              <th>{copy.vat}</th>
              <th>{copy.sourceCol}</th>
              <th>{copy.reference}</th>
              <th>{copy.journal}</th>
              <th>{copy.input}</th>
              <th>{copy.erase}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((txn) => (
              <tr key={txn.id}>
                <td>{txn.txnDate.slice(0, 10)}</td>
                <td>{txn.description}</td>
                <td>{txn.vendor ?? "-"}</td>
                <td>{txn.direction}</td>
                <td>{formatMoney(txn.grossAmount, txn.currency, locale === "sv" ? "sv-SE" : "en-GB")}</td>
                <td>{formatMoney(txn.vatAmount, txn.currency, locale === "sv" ? "sv-SE" : "en-GB")}</td>
                <td>{txn.source}</td>
                <td>{txn.reference ?? "-"}</td>
                <td>{txn.journal}</td>
                <td>
                  {txn.receiptId ? (
                    <Link href={`/review/receipts/${txn.receiptId}`}>{copy.reviewReceipt}</Link>
                  ) : (
                    <Link href={`/review/transactions/${txn.id}`}>{copy.reviewTransaction}</Link>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="secondary"
                    disabled={deletingId === txn.id}
                    onClick={() => onDelete(txn.id)}
                  >
                    {deletingId === txn.id ? copy.erasing : copy.erase}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11}>{copy.none}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
