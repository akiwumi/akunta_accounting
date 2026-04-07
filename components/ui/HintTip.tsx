"use client";

import { useEffect, useRef, useState } from "react";

type Props = { text: string };

/** Returns true if the hints cookie is not explicitly "off". Defaults to on. */
function hintsEnabled(): boolean {
  if (typeof document === "undefined") return true;
  return !document.cookie.split(";").some((c) => c.trim() === "hints=off");
}

export function HintTip({ text }: Props) {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Read cookie on mount (client-only)
  useEffect(() => { setShow(hintsEnabled()); }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (!show) return null;

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
