// X API client: verify the account, upload a PNG, create a post.
//
// This posts publicly to a RotoWire brand account with no human review, so the
// safety here is deliberate rather than incidental:
//   - X_POSTING_ENABLED must be "1". Anything else is treated as a dry run, so
//     posting can be stopped from the Vercel dashboard without a redeploy.
//   - X_NHL_EXPECTED_HANDLE, when set, is checked against the account the token
//     actually resolves to, so a swapped credential can't post to the wrong
//     place.
import { authHeader, credentialsFromEnv, multipart, type XCredentials } from "@/src/x/oauth1";

const API = "https://api.x.com";
/** v1.1 upload host, used only if the v2 media endpoint is unavailable. */
const UPLOAD_V1 = "https://upload.twitter.com/1.1/media/upload.json";

export function xConfigured(): boolean {
  return credentialsFromEnv() !== null;
}

/** Posting is opt-in: any value other than "1" means dry run. */
export function postingEnabled(): boolean {
  return process.env.X_POSTING_ENABLED === "1";
}

export interface XAccount {
  id: string;
  username: string;
}

/** Which account do these credentials belong to? */
export async function verifyCredentials(
  creds: XCredentials = credentialsFromEnv() as XCredentials,
): Promise<XAccount> {
  const url = `${API}/2/users/me`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader("GET", url, creds) },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`verifyCredentials ${res.status}: ${text.slice(0, 300)}`);
  const j = JSON.parse(text) as { data?: { id?: string; username?: string } };
  if (!j.data?.id) throw new Error(`verifyCredentials: unexpected body ${text.slice(0, 200)}`);
  return { id: j.data.id, username: j.data.username ?? "" };
}

/**
 * Confirm the token belongs to the intended account.
 * Returns the account either way; throws only on an explicit mismatch.
 */
export async function assertExpectedAccount(): Promise<XAccount> {
  const account = await verifyCredentials();
  const expected = (process.env.X_NHL_EXPECTED_HANDLE ?? "").replace(/^@/, "").trim();
  if (expected && account.username.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `Refusing to post: credentials resolve to @${account.username} but ` +
        `X_NHL_EXPECTED_HANDLE is @${expected}.`,
    );
  }
  return account;
}

/** Upload a PNG and return its media id. */
export async function uploadMedia(png: Buffer, creds: XCredentials): Promise<string> {
  const attempt = async (url: string) => {
    const { body, contentType } = multipart([
      { name: "media", value: png, filename: "matchup.png", type: "image/png" },
    ]);
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: authHeader("POST", url, creds), "Content-Type": contentType },
      body: new Uint8Array(body),
      cache: "no-store",
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  };

  // v2 is current; v1.1 is the documented fallback while the migration settles.
  let r = await attempt(`${API}/2/media/upload`);
  if (!r.ok && (r.status === 403 || r.status === 404 || r.status === 410)) {
    r = await attempt(UPLOAD_V1);
  }
  if (!r.ok) throw new Error(`uploadMedia ${r.status}: ${r.text.slice(0, 300)}`);

  const j = JSON.parse(r.text) as {
    data?: { id?: string };
    media_id_string?: string;
    id?: string;
  };
  const id = j.data?.id ?? j.media_id_string ?? j.id;
  if (!id) throw new Error(`uploadMedia: no media id in ${r.text.slice(0, 200)}`);
  return String(id);
}

export interface PostResult {
  /** null when posting was disabled, i.e. a dry run. */
  tweetId: string | null;
  dryRun: boolean;
  account: string;
}

/**
 * Post `text` with one image. Respects the kill switch: when posting is
 * disabled everything up to the final call still runs (credentials, media
 * upload is skipped) so a dry run exercises the real code path.
 */
export async function postWithImage(text: string, png: Buffer): Promise<PostResult> {
  const creds = credentialsFromEnv();
  if (!creds) throw new Error("X credentials are not configured");

  const account = await assertExpectedAccount();

  if (!postingEnabled()) {
    return { tweetId: null, dryRun: true, account: account.username };
  }

  const mediaId = await uploadMedia(png, creds);
  const url = `${API}/2/tweets`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader("POST", url, creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`createPost ${res.status}: ${body.slice(0, 300)}`);
  const j = JSON.parse(body) as { data?: { id?: string } };
  if (!j.data?.id) throw new Error(`createPost: no id in ${body.slice(0, 200)}`);
  return { tweetId: j.data.id, dryRun: false, account: account.username };
}
