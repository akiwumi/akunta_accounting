import { createClient } from "@supabase/supabase-js";

type SupabaseConfirmationInput = {
  email: string;
  fullName: string;
  password: string;
};

function getSupabaseAuthConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      "Supabase email auth requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)."
    );
  }

  return { url, key };
}

function createSupabaseAuthClient() {
  const { url, key } = getSupabaseAuthConfig();

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}

export function getAuthEmailProvider(): "smtp" | "supabase" {
  return process.env.AUTH_EMAIL_PROVIDER === "supabase" ? "supabase" : "smtp";
}

export function getSupabaseEmailRedirectTo() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${appUrl}/welcome?confirm=1`;
}

export async function sendSupabaseConfirmationEmail({
  email,
  fullName,
  password
}: SupabaseConfirmationInput) {
  const supabase = createSupabaseAuthClient();
  const emailRedirectTo = getSupabaseEmailRedirectTo();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
      data: { fullName }
    }
  });

  if (!error) {
    return;
  }

  const { error: resendError } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo }
  });

  if (resendError) {
    throw resendError;
  }
}

export async function getSupabaseUserForAccessToken(accessToken: string) {
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error) {
    throw error;
  }

  return data.user;
}
