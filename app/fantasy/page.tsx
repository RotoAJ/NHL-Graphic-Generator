import Link from "next/link";
import FantasyTool from "../_components/FantasyTool";
import { listWeeks } from "@/src/fantasy/weeks";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Fantasy Hockey — RotoWire NHL Social Hub",
};

export default async function FantasyPage() {
  let weeks: Awaited<ReturnType<typeof listWeeks>> = [];
  try {
    weeks = await listWeeks(10);
  } catch {
    // A missing/unreachable store shouldn't block the tool itself.
  }

  return (
    <main className="wrap wrap-wide">
      <div className="title">
        Fantasy <span className="accent">Hockey</span>
      </div>
      <div className="subtitle">
        Weekly Three Stars and Sleepers threads, with player cards ready to post.
      </div>
      <FantasyTool />

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="side-title">Saved weeks</div>
        {weeks.length === 0 ? (
          <div className="hint">
            No weeks saved yet. Generate a set and hit “Confirm set” to create a permalink —
            the Monday job saves one automatically.
          </div>
        ) : (
          <ul className="week-list">
            {weeks.map((w) => (
              <li key={w.weekEnd}>
                <Link href={`/fantasy/week/${w.weekEnd}`}>Week ending {w.weekEnd}</Link>
                <span className="meta">
                  {w.starCount} stars · {w.sleeperCount} sleepers
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
