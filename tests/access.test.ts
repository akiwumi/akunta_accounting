/**
 * Integration tests for access control: roles, invitations, members, switching
 * business and tenant isolation.
 *
 * They run against a real PostgreSQL database built from prisma/migrations and
 * call the lib functions directly. Where a function needs "the current HTTP
 * request" (session cookie, method, path) the test supplies it with
 * runWithRequestInfo(), which stands in for the proxy.
 *
 *   npm run test            (see scripts/test.sh)
 *
 * Safety: refuses to run unless the database name ends in "_test".
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { NextRequest } from "next/server";

import {
  ForbiddenError,
  getAuthContext,
  getUserContext,
  requireAuthContext,
  requireOwner,
  requireRole,
  resolveAuthContext,
  UnauthorizedError
} from "@/lib/auth/context";
import {
  acceptInvitation,
  createInvitation,
  hashInvitationToken,
  listPendingInvitations,
  lookupInvitation,
  registerWithInvitation,
  resendInvitation,
  revokeInvitation
} from "@/lib/auth/invitations";
import { changeMemberRole, leaveBusiness, listMembers, removeMember, TeamError } from "@/lib/auth/members";
import { runWithRequestInfo } from "@/lib/auth/requestInfo";
import { checkAccess, Roles } from "@/lib/auth/roles";
import {
  createSession,
  getSessionByToken,
  pickLoginBusinessId,
  switchSessionBusiness,
  verifyUserCredentials
} from "@/lib/auth/session";
import {
  ACCESS_COOKIE_NAME,
  readAccessCookie,
  REQUEST_METHOD_HEADER,
  signAccessCookie,
  signRequestLine,
  verifyRequestLine
} from "@/lib/auth/signing";
import { prisma } from "@/lib/db";
import { proxy } from "@/proxy";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run access tests against "${dbName}". Use a database whose name ends in _test.`);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0;
const unique = (label: string) => `${label}-${Date.now()}-${(seq += 1)}`;

const makeBusiness = (name: string) =>
  prisma.business.create({ data: { name, fiscalYearStart: new Date("2031-01-01T00:00:00.000Z") } });

const makeUser = (label: string) =>
  prisma.user.create({
    data: { email: `${unique(label)}@example.test`, fullName: label, emailVerifiedAt: new Date() }
  });

const join = (userId: string, businessId: string, role: string) =>
  prisma.membership.create({ data: { userId, businessId, role } });

/** Runs `fn` as an HTTP request made with this session, method and path. */
const asRequest = <T>(sessionToken: string | null, method: string | null, pathname: string | null, fn: () => Promise<T>) =>
  runWithRequestInfo({ sessionToken, method, pathname }, fn);

const forbidden = (code: string) => (error: unknown) => error instanceof ForbiddenError && error.code === code;
const teamError = (code: string) => (error: unknown) => error instanceof TeamError && error.code === code;

type Fixture = {
  businessA: string;
  businessB: string;
  owner: { id: string; token: string };
  accountant: { id: string; token: string; membershipId: string };
  viewer: { id: string; token: string };
  ownerB: { id: string; token: string };
};
let fx: Fixture;

before(async () => {
  const [a, b] = await Promise.all([makeBusiness("Access Test A"), makeBusiness("Access Test B")]);
  const [owner, accountant, viewer, ownerB] = await Promise.all([
    makeUser("owner"),
    makeUser("accountant"),
    makeUser("viewer"),
    makeUser("owner-b")
  ]);
  await join(owner.id, a.id, "owner");
  const accountantMembership = await join(accountant.id, a.id, "accountant");
  await join(viewer.id, a.id, "viewer");
  await join(ownerB.id, b.id, "owner");

  fx = {
    businessA: a.id,
    businessB: b.id,
    owner: { id: owner.id, token: await createSession(owner.id, a.id) },
    accountant: {
      id: accountant.id,
      token: await createSession(accountant.id, a.id),
      membershipId: accountantMembership.id
    },
    viewer: { id: viewer.id, token: await createSession(viewer.id, a.id) },
    ownerB: { id: ownerB.id, token: await createSession(ownerB.id, b.id) }
  };
});

after(async () => {
  await prisma.$disconnect();
});

// ─── Roles ────────────────────────────────────────────────────────────────────

test("a viewer can read but is refused for every method that is not GET or HEAD", async () => {
  for (const method of ["GET", "HEAD"]) {
    const ctx = await asRequest(fx.viewer.token, method, "/api/invoices", requireAuthContext);
    assert.equal(ctx.role, "viewer");
    assert.equal(ctx.businessId, fx.businessA);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT", "post", "FOO"]) {
    await assert.rejects(
      asRequest(fx.viewer.token, method, "/api/invoices", requireAuthContext),
      forbidden("read_only"),
      `viewer must not be allowed to ${method}`
    );
  }
});

