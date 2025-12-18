type AuthApiError = { message: string; status?: number };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const authHeaders = () => ({
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  "Content-Type": "application/json",
  // Force ASCII-only client info to avoid non-Latin1 header issues
  "X-Client-Info": "web-auth",
});

export type AuthSessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
};

export async function signUpWithApi(params: {
  email: string;
  password: string;
}): Promise<{ data: { user?: { id: string; email?: string } } | null; error: AuthApiError | null }>{
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        email: params.email,
        password: params.password,
      }),
    });

    const json = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      return {
        data: null,
        error: { message: json?.msg || json?.message || "Signup failed", status: res.status },
      };
    }

    return {
      data: { user: json?.user ?? undefined },
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

export async function signInWithPasswordApi(params: {
  email: string;
  password: string;
}): Promise<{ data: AuthSessionPayload | null; error: AuthApiError | null }>{
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        email: params.email,
        password: params.password,
      }),
    });

    const json = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      return {
        data: null,
        error: { message: json?.error_description || json?.msg || json?.message || "Login failed", status: res.status },
      };
    }

    return {
      data: {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_in: json.expires_in,
        token_type: json.token_type,
      },
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}
