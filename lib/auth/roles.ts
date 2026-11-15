// Roles and the access policy. Edge-safe: no Node.js built-ins and no imports,
// so the proxy and the route handlers decide from the same table.

export const Roles = {
  OWNER: "owner",
  ACCOUNTANT: "accountant",
  VIEWER: "viewer"
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

export const ALL_ROLES: readonly Role[] = [Roles.OWNER, Roles.ACCOUNTANT, Roles.VIEWER];
/** Roles that can be handed out through an invitation. Ownership is granted by an owner afterwards. */
export const INVITABLE_ROLES = [Roles.ACCOUNTANT, Roles.VIEWER] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** A role we do not recognise gets the least rights, never the most. */
export const normalizeRole = (value: string | null | undefined): Role =>
  value === Roles.OWNER || value === Roles.ACCOUNTANT || value === Roles.VIEWER ? value : Roles.VIEWER;

export const isRole = (value: unknown): value is Role =>
  value === Roles.OWNER || value === Roles.ACCOUNTANT || value === Roles.VIEWER;

export const canWrite = (role: Role) => role === Roles.OWNER || role === Roles.ACCOUNTANT;
export const isOwnerRole = (role: Role) => role === Roles.OWNER;

export const isReadMethod = (method: string | null | undefined) => {
  const upper = method?.toUpperCase();
  return upper === "GET" || upper === "HEAD";
};

/**
 * Non-GET requests a read-only member may still make. Each one changes only
 * the person's own account or session, never the books. Exact paths only.
 */
export const VIEWER_WRITE_ALLOWLIST: readonly string[] = [
  "/api/auth/logout",
  "/api/auth/change-password",
  "/api/locale",
  "/api/session/switch",
  "/api/user/preferences",
  "/api/invitations/accept",
  "/api/members/leave"
];

/**
 * Non-GET requests only an owner may make: members, invitations, billing and
 * the legal identity of the business. Prefix match on whole path segments.
 * The handlers under /api/members, /api/invitations and /api/billing also call
 * requireOwner() themselves; this table is what covers the others.
 */
export const OWNER_ONLY_WRITE_PREFIXES: readonly string[] = [
  "/api/members",
  "/api/invitations",
  "/api/billing",
  "/api/onboarding/country",
  "/api/tax/profiles/apply"
];
/** Owner-only on the exact path, so sub-routes such as the receipt inbox stay with the accountant. */
export const OWNER_ONLY_WRITE_EXACT: readonly string[] = ["/api/settings"];

/** Carved out of the owner-only prefixes: things a member does for themselves. */
const OWNER_ONLY_EXCEPTIONS: readonly string[] = [
  "/api/invitations/accept",
  "/api/members/leave",
  "/api/billing/webhook"
];

const underPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

const stripTrailingSlash = (pathname: string) =>
  pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

export const isOwnerOnlyWritePath = (rawPathname: string) => {
  const pathname = stripTrailingSlash(rawPathname);
  if (OWNER_ONLY_EXCEPTIONS.includes(pathname)) return false;
  if (OWNER_ONLY_WRITE_EXACT.includes(pathname)) return true;
  return OWNER_ONLY_WRITE_PREFIXES.some((prefix) => underPrefix(pathname, prefix));
};

export type AccessDenial = "read_only" | "owner_only" | "unverified";

/**
 * The one access decision. `method` and `pathname` are null when the request
 * did not come through the proxy (or its signature did not verify); in that
 * case only an owner, who has every right anyway, is let through.
 */
export const checkAccess = (
  role: Role,
  method: string | null | undefined,
  rawPathname: string | null | undefined
): AccessDenial | null => {
  if (role === Roles.OWNER) return null;

  const pathname = rawPathname ? stripTrailingSlash(rawPathname) : null;
  const read = isReadMethod(method);

  if (role === Roles.ACCOUNTANT) {
    if (read) return null;
    if (!method || !pathname) return "unverified";
    return isOwnerOnlyWritePath(pathname) ? "owner_only" : null;
  }

  // Viewer, and anything unrecognised.
  if (read) return null;
  if (pathname && VIEWER_WRITE_ALLOWLIST.includes(pathname)) return null;
  return "read_only";
};

export const denialMessage = (denial: AccessDenial, locale: string | null | undefined) => {
  const sv = locale === "sv";
  if (denial === "read_only") {
    return sv
      ? "Du har läsbehörighet. Du kan se och ladda ner allt, men inte ändra något."
      : "You have read-only access. You can view and download everything, but not change anything.";
  }
  if (denial === "owner_only") {
    return sv ? "Det här kan bara företagets ägare göra." : "Only the owner of the business can do this.";
  }
  return sv ? "Begäran kunde inte verifieras. Ladda om sidan och försök igen." : "The request could not be verified. Reload the page and try again.";
};

/** Response header that tells the app shell why a request was refused. */
export const ACCESS_DENIED_HEADER = "x-akunta-denied";
