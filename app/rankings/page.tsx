import RankingsTool from "@/app/_components/RankingsTool";

export const metadata = { title: "Rankings — RotoWire NHL Social Hub" };

export default function RankingsPage() {
  return (
    <main className="wrap wrap-wide">
      <div className="title">
        Fantasy <span className="accent">Rankings</span>
      </div>
      <div className="subtitle">
        The Mon / Wed / Fri rankings update: injuries, production since the last run, and new players.
        Every run is previewed first and kept, so it can be rolled back.
      </div>
      <RankingsTool />
    </main>
  );
}
