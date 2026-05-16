export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function apiPath(path: string): string {
  return path;
}

export async function fetchJson<T = JsonObject>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), {
    headers: { Accept: "application/json", ...csrfHeader(), ...(options?.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let payload: JsonObject = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as JsonObject;
    } catch {
      throw new Error(text.slice(0, 240) || `Request returned non-JSON response (${response.status}).`);
    }
  }
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Request failed.");
  return payload as T;
}

export function csrfHeader(): Record<string, string> {
  const token = getCookie("aiws_csrf");
  return token ? { "X-CSRF-Token": decodeURIComponent(token) } : {};
}

export function getCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`))
    ?.split("=")[1];
}

export function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
