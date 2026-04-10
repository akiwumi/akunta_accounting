"use client";

import { useEffect, useRef, useState } from "react";
import { useUserPreferences } from "@/components/providers/UserPreferencesProvider";

type Props = { text: string };

export function HintTip({ text }: Props) {
  const { hintsEnabled } = useUserPreferences();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (!hintsEnabled) return null;

  return (
    <div className="hintTip" ref={ref}>
      <button
        type="button"
        className="hintTipTrigger"
        aria-label="Show hint"
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open && (
        <div className="hintTipPopover" role="tooltip">
          {text}
        </div>
      )}
    </div>
  );
}
