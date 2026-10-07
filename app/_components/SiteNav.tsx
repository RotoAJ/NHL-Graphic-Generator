"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tools in the hub. Add a row here to add a tab. */
const TOOLS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Trade / Signing" },
  { href: "/fantasy", label: "Fantasy Hockey" },
  { href: "/goalie-matchup", label: "Goalie Matchup" },
  // Not a generator like the others -- it's the status page for the news feed
  // capture, which is why it reads as a check rather than a tool.
  { href: "/news-import", label: "News Feed" },
];

export default function SiteNav() {
  const pathname = usePathname();
  // The sign-in screen shows no tool tabs: they are all gated, so every link
  // would just bounce back here.
  if (pathname === "/login") return null;
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <span className="site-brand">
          <span className="accent">RotoWire</span> NHL Social Hub
        </span>
        <nav className="site-tabs">
          {TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`site-tab${pathname === t.href ? " active" : ""}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
