// Read-only check that the X credentials work and point at the right account.
//
// Reports presence and the resolved handle. It never returns secret values, and
// it never posts -- it exists so the credentials can be verified before the
// poller is trusted to publish unattended.
import { NextResponse } from "next/server";
import { hasDatabase, recentPosts } from "@/src/goalies/posted";
import { postingEnabled, verifyCredentials, xConfigured } from "@/src/x/client";

export const runtime = "nodejs";

export async function GET() {
  const configured = xConfigured();
  const expected = (process.env.X_NHL_EXPECTED_HANDLE ?? "").replace(/^@/, "") || null;

  let account: string | null = null;
  let accountId: string | null = null;
  let error: string | null = null;
  if (configured) {
    try {
      const a = await verifyCredentials();
      account = a.username;
      accountId = a.id;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  const matchesExpected =
    expected && account ? account.toLowerCase() === expected.toLowerCase() : null;

  let recent: Awaited<ReturnType<typeof recentPosts>> = [];
  if (hasDatabase()) {
    try {
      recent = await recentPosts(10);
    } catch {
      /* audit list is a nicety */
    }
  }

  return NextResponse.json({
    credentialsPresent: configured,
    postingEnabled: postingEnabled(),
    account: account ? `@${account}` : null,
    accountId,
    expectedHandle: expected ? `@${expected}` : null,
    matchesExpected,
    dedupeAvailable: hasDatabase(),
    error,
    recentPosts: recent,
  });
}
