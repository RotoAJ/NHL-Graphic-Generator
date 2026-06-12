import Generator from "./_components/Generator";

export default function Home() {
  return (
    <main className="wrap">
      <div className="title">
        <span className="accent">RotoWire</span> NHL Graphic Generator
      </div>
      <div className="subtitle">
        Search a player, set old &rarr; new team, add deal details, download.
      </div>
      <Generator />
    </main>
  );
}
