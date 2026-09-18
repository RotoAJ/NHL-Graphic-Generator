// OAuth 1.0a request signing for the X API.
//
// X still requires OAuth 1.0a (HMAC-SHA1) for media upload, and the credentials
// we have are a user-context set: consumer key/secret plus an access token/secret
// belonging to the posting account. Node's crypto covers this, so there is no
// dependency to add.
//
// Body handling matters for correctness: form-encoded bodies must be folded into
// the signature base string, multipart and JSON bodies must NOT be. Everything
// here sends multipart or JSON, so only oauth_* params and the query string are
// ever signed.
import { createHmac, randomBytes } from "node:crypto";

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** RFC 3986 percent-encoding. encodeURIComponent leaves !*'() alone; OAuth doesn't. */
function enc(v: string): string {
  return encodeURIComponent(v).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function credentialsFromEnv(): XCredentials | null {
  const apiKey = process.env.X_NHL_API_KEY;
  const apiSecret = process.env.X_NHL_API_SECRET;
  const accessToken = process.env.X_NHL_ACCESS_TOKEN;
  const accessSecret = process.env.X_NHL_ACCESS_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

/**
 * Authorization header for one request.
 *
 * `url` may carry a query string; its parameters are signed, as OAuth requires,
 * and must not be re-appended by the caller.
 */
export function authHeader(
  method: string,
  url: string,
  creds: XCredentials,
): string {
  const u = new URL(url);
  const params: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  // Query-string params participate in the signature but not in the header.
  const signing: Record<string, string> = { ...params };
  u.searchParams.forEach((v, k) => {
    signing[k] = v;
  });

  const paramString = Object.keys(signing)
    .sort()
    .map((k) => `${enc(k)}=${enc(signing[k])}`)
    .join("&");

  const baseUrl = `${u.origin}${u.pathname}`;
  const base = [
    method.toUpperCase(),
    enc(baseUrl),
    enc(paramString),
  ].join("&");

  const key = `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");

  const header: Record<string, string> = { ...params, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${enc(k)}="${enc(header[k])}"`)
      .join(", ")
  );
}

/** Build a multipart/form-data body. Returns the body and its content type. */
export function multipart(
  fields: Array<{ name: string; value: string | Buffer; filename?: string; type?: string }>,
): { body: Buffer; contentType: string } {
  const boundary = `----rotowire${randomBytes(12).toString("hex")}`;
  const parts: Buffer[] = [];
  for (const f of fields) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) head += `; filename="${f.filename}"`;
    head += "\r\n";
    if (f.type) head += `Content-Type: ${f.type}\r\n`;
    head += "\r\n";
    parts.push(Buffer.from(head, "utf8"));
    parts.push(typeof f.value === "string" ? Buffer.from(f.value, "utf8") : f.value);
    parts.push(Buffer.from("\r\n", "utf8"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