test("a viewer is refused when the method is unknown (the request did not pass the proxy)", async () => {
  await assert.rejects(asRequest(fx.viewer.token, null, null, requireAuthContext), forbidden("read_only"));
  await assert.rejects(asRequest(fx.viewer.token, null, "/api/invoices", requireAuthContext), forbidden("read_only"));
  // Even on an allowlisted path the method is unknown, but the allowlist is by
  // path: those requests only touch the person's own account.
  await assert.rejects(asRequest(fx.viewer.token, "POST", null, requireAuthContext), forbidden("read_only"));
});

test("a viewer may make the few own-account requests, and nothing that merely looks like them", async () => {
  for (const pathname of ["/api/auth/logout", "/api/locale", "/api/session/switch", "/api/user/preferences"]) {
    const ctx = await asRequest(fx.viewer.token, "POST", pathname, requireAuthContext);
    assert.equal(ctx.role, "viewer");
  }
  for (const pathname of ["/api/auth/logout/x", "/api/session/switchx", "/api/session", "/api/settings/locale"]) {
    await assert.rejects(asRequest(fx.viewer.token, "POST", pathname, requireAuthContext), forbidden("read_only"));
  }
});

test("a viewer is never an owner or a bookkeeper, whatever the method", async () => {
  await assert.rejects(asRequest(fx.viewer.token, "GET", "/api/members", requireOwner), forbidden("owner_only"));
  await assert.rejects(
    asRequest(fx.viewer.token, "GET", "/api/x", () => requireRole(Roles.OWNER, Roles.ACCOUNTANT)),
    forbidden("role")
  );
});

test("an accountant can book but cannot manage members, invitations, billing or the business identity", async () => {
  for (const [method, pathname] of [
    ["POST", "/api/receipts/manual"],
    ["PATCH", "/api/transactions/abc"],
    ["DELETE", "/api/invoices/abc/payments/def"],
    ["POST", "/api/year-end/close"],
    ["POST", "/api/settings/receipt-inbox"],
    ["GET", "/api/members"],
    ["GET", "/api/billing/subscription"],
    ["POST", "/api/members/leave"]
  ]) {
    const ctx = await asRequest(fx.accountant.token, method, pathname, requireAuthContext);
    assert.equal(ctx.role, "accountant");
  }

  for (const [method, pathname] of [
    ["POST", "/api/invitations"],
    ["DELETE", "/api/invitations/abc"],
    ["POST", "/api/invitations/abc/resend"],
    ["PATCH", "/api/members/abc"],
    ["DELETE", "/api/members/abc"],
    ["POST", "/api/billing/checkout"],
    ["POST", "/api/billing/portal"],
    ["PUT", "/api/settings"],
    ["PUT", "/api/settings/"],
    ["POST", "/api/onboarding/country"],
    ["POST", "/api/tax/profiles/apply"]
  ]) {
    await assert.rejects(
      asRequest(fx.accountant.token, method, pathname, requireAuthContext),
      forbidden("owner_only"),
      `accountant must not ${method} ${pathname}`
    );
  }

  // requireOwner() refuses on any path, and so do the lib functions themselves.
  await assert.rejects(asRequest(fx.accountant.token, "POST", "/api/anything", requireOwner), forbidden("owner_only"));
  await assert.rejects(
    createInvitation({ businessId: fx.businessA, actorUserId: fx.accountant.id, email: "x@example.test", role: "viewer" }),
    teamError("owner_only")
  );
  await assert.rejects(
    changeMemberRole({
      businessId: fx.businessA,
      actorUserId: fx.accountant.id,
      membershipId: fx.accountant.membershipId,
      role: "owner"
    }),
    teamError("owner_only")
  );

  // Unverified request line: only an owner is let through.
  await assert.rejects(asRequest(fx.accountant.token, null, null, requireAuthContext), forbidden("unverified"));
});

test("an owner is allowed everything", async () => {
  for (const [method, pathname] of [
    ["GET", "/api/invoices"],
    ["POST", "/api/invitations"],
    ["DELETE", "/api/members/abc"],
    ["PUT", "/api/settings"],
    ["POST", "/api/billing/checkout"],
    [null, null]
  ] as const) {
    const ctx = await asRequest(fx.owner.token, method, pathname, requireOwner);
    assert.deepEqual([ctx.role, ctx.businessId, ctx.userId], ["owner", fx.businessA, fx.owner.id]);
  }
});

