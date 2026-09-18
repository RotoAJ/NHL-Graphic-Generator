import GoalieMatchup from "../_components/GoalieMatchup";

export const metadata = {
  title: "Goalie Matchup — RotoWire NHL Social Hub",
};

export default function GoalieMatchupPage() {
  return (
    <main className="wrap wrap-wide">
      <div className="title">
        Goalie <span className="accent">Matchup</span>
      </div>
      <div className="subtitle">
        Pick both starters — last-5-starts stats and the teams&apos; last meeting are pulled
        automatically.
      </div>
      <GoalieMatchup />
    </main>
  );
}
