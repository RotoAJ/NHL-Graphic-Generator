// Slack delivery: posts both threads plus the six card images.
//
// A bot token is required (not just a webhook) because uploading files needs
// files.getUploadURLExternal / files.completeUploadExternal. Scopes: chat:write,
// files:write. The bot must be invited to the target channel.

const API = "https://slack.com/api";

export function slackConfigured(): boolean {
  return !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID);
}

function auth(): { token: string; channel: string } {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) throw new Error("SLACK_BOT_TOKEN / SLACK_CHANNEL_ID not set");
  return { token, channel };
}

async function call<T>(method: string, body: unknown): Promise<T> {
  const { token } = auth();
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok?: boolean; error?: string } & T;
  if (!json.ok) throw new Error(`Slack ${method} failed: ${json.error ?? res.status}`);
  return json;
}

/** Post a text message; returns the thread timestamp so files can be threaded. */
export async function postMessage(text: string): Promise<string> {
  const { channel } = auth();
  const r = await call<{ ts: string }>("chat.postMessage", {
    channel,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
  return r.ts;
}

/**
 * Upload one PNG using Slack's current external-upload flow:
 * getUploadURLExternal -> PUT the bytes -> completeUploadExternal.
 */
export async function uploadCard(
  filename: string,
  png: Buffer,
  title: string,
  threadTs?: string,
): Promise<void> {
  const { token, channel } = auth();

  // Step 1 -- reserve an upload URL. This endpoint takes form-encoded params.
  const params = new URLSearchParams({ filename, length: String(png.length) });
  const startRes = await fetch(`${API}/files.getUploadURLExternal?${params}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const start = (await startRes.json()) as {
    ok?: boolean;
    error?: string;
    upload_url: string;
    file_id: string;
  };
  if (!start.ok) {
    throw new Error(`Slack getUploadURLExternal failed: ${start.error ?? startRes.status}`);
  }

  const put = await fetch(start.upload_url, {
    method: "POST",
    body: new Uint8Array(png),
  });
  if (!put.ok) throw new Error(`Slack file upload failed: ${put.status}`);

  await call("files.completeUploadExternal", {
    files: [{ id: start.file_id, title }],
    channel_id: channel,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
}
