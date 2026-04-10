import nodemailer from "nodemailer";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string;
  pass: string;
  from: string;
};

type SmtpConfigResult =
  | {
      ok: true;
      config: SmtpConfig;
    }
  | {
      ok: false;
      error: string;
      missing: string[];
    };

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseBoolean(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return value === "true";
}

export function getSmtpConfig(): SmtpConfigResult {
  const host = readEnv("SMTP_HOST");
  const user = readEnv("SMTP_USER");
  const pass = process.env.SMTP_PASS;
  const missing = [!host && "SMTP_HOST", !user && "SMTP_USER", !pass && "SMTP_PASS"].filter(Boolean) as string[];

  if (missing.length > 0) {
    return {
      ok: false,
      error: `SMTP is not configured. Missing: ${missing.join(", ")}.`,
      missing
    };
  }

  const portValue = readEnv("SMTP_PORT") ?? "587";
  const port = Number.parseInt(portValue, 10);
  if (!Number.isFinite(port) || port <= 0) {
    return {
      ok: false,
      error: "SMTP is not configured. SMTP_PORT must be a positive integer.",
      missing: []
    };
  }

  const secure = parseBoolean(readEnv("SMTP_SECURE")) ?? port === 465;
  const requireTLS = parseBoolean(readEnv("SMTP_REQUIRE_TLS")) ?? (!secure && port === 587);
  const from = readEnv("EMAIL_FROM") ?? readEnv("SMTP_FROM") ?? `Akunta <${user}>`;

  return {
    ok: true,
    config: {
      host: host as string,
      port,
      secure,
      requireTLS,
      user: user as string,
      pass: pass as string,
      from
    }
  };
}

export function createSmtpTransport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    // Fail fast in serverless — keep well under Vercel's function timeout
    connectionTimeout: 6_000,
    greetingTimeout: 6_000,
    socketTimeout: 12_000,
    // Strato's certificate chain fails peer validation from AWS/cloud IPs
    tls: { rejectUnauthorized: false },
    auth: {
      // Strato requires LOGIN auth; negotiation can fail from cloud IPs
      type: "LOGIN",
      user: config.user,
      pass: config.pass
    }
  });
}

export function getDefaultEmailFromAddress(preferredFrom?: string) {
  const trimmedPreferred = preferredFrom?.trim();
  if (trimmedPreferred) {
    return trimmedPreferred;
  }

  const smtp = getSmtpConfig();
  if (smtp.ok) {
    return smtp.config.from;
  }

  return "Akunta <noreply@akunta.se>";
}
