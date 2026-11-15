"use client";

import { useId, useMemo, useState, type KeyboardEvent, type Ref } from "react";

import { type PickerAccount } from "@/components/journal/shared";

type AccountPickerProps = {
  accounts: PickerAccount[];
  /** Selected account id, or "" when none. */
  value: string;
  onChange: (accountId: string) => void;
  ariaLabel: string;
  placeholder: string;
  noMatch: string;
  inputRef?: Ref<HTMLInputElement>;
};

const MAX_OPTIONS = 40;

const labelOf = (account: PickerAccount) => `${account.code} ${account.name}`;

/**
 * Account picker with search by number or name.
 *
 * Keyboard: type to search, arrow keys to move, Enter or Tab to choose,
 * Escape to close. Typing a full account number and pressing Tab is enough.
 */
export const AccountPicker = ({ accounts, value, onChange, ariaLabel, placeholder, noMatch, inputRef }: AccountPickerProps) => {
  const listId = useId();
  const selected = accounts.find((account) => account.id === value) ?? null;
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const needle = (query ?? "").trim().toLowerCase();
    if (!needle) return accounts.slice(0, MAX_OPTIONS);
    const byCode = accounts.filter((account) => account.code.startsWith(needle));
    const byName = accounts.filter(
      (account) => !account.code.startsWith(needle) && labelOf(account).toLowerCase().includes(needle)
    );
    return [...byCode, ...byName].slice(0, MAX_OPTIONS);
  }, [accounts, query]);

  const choose = (account: PickerAccount) => {
    onChange(account.id);
    setQuery(null);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (open && matches[active]) {
        event.preventDefault();
        event.stopPropagation();
        choose(matches[active]);
      }
    } else if (event.key === "Tab") {
      if (open && query !== null && query.trim() !== "" && matches[active]) choose(matches[active]);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setQuery(null);
        setOpen(false);
      }
    }
  };

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={query ?? (selected ? labelOf(selected) : "")}
        style={{ width: "100%" }}
        onFocus={(event) => {
          event.target.select();
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          setQuery(null);
          setOpen(false);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
          if (event.target.value.trim() === "" && value) onChange("");
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: "100%",
            width: "max-content",
            maxWidth: "min(480px, 90vw)",
            maxHeight: 280,
            overflowY: "auto",
            margin: 0,
            padding: 6,
            listStyle: "none",
            borderRadius: 12,
            background: "var(--surface-lowest)",
            outline: "1px solid var(--border-strong)",
            boxShadow: "0 38px 56px var(--ambient-shadow)"
          }}
        >
          {matches.length === 0 ? (
            <li className="note" style={{ padding: "8px 10px" }}>{noMatch}</li>
          ) : (
            matches.map((account, index) => (
              <li
                key={account.id}
                id={`${listId}-${account.id}`}
                role="option"
                aria-selected={index === active}
                // Keep focus in the input so the choice is made before blur closes the list.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(account);
                }}
                onMouseEnter={() => setActive(index)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  background: index === active ? "var(--surface-container-low)" : "transparent"
                }}
              >
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 620 }}>{account.code}</span> {account.name}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
};