test("a role the app does not know gets read-only rights, never more", async () => {
  const user = await makeUser("odd-role");
  await join(user.id, fx.businessA, "admin");
  const token = await createSession(user.id, fx.businessA);

  const ctx = await asRequest(token, "GET", "/api/invoices", requireAuthContext);
  assert.equal(ctx.role, "viewer");
  await assert.rejects(asRequest(token, "POST", "/api/invoices", requireAuthContext), forbidden("read_only"));
});

test("no session, a made-up session or a deactivated account gets no context", async () => {
  await assert.rejects(asRequest(null, "GET", "/api/invoices", requireAuthContext), UnauthorizedError);
  await assert.rejects(asRequest("f".repeat(64), "GET", "/api/invoices", requireAuthContext), UnauthorizedError);
  assert.equal(await asRequest("f".repeat(64), "GET", "/", getAuthContext), null);

  const user = await makeUser("deactivated");
  await join(user.id, fx.businessA, "owner");
  const token = await createSession(user.id, fx.businessA);
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  await assert.rejects(asRequest(token, "GET", "/api/invoices", requireAuthContext), UnauthorizedError);
  assert.equal(await asRequest(token, "GET", "/", getUserContext), null);
});

test("the policy table: unknown method or path never widens a non-owner's rights", () => {
  assert.equal(checkAccess("viewer", undefined, undefined), "read_only");
  assert.equal(checkAccess("viewer", "GET", null), null);
  assert.equal(checkAccess("accountant", "POST", null), "unverified");
  assert.equal(checkAccess("accountant", null, "/api/receipts"), "unverified");
  assert.equal(checkAccess("accountant", "POST", "/api/membersx"), null);
  assert.equal(checkAccess("accountant", "POST", "/api/billing/webhook"), null);
  assert.equal(checkAccess("owner", null, null), null);
});

// ─── Proxy and signatures ─────────────────────────────────────────────────────

test("the request line and the role cookie cannot be forged or moved", async () => {
  const signature = await signRequestLine("GET", "/api/invoices");
  assert.equal(await verifyRequestLine("GET", "/api/invoices", signature), true);
  assert.equal(await verifyRequestLine("POST", "/api/invoices", signature), false);
  assert.equal(await verifyRequestLine("GET", "/api/other", signature), false);
  assert.equal(await verifyRequestLine("GET", "/api/invoices", ""), false);
  assert.equal(await verifyRequestLine("GET", "/api/invoices", null), false);

  const cookie = await signAccessCookie("session-one", "viewer", fx.businessA);
  assert.deepEqual(await readAccessCookie(cookie, "session-one"), { role: "viewer", businessId: fx.businessA });
  assert.equal(await readAccessCookie(cookie, "session-two"), null, "bound to the session it was issued for");
  assert.equal(await readAccessCookie(cookie.replace(/^viewer/, "owner"), "session-one"), null, "role cannot be edited");
  assert.equal(await readAccessCookie(`owner.${fx.businessA}.9999999999.deadbeef`, "session-one"), null);
  assert.equal(await readAccessCookie("", "session-one"), null);

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 60 * 1000;
    assert.equal(await readAccessCookie(cookie, "session-one"), null, "expires after ten minutes");
  } finally {
    Date.now = realNow;
  }
});

