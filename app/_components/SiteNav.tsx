"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tools in the hub. Add a row here to add a tab. */
const TOOLS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Trade / Signing" },
  { href: "/goalie-matchup", label: "Goalie Matchup" },
];

export default function SiteNav() {
  const pathname = usePathname();
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
