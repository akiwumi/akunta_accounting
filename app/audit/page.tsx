export const dynamic = "force-dynamic";

import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";

const PAGE_SIZE = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(d: Date | string, sv: boolean): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString(sv ? "sv-SE" : "en-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionLabel(action: string, sv: boolean): string {
  const map: Record<string, [string, string]> = {
    CREATE:      ["Skapad",     "Created"],
    UPDATE:      ["Uppdaterad", "Updated"],
    DELETE:      ["Raderad",    "Deleted"],
    APPROVE:     ["Godkänd",    "Approved"],
    PAY:         ["Betald",     "Paid"],
    SUBMIT:      ["Inlämnad",   "Submitted"],
    LOCK:        ["Låst",       "Locked"],
    EXPORT:      ["Exporterad", "Exported"],
    LOGIN:       ["Inloggad",   "Logged in"],
    LOGOUT:      ["Utloggad",   "Logged out"],
    REGISTER:    ["Registrerad","Registered"],
  };
  const [s, e] = map[action.toUpperCase()] ?? [action, action];
  return sv ? s : e;
}

function entityTypeLabel(type: string, sv: boolean): string {
  const map: Record<string, [string, string]> = {
    Receipt:            ["Kvitto",         "Receipt"],
    Invoice:            ["Faktura",        "Invoice"],
    Transaction:        ["Transaktion",    "Transaction"],
    Employee:           ["Anställd",       "Employee"],
    SalaryEntry:        ["Lön",            "Salary"],
    EmployeeExpense:    ["Utlägg",         "Expense"],
    Filing:             ["Deklaration",    "Filing"],
    PeriodLock:         ["Periodinlåsning","Period lock"],
    Business:           ["Företag",        "Business"],
    User:               ["Användare",      "User"],
    BankStatementLine:  ["Bankrad",        "Bank line"],
    CreditNote:         ["Kreditnota",     "Credit note"],
    InvoicePayment:     ["Betalning",      "Payment"],
    FixedAsset:         ["Inventarium",    "Fixed asset"],
    MileageEntry:       ["Körjournal",     "Mileage entry"],
  };
  const [s, e] = map[type] ?? [type, type];
  return sv ? s : e;
}

function actionBadgeClass(action: string): string {
  const a = action.toUpperCase();
  if (a === "DELETE")                         return "auditBadgeDelete";
  if (a === "CREATE" || a === "REGISTER")     return "auditBadgeCreate";
  if (a === "APPROVE" || a === "PAY" || a === "SUBMIT") return "auditBadgeApprove";
  if (a === "LOCK")                           return "auditBadgeLock";
  return "auditBadgeDefault";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: { page?: string; type?: string };
}) {
  const locale = getRequestLocale();
  const sv = locale === "sv";

  const business = await ensureBusiness();

  const page   = Math.max(1, parseInt(searchParams?.page ?? "1", 10));
  const filter = searchParams?.type ?? "";

  const where = {
    businessId: business.id,
    ...(filter ? { entityType: filter } : {}),
  };

  const [logs, total, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { fullName: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog
      .findMany({
        where: { businessId: business.id },
        select: { entityType: true },
        distinct: ["entityType"],
        orderBy: { entityType: "asc" },
      })
      .then((rows) => rows.map((r) => r.entityType)),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <section className="page">
      <h1 className="title">{sv ? "Revisionslogg" : "Audit Trail"}</h1>
      <p className="subtitle">
        {sv
          ? "Alla ändringar som gjorts i ditt konto, med vem och när."
          : "Every change made in your account — who did it and when."}
      </p>

      {/* Filter bar */}
      <div className="auditFilterBar">
        <a
          href="/audit"
          className={`auditFilterChip ${!filter ? "auditFilterChipActive" : ""}`}
        >
          {sv ? "Alla" : "All"} ({total})
        </a>
        {entityTypes.map((type) => (
          <a
            key={type}
            href={`/audit?type=${encodeURIComponent(type)}`}
            className={`auditFilterChip ${filter === type ? "auditFilterChipActive" : ""}`}
          >
            {entityTypeLabel(type, sv)}
          </a>
        ))}
      </div>

      {/* Log table */}
      {logs.length === 0 ? (
        <article className="card">
          <p className="note">
            {sv ? "Inga loggposter hittades." : "No audit log entries found."}
          </p>
        </article>
      ) : (
        <article className="card auditTableWrap">
          <table className="auditTable">
            <thead>
              <tr>
                <th>{sv ? "Tidpunkt" : "Timestamp"}</th>
                <th>{sv ? "Typ" : "Entity"}</th>
                <th>{sv ? "Åtgärd" : "Action"}</th>
                <th>{sv ? "Referens" : "Reference"}</th>
                <th>{sv ? "Användare" : "User"}</th>
                <th>{sv ? "Förändring" : "Change"}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                let before: Record<string, unknown> | null = null;
                let after: Record<string, unknown> | null = null;
                try {
                  if (log.beforeJson) before = JSON.parse(log.beforeJson) as Record<string, unknown>;
                  if (log.afterJson) after = JSON.parse(log.afterJson) as Record<string, unknown>;
                } catch {
                  /* ignore malformed JSON */
                }

                const changedKeys = after
                  ? Object.keys(after).filter(
                      (k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])
                    )
                  : [];

                return (
                  <tr key={log.id}>
                    <td className="auditTsCell">{formatTs(log.createdAt, sv)}</td>
                    <td>{entityTypeLabel(log.entityType, sv)}</td>
                    <td>
                      <span className={`auditBadge ${actionBadgeClass(log.action)}`}>
                        {actionLabel(log.action, sv)}
                      </span>
                    </td>
                    <td className="auditRefCell">{log.entityId.slice(0, 8)}…</td>
                    <td className="auditUserCell">
                      {log.user ? (log.user.fullName ?? log.user.email) : (sv ? "System" : "System")}
                    </td>
                    <td className="auditChangeCell">
                      {changedKeys.length > 0 ? (
                        <ul className="auditChangelist">
                          {changedKeys.slice(0, 4).map((k) => (
                            <li key={k}>
                              <span className="auditChangeKey">{k}</span>
                              {" → "}
                              <span className="auditChangeVal">
                                {String(after?.[k] ?? "").slice(0, 40)}
                              </span>
                            </li>
                          ))}
                          {changedKeys.length > 4 && (
                            <li className="auditChangeMore">
                              +{changedKeys.length - 4} {sv ? "fler fält" : "more fields"}
                            </li>
                          )}
                        </ul>
                      ) : (
                        <span className="auditNoChange">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </article>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="auditPagination">
          {page > 1 && (
            <a
              href={`/audit?${filter ? `type=${encodeURIComponent(filter)}&` : ""}page=${page - 1}`}
              className="button"
            >
              {sv ? "← Föregående" : "← Previous"}
            </a>
          )}
          <span className="auditPaginationInfo">
            {sv
              ? `Sida ${page} av ${totalPages} (${total} poster)`
              : `Page ${page} of ${totalPages} (${total} entries)`}
          </span>
          {page < totalPages && (
            <a
              href={`/audit?${filter ? `type=${encodeURIComponent(filter)}&` : ""}page=${page + 1}`}
              className="button"
            >
              {sv ? "Nästa →" : "Next →"}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
