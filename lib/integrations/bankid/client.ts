/**
 * BankID REST API v6 client (Sweden).
 *
 * Requires mTLS: the Relying Party must supply a client certificate issued by
 * the BankID CA. Set BANKID_CERT_P12_BASE64 (base64-encoded PKCS#12),
 * BANKID_CERT_PASSPHRASE, and optionally BANKID_CA_CERT_BASE64 (base64-encoded
 * PEM CA bundle from BankID). Set BANKID_ENV=production or leave unset for
 * the test environment.
 *
 * API reference: https://www.bankid.com/en/utvecklare/guider/teknisk-integrationsguide
 */

import https from "node:https";

const BANKID_HOST =
  process.env.BANKID_ENV === "production"
    ? "appapi2.bankid.com"
    : "appapi2.test.bankid.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BankIdAuthResponse {
  orderRef: string;
  autoStartToken: string;
  qrStartToken: string;
  qrStartSecret: string;
}

export interface BankIdCollectResponse {
  orderRef: string;
  status: "pending" | "complete" | "failed";
  hintCode?: string;
  completionData?: {
    user: {
      personalNumber: string;
      name: string;
      givenName: string;
      surname: string;
    };
    device: { ipAddress: string; uhi?: string };
    bankIdIssueDate: string;
    signature: string;
    ocspResponse: string;
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function buildAgent(): https.Agent {
  const p12 = process.env.BANKID_CERT_P12_BASE64;
  const passphrase = process.env.BANKID_CERT_PASSPHRASE;
  if (!p12 || !passphrase) {
    throw new Error(
      "BankID is not configured: set BANKID_CERT_P12_BASE64 and BANKID_CERT_PASSPHRASE."
    );
  }
  const options: https.AgentOptions = {
    pfx: Buffer.from(p12, "base64"),
    passphrase,
    rejectUnauthorized: process.env.BANKID_ENV === "production",
  };
  const ca = process.env.BANKID_CA_CERT_BASE64;
  if (ca) options.ca = Buffer.from(ca, "base64");
  return new https.Agent(options);
}

function request<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    let agent: https.Agent;
    try {
      agent = buildAgent();
    } catch (err) {
      reject(err);
      return;
    }

    const payload = JSON.stringify(body);
    const options: https.RequestOptions = {
      hostname: BANKID_HOST,
      path: `/rp/v6.0${path}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      agent,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(
            new Error(
              `BankID API error ${res.statusCode}: ${data}`
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(data) as T);
        } catch {
          reject(new Error("BankID returned invalid JSON"));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initiate a BankID authentication order.
 * @param endUserIp  IPv4/IPv6 address of the end user (required by BankID).
 * @param personalNumber  Optional: pre-fill the personal number.
 */
export function bankIdAuth(
  endUserIp: string,
  personalNumber?: string
): Promise<BankIdAuthResponse> {
  return request<BankIdAuthResponse>("/auth", {
    endUserIp,
    ...(personalNumber
      ? { requirement: { personalNumber } }
      : {}),
  });
}

/**
 * Collect the result of a BankID order.
 * Poll every 2 seconds until status is "complete" or "failed".
 */
export function bankIdCollect(
  orderRef: string
): Promise<BankIdCollectResponse> {
  return request<BankIdCollectResponse>("/collect", { orderRef });
}

/**
 * Cancel a pending BankID order.
 */
export function bankIdCancel(orderRef: string): Promise<void> {
  return request<void>("/cancel", { orderRef });
}
