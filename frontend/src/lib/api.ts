const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function apiFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);

  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  const requestUrl = `${API_URL}${path}`;

  return fetch(requestUrl, {
    ...options,
    credentials: "include",
    mode: "cors",
    headers,
    cache: "no-store",
  });
}
