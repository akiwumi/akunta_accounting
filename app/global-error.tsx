"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "system-ui, sans-serif",
          background: "#faf9f6",
          color: "#202628",
          gap: "16px",
          padding: "24px",
          textAlign: "center"
        }}
      >
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Something went wrong</h1>
        <p style={{ color: "#667376", maxWidth: "400px", margin: 0 }}>
          An unexpected error occurred. Our team has been notified. Please try again.
        </p>
        <button
          onClick={reset}
          style={{
            padding: "10px 24px",
            background: "#364244",
            color: "#fffaf4",
            border: "none",
            borderRadius: "999px",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: "15px"
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
