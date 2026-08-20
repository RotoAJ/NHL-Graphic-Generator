import Link from "next/link";
import { loadWeek } from "@/src/fantasy/weeks";
import CopyBox from "@/app/_components/CopyBox";
import type { Finalist, ThreadType } from "@/src/fantasy/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return { title: `Fantasy Hockey — week ending ${date}` };
}

function CardRow({
  week,
  list,
  type,
}: {
  week: string;
  list: Finalist[];
  type: ThreadType;
}) {
  if (!list.length) return <div className="hint">No players in this set.</div>;
  return (
    <div className="card-grid">
      {list.map((p) => {
        const src = `/api/fantasy/card?week=${week}&playerId=${p.playerId}&type=${type}`;
        return (
          <div key={p.playerId} className="card-item">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${p.fullName} card`} loading="lazy" />
            <a className="download" href={src} download={`${type}-${p.lastName.toLowerCase()}.png`}>
              Download
            </a>
          </div>
        );
      })}
    </div>
  );
}

export default async function WeekPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const set = /^\d{4}-\d{2}-\d{2}$/.test(date) ? await loadWeek(date) : null;

  if (!set) {
    return (
      <main className="wrap wrap-wide">
        <div className="title">
          Week <span className="accent">not found</span>
        </div>
        <div className="subtitle">
          No saved set for <code>{date}</code>. Weeks are saved when a set is generated
          and confirmed, or by the Monday job.
        </div>
        <div className="panel" style={{ marginTop: 20 }}>
          <Link className="download" href="/fantasy">
            Back to Fantasy Hockey
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap wrap-wide">
      <div className="title">
        Week ending <span className="accent">{set.weekEnd}</span>
      </div>
      <div className="subtitle">
        Games from {set.window.from} to {set.window.to} · saved{" "}
        {String(set.createdAt).slice(0, 10)}
      </div>

      {set.warnings?.length > 0 && (
        <div className="panel warn-panel">
          <div className="side-title">Notes</div>
          <ul className="warn-list">
            {set.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="matchup-grid">
        <CopyBox title="Three Stars of the Week" text={set.threads.stars} />
        <CopyBox title="Sleepers to Grab" text={set.threads.sleepers} />
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="side-title">Three Stars — cards</div>
        <CardRow week={set.weekEnd} list={set.stars} type="stars" />
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="side-title">Sleepers — cards</div>
        <CardRow week={set.weekEnd} list={set.sleepers} type="sleepers" />
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <Link className="download" href="/fantasy">
          Back to Fantasy Hockey
        </Link>
      </div>
    </main>
  );
}
