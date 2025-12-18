type AuthApiError = { message: string; status?: number };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export type AuthSessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
};

// Use XMLHttpRequest to bypass potential fetch header validation issues
function xhrPost(url: string, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("apikey", SUPABASE_ANON);
    xhr.setRequestHeader("Authorization", "Bearer " + SUPABASE_ANON);
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        resolve({ status: xhr.status, text: xhr.responseText });
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(body);
  });
}

export async function signUpWithApi(params: {
  email: string;
  password: string;
}): Promise<{ data: { user?: { id: string; email?: string } } | null; error: AuthApiError | null }> {
  try {
    const { status, text } = await xhrPost(
      `${SUPABASE_URL}/auth/v1/signup`,
      JSON.stringify({ email: params.email, password: params.password })
    );

    const json = text ? JSON.parse(text) : {};

    if (status < 200 || status >= 300) {
      return {
        data: null,
        error: { message: json?.msg || json?.message || json?.error_description || "Signup failed", status },
      };
    }

    return {
      data: { user: json?.user ?? json },
      error: null,
    };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

export async function signInWithPasswordApi(params: {
  email: string;
  password: string;
}): Promise<{ data: AuthSessionPayload | null; error: AuthApiError | null }> {
  try {
    const { status, text } = await xhrPost(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      JSON.stringify({ email: params.email, password: params.password })
    );

    const json = text ? JSON.parse(text) : {};

    if (status < 200 || status >= 300) {
      return {
        data: null,
        error: { message: json?.error_description || json?.msg || json?.message || "Login failed", status },
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