test("the proxy overwrites a client-supplied method header and answers a viewer's write with 403", async () => {
  const request = (method: string, pathname: string, cookies: Record<string, string>, headers: Record<string, string> = {}) =>
    new NextRequest(`http://localhost:3000${pathname}`, {
      method,
      headers: {
        ...headers,
        cookie: Object.entries(cookies)
          .map(([name, value]) => `${name}=${value}`)
          .join("; ")
      }
    });
  const forwardedMethod = (response: Response) => response.headers.get(`x-middleware-request-${REQUEST_METHOD_HEADER}`);

  // A client claiming "GET" on a POST: the app sees POST. Also on a path with a dot.
  for (const pathname of ["/api/receipts/manual", "/api/receipts/a.b"]) {
    const passed = await proxy(
      request("POST", pathname, { akunta_session: "s1" }, { [REQUEST_METHOD_HEADER]: "GET", "x-akunta-request-sig": "x" })
    );
    assert.equal(passed.status, 200);
    assert.equal(forwardedMethod(passed), "POST");
    assert.equal(
      passed.headers.get("x-middleware-request-x-akunta-request-sig"),
      await signRequestLine("POST", pathname)
    );
  }

  const viewerCookie = await signAccessCookie("s1", "viewer", fx.businessA);
  const denied = await proxy(request("POST", "/api/receipts/manual", { akunta_session: "s1", [ACCESS_COOKIE_NAME]: viewerCookie, locale: "sv" }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("x-akunta-denied"), "read_only");
  const body = (await denied.json()) as { error: string; code: string };
  assert.equal(body.code, "read_only");
  assert.match(body.error, /läsbehörighet/);

  // Reads and own-account requests pass.
  assert.equal((await proxy(request("GET", "/api/invoices", { akunta_session: "s1", [ACCESS_COOKIE_NAME]: viewerCookie }))).status, 200);
  assert.equal((await proxy(request("POST", "/api/session/switch", { akunta_session: "s1", [ACCESS_COOKIE_NAME]: viewerCookie }))).status, 200);

  // An accountant's cookie: books yes, members no.
  const accountantCookie = await signAccessCookie("s1", "accountant", fx.businessA);
  assert.equal((await proxy(request("POST", "/api/receipts/manual", { akunta_session: "s1", [ACCESS_COOKIE_NAME]: accountantCookie }))).status, 200);
  const ownerOnly = await proxy(request("POST", "/api/invitations", { akunta_session: "s1", [ACCESS_COOKIE_NAME]: accountantCookie }));
  assert.equal(ownerOnly.status, 403);
  assert.equal(ownerOnly.headers.get("x-akunta-denied"), "owner_only");

  // A cookie that does not verify decides nothing in the proxy; the handler's database check does.
  const forged = await proxy(request("POST", "/api/receipts/manual", { akunta_session: "s1", [ACCESS_COOKIE_NAME]: `owner.${fx.businessA}.9999999999.00` }));
  assert.equal(forged.status, 200);

  // No session: API gets 401, the invitation page and its API stay reachable.
  assert.equal((await proxy(request("POST", "/api/receipts/manual", {}))).status, 401);
  assert.equal((await proxy(request("GET", "/invite/abc", {}))).status, 200);
  assert.equal((await proxy(request("POST", "/api/invitations/accept", {}))).status, 200);
  assert.equal((await proxy(request("POST", "/api/invitations", {}))).status, 401);
});

// ─── Invitations ──────────────────────────────────────────────────────────────

test("an invitation stores only the hash of its token and shows who invites to what", async () => {
  const email = `${unique("Invitee")}@Example.Test`;
  const { invitation, token } = await createInvitation({
    businessId: fx.businessA,
    actorUserId: fx.owner.id,
    email,
    role: "accountant"
  });

  assert.match(token, /^[0-9a-f]{64}$/);
  const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
  assert.equal(row.tokenHash, hashInvitationToken(token));
  assert.notEqual(row.tokenHash, token);
  assert.equal(JSON.stringify(row).includes(token), false, "the token itself is nowhere in the row");
  assert.equal(row.email, email.toLowerCase());
  const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 6.99 && days <= 7, `expires in 7 days, got ${days}`);

  const audit = await prisma.auditLog.findMany({ where: { businessId: fx.businessA, entityType: "Invitation", entityId: invitation.id } });
  assert.deepEqual(audit.map((a) => a.action), ["CREATE"]);
  assert.equal(JSON.stringify(audit).includes(token), false, "the token is not written to the audit log");

  const view = await lookupInvitation(token);
  assert.equal(view?.status, "pending");
  assert.equal(view?.businessName, "Access Test A");
  assert.equal(view?.role, "accountant");
  assert.equal(view?.hasAccount, false);
  assert.equal(await lookupInvitation(hashInvitationToken(token)), null, "the stored hash is not a usable link");
  assert.equal(await lookupInvitation("0".repeat(64)), null);

  await assert.rejects(
    createInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, email: "x@example.test", role: "owner" }),
    teamError("invalid_role")
  );
});

