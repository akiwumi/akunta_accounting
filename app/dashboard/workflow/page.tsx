export const dynamic = "force-dynamic";

import Link from "next/link";

import { ensureBusiness } from "@/lib/data/business";
import { prisma } from "@/lib/db";
import { getRequestLocale } from "@/lib/i18n/locale";

export default async function DashboardWorkflowPage() {
  const locale = getRequestLocale();
  const sv = locale === "sv";
  const numberLocale = sv ? "sv-SE" : "en-GB";

  const copy = sv
    ? {
        title: "Arbetsflöde",
        subtitle: "Skatteuppgifter och granskning.",
        reviewTitle: "Kräver granskning",
        complianceTitle: "Kravlista",
        auditTitle: "Revisionslogg (senaste)",
        noReview: "Inget att granska.",
        noAudit: "Ingen loggad aktivitet ännu.",
        viewReview: "Öppna granskning",
        viewCompliance: "Öppna kravlista",
        viewAudit: "Öppna revisionslogg",
        receiptsNeedReview: "kvitton kräver granskning",
        action: "Åtgärd",
        entity: "Objekt",
        time: "Tidpunkt"
      }
    : {
        title: "Workflow",
        subtitle: "Tax tasks and review queue.",
        reviewTitle: "Needs Review",
        complianceTitle: "Compliance Checklist",
        auditTitle: "Audit Trail (Recent)",
        noReview: "Nothing to review.",
        noAudit: "No activity logged yet.",
        viewReview: "Open Review",
        viewCompliance: "Open Compliance",
        viewAudit: "Open Audit Trail",
        receiptsNeedReview: "receipts need review",
        action: "Action",
        entity: "Entity",
        time: "Time"
      };

  const business = await ensureBusiness();

  const [unReviewedReceipts, recentAuditLogs] = await Promise.all([
    prisma.receipt.count({
      where: { businessId: business.id, needsReview: true }
    }),
    prisma.auditLog.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
      take: 10
    })
  ]);

  return (
    <section className="page">
      <h1 className="title">{copy.title}</h1>
      <p className="subtitle">{copy.subtitle}</p>

      <article className="card">
        <div className="cardHeader row">
          <h2>{copy.reviewTitle}</h2>
          <Link href="/review" className="button secondary">{copy.viewReview}</Link>
        </div>
        {unReviewedReceipts === 0 ? (
          <p className="note">{copy.noReview}</p>
        ) : (
          <ul className="workflowList">
            <li className="workflowItem workflowItemWarning">
              <span className="workflowItemCount">{unReviewedReceipts}</span>
              <span>{copy.receiptsNeedReview}</span>
              <Link href="/review#recent-receipts" className="button secondary workflowItemAction">→</Link>
            </li>
          </ul>
        )}
      </article>

      <article className="card">
        <div className="cardHeader row">
          <h2>{copy.complianceTitle}</h2>
          <Link href="/compliance" className="button secondary">{copy.viewCompliance}</Link>
        </div>
        <p className="note">
          {sv
            ? "Kravlistan innehåller alla svenska skatteåtaganden för egenföretagare."
            : "The compliance checklist covers all Swedish tax obligations for sole traders."}
        </p>
      </article>

      <article className="card">
        <div className="cardHeader row">
          <h2>{copy.auditTitle}</h2>
          <Link href="/audit" className="button secondary">{copy.viewAudit}</Link>
        </div>
        {recentAuditLogs.length === 0 ? (
          <p className="note">{copy.noAudit}</p>
        ) : (
          <table className="dataTable">
            <thead>
              <tr>
                <th>{copy.action}</th>
                <th>{copy.entity}</th>
                <th>{copy.time}</th>
              </tr>
            </thead>
            <tbody>
              {recentAuditLogs.map((log) => (
                <tr key={log.id}>
                  <td>{log.action}</td>
                  <td>{log.entityType} {log.entityId.slice(0, 8)}…</td>
                  <td>{new Date(log.createdAt).toLocaleString(numberLocale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}
