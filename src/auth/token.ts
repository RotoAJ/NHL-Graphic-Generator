// Session token helpers shared by the middleware (Edge) and the API routes
// (Node). Uses Web Crypto, which is available in both runtimes.
//
// One copy on purpose: an earlier version defined these twice and the second
// module referenced a name it never imported, which typechecked as an error and
// would have thrown at runtime.

export const AUTH_COOKIE = "hub_auth";

/** Derived token stored in the cookie -- never the password itself. */
export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${password}|rotowire-nhl-hub|v1`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Fixed-length comparison so a wrong value can't be probed by timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Read and validate the hub cookie from a raw Cookie header. */
export async function cookieValid(
  cookieHeader: string | null,
  password: string,
): Promise<boolean> {
  const match = (cookieHeader ?? "").match(
    new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]+)`),
  );
  if (!match) return false;
  return safeEqual(decodeURIComponent(match[1]), await tokenFor(password));
}