test("an invitation can only be accepted by the invited email address, and only once", async () => {
  const invitee = await makeUser("invitee");
  const stranger = await makeUser("stranger");
  const { token, invitation } = await createInvitation({
    businessId: fx.businessA,
    actorUserId: fx.owner.id,
    email: invitee.email,
    role: "viewer"
  });

  // Someone else holding the link, even an owner of another business, gets nothing.
  await assert.rejects(acceptInvitation({ token, userId: stranger.id }), teamError("email_mismatch"));
  await assert.rejects(acceptInvitation({ token, userId: fx.ownerB.id }), teamError("email_mismatch"));
  assert.equal(await prisma.membership.count({ where: { businessId: fx.businessA, userId: stranger.id } }), 0);
  assert.equal((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).acceptedAt, null);

  const accepted = await acceptInvitation({ token, userId: invitee.id });
  assert.deepEqual([accepted.businessId, accepted.role], [fx.businessA, "viewer"]);
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { userId_businessId: { userId: invitee.id, businessId: fx.businessA } }
  });
  assert.equal(membership.role, "viewer");

  // Single use.
  await assert.rejects(acceptInvitation({ token, userId: invitee.id }), teamError("invitation_used"));
  assert.equal((await lookupInvitation(token))?.status, "accepted");
  assert.equal(await prisma.membership.count({ where: { businessId: fx.businessA, userId: invitee.id } }), 1);

  const actions = (
    await prisma.auditLog.findMany({
      where: { businessId: fx.businessA, entityId: { in: [invitation.id, membership.id] } },
      orderBy: { createdAt: "asc" }
    })
  ).map((a) => `${a.entityType}:${a.action}`);
  assert.deepEqual(actions.sort(), ["Invitation:ACCEPT", "Invitation:CREATE", "Membership:CREATE"]);

  // Already a member: cannot be invited again.
  await assert.rejects(
    createInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, email: invitee.email, role: "accountant" }),
    teamError("already_member")
  );
});

test("two simultaneous accepts of one invitation give exactly one membership", async () => {
  const invitee = await makeUser("racer");
  const { token } = await createInvitation({
    businessId: fx.businessA,
    actorUserId: fx.owner.id,
    email: invitee.email,
    role: "viewer"
  });
  const results = await Promise.allSettled([
    acceptInvitation({ token, userId: invitee.id }),
    acceptInvitation({ token, userId: invitee.id })
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await prisma.membership.count({ where: { businessId: fx.businessA, userId: invitee.id } }), 1);
});

test("an expired invitation cannot be accepted; resending issues a new link and kills the old one", async () => {
  const invitee = await makeUser("late");
  const { token, invitation } = await createInvitation({
    businessId: fx.businessA,
    actorUserId: fx.owner.id,
    email: invitee.email,
    role: "accountant"
  });
  await prisma.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

  assert.equal((await lookupInvitation(token))?.status, "expired");
  await assert.rejects(acceptInvitation({ token, userId: invitee.id }), teamError("invitation_expired"));
  await assert.rejects(
    registerWithInvitation({ token, fullName: "Late", password: "long-enough-password" }),
    teamError("invitation_expired")
  );
  assert.equal((await listPendingInvitations(fx.businessA)).find((i) => i.id === invitation.id)?.expired, true);

  const resent = await resendInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, invitationId: invitation.id });
  assert.notEqual(resent.token, token);
  assert.equal(await lookupInvitation(token), null, "the old link no longer matches anything");
  await assert.rejects(acceptInvitation({ token, userId: invitee.id }), teamError("invalid_invitation"));

  const accepted = await acceptInvitation({ token: resent.token, userId: invitee.id });
  assert.equal(accepted.role, "accountant");
  await assert.rejects(
    resendInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, invitationId: invitation.id }),
    teamError("invitation_used")
  );
});

test("a revoked invitation cannot be accepted, and a new invitation replaces the previous one", async () => {
  const invitee = await makeUser("revoked");
  const first = await createInvitation({
    businessId: fx.businessA,
    actorUserId: fx.owner.id,
    email: invitee.email,
    role: "accountant"
  });
  await revokeInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, invitationId: first.invitation.id });
  assert.equal((await lookupInvitation(first.token))?.status, "revoked");
  await assert.rejects(acceptInvitation({ token: first.token, userId: invitee.id }), teamError("invitation_revoked"));
  await assert.rejects(
    resendInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, invitationId: first.invitation.id }),
    teamError("invitation_revoked")
  );

  // Inviting the same address twice leaves one live link.
  const second = await createInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, email: invitee.email, role: "viewer" });
  const third = await createInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, email: invitee.email, role: "viewer" });
  await assert.rejects(acceptInvitation({ token: second.token, userId: invitee.id }), teamError("invitation_revoked"));
  assert.equal((await listPendingInvitations(fx.businessA)).filter((i) => i.email === invitee.email).length, 1);
  await revokeInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, invitationId: third.invitation.id });
  assert.equal(await prisma.membership.count({ where: { businessId: fx.businessA, userId: invitee.id } }), 0);

  const actions = (
    await prisma.auditLog.findMany({ where: { businessId: fx.businessA, entityType: "Invitation", entityId: first.invitation.id } })
  ).map((a) => a.action);
  assert.deepEqual(actions.sort(), ["CREATE", "REVOKE"]);
});

