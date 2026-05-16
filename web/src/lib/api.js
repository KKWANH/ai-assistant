export function apiPath(path) {
  return path;
}

export async function fetchJson(path, options) {
  const response = await fetch(apiPath(path), {
    headers: { Accept: "application/json", ...csrfHeader(), ...(options?.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let payload = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 240) || `Request returned non-JSON response (${response.status}).`);
    }
  }
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

export function csrfHeader() {
  const token = getCookie("aiws_csrf");
  return token ? { "X-CSRF-Token": decodeURIComponent(token) } : {};
}

export function getCookie(name) {
  return document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`))
    ?.split("=")[1];
}

export function setCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
