"use client";

import { useState } from "react";

/** Thread text with a copy button. Shared by the tool and the week permalink. */
export default function CopyBox({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="panel">
      <div className="side-title">{title}</div>
      <pre className="thread-text">{text}</pre>
      <button type="button" className="copy-btn" onClick={copy}>
        {copied ? "Copied ✓" : "Copy thread"}
      </button>
    </div>
  );
}