test("creating an account from an invitation does not create a business", async () => {
  const email = `${unique("new-accountant")}@example.test`;
  const { token } = await createInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, email, role: "accountant" });

  const businessesBefore = await prisma.business.count();
  const accepted = await registerWithInvitation({ token, fullName: "  Nya Konsulten ", password: "a-good-password" });
  assert.equal(await prisma.business.count(), businessesBefore, "no business was created");

  const user = await prisma.user.findUniqueOrThrow({ where: { id: accepted.userId }, include: { memberships: true } });
  assert.equal(user.email, email, "the address comes from the invitation");
  assert.equal(user.fullName, "Nya Konsulten");
  assert.ok(user.emailVerifiedAt, "the link proved the address");
  assert.equal(user.emailVerificationToken, null);
  assert.deepEqual(
    user.memberships.map((m) => [m.businessId, m.role]),
    [[fx.businessA, "accountant"]]
  );
  assert.ok(await verifyUserCredentials(email, "a-good-password"), "they can sign in with the password they chose");

  // The link is spent, and it cannot be used to reset an existing account's password.
  await assert.rejects(
    registerWithInvitation({ token, fullName: "Again", password: "another-password" }),
    teamError("invitation_used")
  );
  const other = await createInvitation({ businessId: fx.businessB, actorUserId: fx.ownerB.id, email, role: "viewer" });
  await assert.rejects(
    registerWithInvitation({ token: other.token, fullName: "Takeover", password: "attacker-password" }),
    teamError("account_exists")
  );
  assert.equal(await verifyUserCredentials(email, "attacker-password"), null);
  assert.equal((await lookupInvitation(other.token))?.status, "pending", "a refused attempt does not spend the link");
  assert.equal((await lookupInvitation(other.token))?.hasAccount, true);
});

test("an account that was registered but never confirmed is claimed by the invited person", async () => {
  const email = `${unique("unconfirmed")}@example.test`;
  const squatter = await prisma.user.create({
    data: { email, fullName: "Someone else", passwordHash: "x:y", emailVerificationToken: unique("tok") }
  });
  const staleToken = await createSession(squatter.id, "");
  const { token } = await createInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, email, role: "viewer" });

  const accepted = await registerWithInvitation({ token, fullName: "Rightful", password: "rightful-password" });
  assert.equal(accepted.userId, squatter.id);
  assert.ok(await verifyUserCredentials(email, "rightful-password"));
  assert.equal(await getSessionByToken(staleToken), null, "sessions from before are ended");
});

// ─── Members ──────────────────────────────────────────────────────────────────

test("the last owner cannot be removed, downgraded or leave; with a second owner they can", async () => {
  const business = await makeBusiness("Last Owner AB");
  const [first, second] = await Promise.all([makeUser("first-owner"), makeUser("second")]);
  const firstMembership = await join(first.id, business.id, "owner");
  const secondMembership = await join(second.id, business.id, "accountant");

  for (const role of ["accountant", "viewer"]) {
    await assert.rejects(
      changeMemberRole({ businessId: business.id, actorUserId: first.id, membershipId: firstMembership.id, role }),
      teamError("last_owner")
    );
  }
  await assert.rejects(
    removeMember({ businessId: business.id, actorUserId: first.id, membershipId: firstMembership.id }),
    teamError("last_owner")
  );
  await assert.rejects(leaveBusiness({ businessId: business.id, userId: first.id }), teamError("last_owner"));
  await assert.rejects(
    changeMemberRole({ businessId: business.id, actorUserId: first.id, membershipId: firstMembership.id, role: "superuser" }),
    teamError("invalid_role")
  );
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: firstMembership.id } })).role, "owner");

  // Promote the second, then the first may step down.
  await changeMemberRole({ businessId: business.id, actorUserId: first.id, membershipId: secondMembership.id, role: "owner" });
  await changeMemberRole({ businessId: business.id, actorUserId: first.id, membershipId: firstMembership.id, role: "viewer" });
  // ...and is no longer allowed to manage anyone.
  await assert.rejects(
    changeMemberRole({ businessId: business.id, actorUserId: first.id, membershipId: secondMembership.id, role: "viewer" }),
    teamError("owner_only")
  );
  // The new sole owner is protected in turn.
  await assert.rejects(leaveBusiness({ businessId: business.id, userId: second.id }), teamError("last_owner"));

  const members = await listMembers(business.id);
  assert.deepEqual(members.map((m) => m.role).sort(), ["owner", "viewer"]);
  const actions = (await prisma.auditLog.findMany({ where: { businessId: business.id, entityType: "Membership" } })).map((a) => a.action);
  assert.deepEqual(actions, ["ROLE_CHANGE", "ROLE_CHANGE"]);
});

