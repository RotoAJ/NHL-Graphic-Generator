"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Tools in the hub. Add a row here to add a tab.
 *
 * The Goalie Matchup tool lives on the `goalie-matchup` branch, on hold until
 * the X API credentials are in place -- add { href: "/goalie-matchup",
 * label: "Goalie Matchup" } when that branch is merged.
 */
const TOOLS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Trade / Signing" },
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
