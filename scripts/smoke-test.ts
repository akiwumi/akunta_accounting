/**
 * smoke-test.ts — Regression smoke test for critical Akunta flows.
 *
 * Hits real HTTP endpoints against a running dev/staging server.
 * Does NOT mock the database — tests run against the actual app.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke-test.ts
 *
 * Exit code 0 = all checks passed.
 * Exit code 1 = one or more checks failed.
 *
 * Flows covered:
 *   1. Health check
 *   2. Auth: register → login → me → logout
 *   3. Receipt: upload placeholder check (auth required)
 *   4. Invoice: list (auth required)
 *   5. Ledger/transactions: list (auth required)
 *   6. Reports: P&L (auth required)
 *   7. Exports: accounts (auth required)
 *   8. Payroll: payslips list (auth required)
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

// ─── Test harness ─────────────────────────────────────────────────────────────

type CheckResult = { name: string; ok: boolean; detail?: string };
const results: CheckResult[] = [];

async function check(
  name: string,
  fn: () => Promise<{ ok: boolean; detail?: string }>
): Promise<void> {
  try {
    const result = await fn();
    results.push({ name, ...result });
    const icon = result.ok ? "✓" : "✗";
    console.log(`  ${icon} ${name}${result.detail ? ` — ${result.detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`  ✗ ${name} — THREW: ${detail}`);
  }
}

async function json(
  path: string,
  opts: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) }
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// Store session cookie across requests
let sessionCookie = "";

function withSession(headers: Record<string, string> = {}): Record<string, string> {
  return sessionCookie ? { ...headers, Cookie: sessionCookie } : headers;
}

// ─── Test run ─────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nAkunta Smoke Test — ${BASE_URL}\n`);

  // 1. Health
  await check("GET /api/health → 200", async () => {
    const { status, body } = await json("/api/health");
    const ok = status === 200 && (body as Record<string, unknown>)?.ok === true;
    return { ok, detail: `status=${status}` };
  });

  // 2. Auth: unauthenticated request blocked
  await check("GET /api/invoices → 401 without session", async () => {
    const { status } = await json("/api/invoices");
    return { ok: status === 401, detail: `status=${status}` };
  });

  // 2a. Register test account
  const testEmail = `smoke-${Date.now()}@test.akunta.local`;
  const testPassword = "SmokeTest!99";
  let registered = false;

  await check("POST /api/auth/register → 201", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        fullName: "Smoke Tester",
        businessName: "Smoke Test AB"
      })
    });
    const cookie = res.headers.get("set-cookie");
    if (cookie) sessionCookie = cookie.split(";")[0];
    registered = res.status === 201;
    return { ok: registered, detail: `status=${res.status}` };
  });

  if (!registered) {
    // Try login with existing account if register failed (e.g. idempotent re-run)
    await check("POST /api/auth/login → 200 (fallback)", async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail, password: testPassword })
      });
      const cookie = res.headers.get("set-cookie");
      if (cookie) sessionCookie = cookie.split(";")[0];
      return { ok: res.status === 200, detail: `status=${res.status}` };
    });
  }

  // 2b. Me
  await check("GET /api/auth/me → 200 with session", async () => {
    const { status, body } = await json("/api/auth/me", { headers: withSession() });
    const ok = status === 200 && !!(body as Record<string, unknown>)?.userId;
    return { ok, detail: `status=${status}` };
  });

  // 3. Receipts list
  await check("GET /api/receipts → 200 with session", async () => {
    const { status } = await json("/api/receipts", { headers: withSession() });
    return { ok: status === 200, detail: `status=${status}` };
  });

  // 4. Invoices list
  await check("GET /api/invoices → 200 with session", async () => {
    const { status } = await json("/api/invoices", { headers: withSession() });
    return { ok: status === 200, detail: `status=${status}` };
  });

  // 5. Transactions list
  await check("GET /api/transactions → 200 with session", async () => {
    const { status } = await json("/api/transactions", { headers: withSession() });
    return { ok: status === 200, detail: `status=${status}` };
  });

  // 6. Reports P&L
  await check("GET /api/reports/pnl → 200 with session", async () => {
    const year = new Date().getFullYear();
    const { status } = await json(`/api/reports/pnl?from=${year}-01-01&to=${year}-12-31`, {
      headers: withSession()
    });
    return { ok: status === 200, detail: `status=${status}` };
  });

  // 7. VAT report
  await check("GET /api/reports/vat → 200 with session", async () => {
    const year = new Date().getFullYear();
    const { status } = await json(`/api/reports/vat?from=${year}-01-01&to=${year}-12-31`, {
      headers: withSession()
    });
    return { ok: status === 200, detail: `status=${status}` };
  });

  // 8. Payslips
  await check("GET /api/payroll/payslips → 200 with session", async () => {
    const { status } = await json("/api/payroll/payslips", { headers: withSession() });
    return { ok: status === 200, detail: `status=${status}` };
  });

  // 9. Audit logs
  await check("GET /api/audit-logs → 200 with session", async () => {
    const { status } = await json("/api/audit-logs", { headers: withSession() });
    return { ok: status === 200, detail: `status=${status}` };
  });

  // 10. Rate limiter (attempt 11 rapid logins from same IP)
  await check("POST /api/auth/login → 429 after 10 attempts", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "notreal@x.com", password: "wrong" })
      });
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    return { ok: lastStatus === 429, detail: `final status=${lastStatus}` };
  });

  // 11. Logout
  await check("POST /api/auth/logout → 200 with session", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: withSession()
    });
    return { ok: res.status === 200, detail: `status=${res.status}` };
  });

  // ─── Summary ────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Smoke test: ${passed} passed, ${failed} failed out of ${results.length} checks.`);

  if (failed > 0) {
    console.log("\nFailed checks:");
    results.filter((r) => !r.ok).forEach((r) => console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`));
    process.exit(1);
  } else {
    console.log("All checks passed.\n");
  }
}

run().catch((err) => {
  console.error("Smoke test runner error:", err);
  process.exit(1);
});