test("two owners demoting each other at the same moment still leave one owner", async () => {
  const business = await makeBusiness("Race AB");
  const [one, two] = await Promise.all([makeUser("race-one"), makeUser("race-two")]);
  const m1 = await join(one.id, business.id, "owner");
  const m2 = await join(two.id, business.id, "owner");

  await Promise.allSettled([
    changeMemberRole({ businessId: business.id, actorUserId: one.id, membershipId: m2.id, role: "viewer" }),
    changeMemberRole({ businessId: business.id, actorUserId: two.id, membershipId: m1.id, role: "viewer" })
  ]);
  assert.equal(await prisma.membership.count({ where: { businessId: business.id, role: "owner" } }), 1);
});

test("removing a member ends their sessions in that business at once, and only those", async () => {
  const member = await makeUser("removed");
  const membership = await join(member.id, fx.businessA, "accountant");
  await join(member.id, fx.businessB, "viewer");
  const [inA1, inA2, inB] = await Promise.all([
    createSession(member.id, fx.businessA),
    createSession(member.id, fx.businessA),
    createSession(member.id, fx.businessB)
  ]);
  assert.equal((await asRequest(inA1, "POST", "/api/receipts/manual", requireAuthContext)).businessId, fx.businessA);

  // An accountant cannot remove anyone else.
  await assert.rejects(
    removeMember({ businessId: fx.businessA, actorUserId: fx.accountant.id, membershipId: membership.id }),
    teamError("owner_only")
  );

  const result = await removeMember({ businessId: fx.businessA, actorUserId: fx.owner.id, membershipId: membership.id });
  assert.equal(result.sessionsEnded, 2);

  for (const token of [inA1, inA2]) {
    assert.equal(await getSessionByToken(token), null);
    assert.equal(await resolveAuthContext(token), null);
    await assert.rejects(asRequest(token, "GET", "/api/invoices", requireAuthContext), UnauthorizedError);
  }
  // Their access to the other business is untouched.
  const other = await asRequest(inB, "GET", "/api/invoices", requireAuthContext);
  assert.deepEqual([other.businessId, other.role], [fx.businessB, "viewer"]);

  const audit = await prisma.auditLog.findFirstOrThrow({
    where: { businessId: fx.businessA, entityType: "Membership", entityId: membership.id, action: "REMOVE" }
  });
  assert.equal(audit.userId, fx.owner.id);

  // Signing in again does not bring them back into A.
  assert.equal(await pickLoginBusinessId(member.id, fx.businessA), fx.businessB);
});

test("a role change applies to the very next request of an existing session", async () => {
  const member = await makeUser("demoted");
  const membership = await join(member.id, fx.businessA, "accountant");
  const token = await createSession(member.id, fx.businessA);
  await asRequest(token, "POST", "/api/receipts/manual", requireAuthContext);

  await changeMemberRole({ businessId: fx.businessA, actorUserId: fx.owner.id, membershipId: membership.id, role: "viewer" });
  await assert.rejects(asRequest(token, "POST", "/api/receipts/manual", requireAuthContext), forbidden("read_only"));
});

test("a non-owner can leave; someone with no business left has no context but is still a signed-in person", async () => {
  const member = await makeUser("leaver");
  await join(member.id, fx.businessA, "viewer");
  const token = await createSession(member.id, fx.businessA);

  await leaveBusiness({ businessId: fx.businessA, userId: member.id });
  assert.equal(await getSessionByToken(token), null);
  assert.equal(await pickLoginBusinessId(member.id), null);

  // What sign-in does for them: a session in no business.
  const bare = await createSession(member.id, "");
  assert.equal(await asRequest(bare, "GET", "/dashboard", getAuthContext), null);
  await assert.rejects(asRequest(bare, "GET", "/api/invoices", requireAuthContext), UnauthorizedError);
  const user = await asRequest(bare, "GET", "/login/no-access", getUserContext);
  assert.equal(user?.userId, member.id);
});

// ─── Several businesses, one person ───────────────────────────────────────────

test("switching to a business you are not a member of is refused and changes nothing", async () => {
  const session = await getSessionByToken(fx.accountant.token);
  assert.ok(session);

  for (const businessId of [fx.businessB, "", "does-not-exist"]) {
    assert.equal(await switchSessionBusiness({ sessionId: session.sessionId, userId: fx.accountant.id, businessId }), null);
  }
  assert.equal((await getSessionByToken(fx.accountant.token))?.businessId, fx.businessA);

  // Nor can you move somebody else's session, even into a business they belong to.
  assert.equal(
    await switchSessionBusiness({ sessionId: session.sessionId, userId: fx.ownerB.id, businessId: fx.businessB }),
    null
  );
  assert.equal((await getSessionByToken(fx.accountant.token))?.businessId, fx.businessA);
});

