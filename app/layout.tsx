import type { Metadata } from "next";
import SiteNav from "./_components/SiteNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "RotoWire NHL Social Hub",
  description: "Branded NHL social graphics: trades/signings and goalie matchups.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
