/**
 * Skatteverket API client.
 *
 * Base URL and credentials are set per environment:
 *   SKV_API_BASE_URL   - e.g. https://skatteverket.entryscape.net/rowstore/dataset/...
 *                        or the production Skatteverket Open API base
 *   SKV_API_CLIENT_ID  - OAuth2 client_id issued by Skatteverket
 *   SKV_API_CLIENT_SECRET
 *   SKV_TOKEN_URL      - Token endpoint for OAuth2 client credentials flow
 *
 * All requests include a correlation ID header for auditability.
 */

import { randomUUID } from "node:crypto";

const BASE_URL = process.env.SKV_API_BASE_URL ?? "https://api.skatteverket.se";
const TOKEN_URL = process.env.SKV_TOKEN_URL ?? "https://auth.skatteverket.se/oauth2/token";
const CLIENT_ID = process.env.SKV_API_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.SKV_API_CLIENT_SECRET ?? "";

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

// ─── OAuth2 client credentials ────────────────────────────────────────────────

const fetchToken = async (): Promise<string> => {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Skatteverket API credentials not configured (SKV_API_CLIENT_ID / SKV_API_CLIENT_SECRET).");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "skatteverket:api"
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error(`Skatteverket token request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
};

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

export type SkvRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  path: string;
  body?: unknown;
  correlationId?: string;
};

export const skvRequest = async <T>(options: SkvRequestOptions): Promise<T> => {
  const token = await fetchToken();
  const correlationId = options.correlationId ?? randomUUID();

  const url = `${BASE_URL}${options.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Correlation-ID": correlationId
  };

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Skatteverket API error ${response.status} at ${options.path}: ${text}`);
  }

  return response.json() as Promise<T>;
};
