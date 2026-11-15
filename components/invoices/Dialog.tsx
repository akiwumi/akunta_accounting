"use client";

import { useEffect, useRef } from "react";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

/** A modal built on the native dialog element: focus is trapped and Escape closes it. */
export const Dialog = ({ open, onClose, title, children }: DialogProps) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="card"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      style={{ border: "none", width: "min(540px, calc(100vw - 32px))", padding: 24, transform: "none", color: "inherit" }}
    >
      {open && (
        <div className="stack">
          <h2 style={{ margin: 0 }}>{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
};
