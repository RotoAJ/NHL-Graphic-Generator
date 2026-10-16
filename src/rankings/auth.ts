// Auth for the rankings endpoints.
//
// The site-wide password gate already covers /api/rankings/*, but these routes
// change the rankings file, so each one also checks for itself rather than
// relying on the gate alone: a signed-in operator session, or the cron secret
// (which is how the scheduler calls the cron route).
import { cronAuthorized, hubAuthorized } from "@/src/x/auth";

export async function operatorOrCron(req: Request): Promise<{ ok: boolean; viaCron: boolean }> {
  // Check the session first: a browser carries a cookie and no secret.
  if (await hubAuthorized(req)) return { ok: true, viaCron: false };
  if (cronAuthorized(req)) return { ok: true, viaCron: true };
  return { ok: false, viaCron: false };
}

export const RANKINGS_FILENAME = "2026-27 Expert Rankings File.csv";

/** Errors the user can act on (bad upload, no baseline) are 400s; the rest are 500s. */
export function statusFor(message: string): number {
  return /baseline|upload|cut-off|CSV|column|header|file is empty|No player rows|Nothing to process|Still loading|already|refus|changed after/i.test(
    message,
  )
    ? 400
    : 500;
}