test("a person with several businesses switches between them and gets the right role in each", async () => {
  const consultant = await makeUser("consultant");
  await join(consultant.id, fx.businessA, "viewer");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await join(consultant.id, fx.businessB, "accountant");

  assert.equal(await pickLoginBusinessId(consultant.id), fx.businessA, "first membership when nothing is remembered");
  assert.equal(await pickLoginBusinessId(consultant.id, fx.businessB), fx.businessB, "the remembered one when still a member");

  const token = await createSession(consultant.id, fx.businessA);
  const session = await getSessionByToken(token);
  assert.ok(session);
  await assert.rejects(asRequest(token, "POST", "/api/receipts/manual", requireAuthContext), forbidden("read_only"));

  const switched = await switchSessionBusiness({ sessionId: session.sessionId, userId: consultant.id, businessId: fx.businessB });
  assert.deepEqual(switched, { businessId: fx.businessB, role: "accountant" });
  const ctx = await asRequest(token, "POST", "/api/receipts/manual", requireAuthContext);
  assert.deepEqual([ctx.businessId, ctx.role], [fx.businessB, "accountant"]);

  assert.equal(await pickLoginBusinessId(consultant.id), fx.businessB, "the business of the latest session is remembered");
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test("a member of business A can never obtain a context for business B", async () => {
  // 1. Whatever is asked for, the context is for the session's own business.
  for (const pathname of ["/api/invoices", `/api/businesses/${fx.businessB}`, "/api/members"]) {
    const ctx = await asRequest(fx.owner.token, "GET", pathname, requireAuthContext);
    assert.equal(ctx.businessId, fx.businessA);
  }

  // 2. A session row pointing at B for a user who is not a member of B resolves to nothing,
  //    even for someone who owns another business.
  const forged = await createSession(fx.owner.id, fx.businessB);
  assert.equal(await resolveAuthContext(forged), null);
  assert.equal(await asRequest(forged, "GET", "/api/invoices", getAuthContext), null);
  await assert.rejects(asRequest(forged, "GET", "/api/invoices", requireAuthContext), UnauthorizedError);
  await assert.rejects(asRequest(forged, "POST", "/api/invoices", requireOwner), UnauthorizedError);

  // 3. Sign-in cannot be steered into B, and the session cannot be switched there.
  assert.equal(await pickLoginBusinessId(fx.owner.id, fx.businessB), fx.businessA);
  const session = await getSessionByToken(fx.owner.token);
  assert.ok(session);
  assert.equal(await switchSessionBusiness({ sessionId: session.sessionId, userId: fx.owner.id, businessId: fx.businessB }), null);

  // 4. An owner of A cannot touch B's members or invitations by their ids.
  const memberOfB = await prisma.membership.findFirstOrThrow({ where: { businessId: fx.businessB, userId: fx.ownerB.id } });
  const inviteOfB = await createInvitation({
    businessId: fx.businessB,
    actorUserId: fx.ownerB.id,
    email: `${unique("b-invitee")}@example.test`,
    role: "viewer"
  });
  await assert.rejects(
    changeMemberRole({ businessId: fx.businessA, actorUserId: fx.owner.id, membershipId: memberOfB.id, role: "viewer" }),
    teamError("not_found")
  );
  await assert.rejects(
    removeMember({ businessId: fx.businessA, actorUserId: fx.owner.id, membershipId: memberOfB.id }),
    teamError("not_found")
  );
  await assert.rejects(
    revokeInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, invitationId: inviteOfB.invitation.id }),
    teamError("not_found")
  );
  await assert.rejects(
    resendInvitation({ businessId: fx.businessA, actorUserId: fx.owner.id, invitationId: inviteOfB.invitation.id }),
    teamError("not_found")
  );
  // ...nor act in B at all.
  await assert.rejects(
    createInvitation({ businessId: fx.businessB, actorUserId: fx.owner.id, email: "x@example.test", role: "viewer" }),
    teamError("owner_only")
  );
  await assert.rejects(
    removeMember({ businessId: fx.businessB, actorUserId: fx.owner.id, membershipId: memberOfB.id }),
    teamError("owner_only")
  );

  // 5. Lists are per business.
  const emailsA = (await listMembers(fx.businessA)).map((m) => m.userId);
  assert.equal(emailsA.includes(fx.ownerB.id), false);
  assert.equal((await listPendingInvitations(fx.businessA)).some((i) => i.id === inviteOfB.invitation.id), false);
  assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: memberOfB.id } })).role, "owner");
});
