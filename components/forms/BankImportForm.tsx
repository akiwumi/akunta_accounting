"use client";

import { useState } from "react";

import { type Locale } from "@/lib/i18n/locale";

type ImportResponse = {
  batchId: string;
  importedRows: number;
  acceptedRows: number;
  rejectedRows: number;
  rows: Array<{
    rowNumber: number;
    status: string;
    description: string;
    amount: number;
    rejectionReason?: string;
  }>;
  error?: string;
};

export const BankImportForm = ({ locale }: { locale: Locale }) => {
  const copy =
    locale === "sv"
      ? {
          importing: "Importerar...",
          importBtn: "Importera bank-CSV",
          note:
            "Obligatoriska kolumner: date, description, amount. Valfria: vat_rate, category, currency.",
          imported: "Batch",
          importedSuffix: "importerades.",
          importedLabel: "Importerade",
          acceptedLabel: "Godkända",
          rejectedLabel: "Avvisade",
          row: "Rad",
          description: "Beskrivning",
          reason: "Orsak",
          failImport: "Import misslyckades",
          unknownImportError: "Okänt importfel"
        }
      : {
          importing: "Importing...",
          importBtn: "Import Bank CSV",
          note:
            "Required columns: date, description, amount. Optional: vat_rate, category, currency.",
          imported: "Batch",
          importedSuffix: "imported.",
          importedLabel: "Imported",
          acceptedLabel: "Accepted",
          rejectedLabel: "Rejected",
          row: "Row",
          description: "Description",
          reason: "Reason",
          failImport: "Import failed",
          unknownImportError: "Unknown import error"
        };

  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;

    setSubmitting(true);
    setError(null);

    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/imports/bank-csv", {
        method: "POST",
        body
      });
      const json = (await response.json()) as ImportResponse;
      if (!response.ok) throw new Error(json.error ?? copy.failImport);
      setResult(json);
      setFile(null);
      const input = document.getElementById("bank-csv-file") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : copy.unknownImportError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="stack" onSubmit={onSubmit}>
      <div className="row">
        <input
          id="bank-csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button type="submit" disabled={!file || submitting}>
          {submitting ? copy.importing : copy.importBtn}
        </button>
      </div>
      <p className="note">{copy.note}</p>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="card stack">
          <p className="success">
            {copy.imported} {result.batchId} {copy.importedSuffix}
          </p>
          <p className="note">
            {copy.importedLabel}: {result.importedRows} · {copy.acceptedLabel}: {result.acceptedRows} ·{" "}
            {copy.rejectedLabel}: {result.rejectedRows}
          </p>
          {result.rows.filter((row) => row.status === "rejected").length > 0 && (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>{copy.row}</th>
                    <th>{copy.description}</th>
                    <th>{copy.reason}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows
                    .filter((row) => row.status === "rejected")
                    .slice(0, 8)
                    .map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>{row.description}</td>
                        <td>{row.rejectionReason}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </form>
  );
};
