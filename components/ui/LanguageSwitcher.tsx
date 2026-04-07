"use client";

type Props = { current: string };

export function LanguageSwitcher({ current }: Props) {
  function setLocale(locale: string) {
    document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }

  return (
    <div className="langSwitcher" role="group" aria-label="Language">
      <button
        className={`langBtn${current === "en" ? " langBtnActive" : ""}`}
        onClick={() => setLocale("en")}
        aria-pressed={current === "en"}
      >
        EN
      </button>
      <span className="langDivider" aria-hidden>|</span>
      <button
        className={`langBtn${current === "sv" ? " langBtnActive" : ""}`}
        onClick={() => setLocale("sv")}
        aria-pressed={current === "sv"}
      >
        SV
      </button>
    </div>
  );
}
