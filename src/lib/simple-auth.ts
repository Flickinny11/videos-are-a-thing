export const SIMPLE_AUTH_COOKIE = "media-studio-auth";
export const SIMPLE_AUTH_EMAIL = "Logantbaird@gmail.com";
export const SIMPLE_AUTH_PASSWORD = "Kilkinny!982";
export const SIMPLE_AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";

const encode = (value: string) =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const decode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
};

export const createSimpleAuthToken = () =>
  encode(JSON.stringify({ sub: SIMPLE_AUTH_USER_ID, email: SIMPLE_AUTH_EMAIL }));

export const verifySimpleAuthToken = (token?: string | null) => {
  if (!token) return null;

  try {
    const parsed = JSON.parse(decode(token)) as { sub?: string; email?: string };
    if (parsed.sub !== SIMPLE_AUTH_USER_ID || parsed.email !== SIMPLE_AUTH_EMAIL) return null;
    return { id: parsed.sub, email: parsed.email };
  } catch {
    return null;
  }
};

export const isSimpleAuthCredential = (email: string, password: string) =>
  email.toLowerCase() === SIMPLE_AUTH_EMAIL.toLowerCase() && password === SIMPLE_AUTH_PASSWORD;
