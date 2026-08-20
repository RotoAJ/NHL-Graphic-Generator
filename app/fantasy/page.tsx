import FantasyTool from "../_components/FantasyTool";

export const metadata = {
  title: "Fantasy Hockey — RotoWire NHL Social Hub",
};

export default function FantasyPage() {
  return (
    <main className="wrap wrap-wide">
      <div className="title">
        Fantasy <span className="accent">Hockey</span>
      </div>
      <div className="subtitle">
        Weekly Three Stars and Sleepers threads, with player cards ready to post.
      </div>
      <FantasyTool />
    </main>
  );
}
