import NewsImport from "@/app/_components/NewsImport";

export const metadata = { title: "News snapshot — RotoWire NHL Social Hub" };

export default function NewsImportPage() {
  return (
    <main className="wrap wrap-wide">
      <div className="title">
        News <span className="accent">Snapshot</span>
      </div>
      <div className="subtitle">
        Captures the RotoWire NHL news feed so items aren&apos;t lost when a day&apos;s
        record is damaged on their side.
      </div>
      <NewsImport />
    </main>
  );
}
