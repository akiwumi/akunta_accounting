"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type UserPreferences = {
  hintsEnabled: boolean;
  setHintsEnabled: (value: boolean) => Promise<void>;
};

export const UserPreferencesContext = createContext<UserPreferences>({
  hintsEnabled: true,
  setHintsEnabled: async () => {}
});

export function useUserPreferences() {
  return useContext(UserPreferencesContext);
}

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const [hintsEnabled, setHintsEnabledState] = useState(true);

  // Load preferences from DB on mount
  useEffect(() => {
    fetch("/api/user/preferences")
      .then((r) => r.json())
      .then((data: { hintsEnabled?: boolean }) => {
        if (typeof data.hintsEnabled === "boolean") {
          setHintsEnabledState(data.hintsEnabled);
        }
      })
      .catch(() => {});
  }, []);

  // Optimistically update state and persist to DB
  const setHintsEnabled = useCallback(async (value: boolean) => {
    setHintsEnabledState(value); // optimistic
    await fetch("/api/user/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hintsEnabled: value })
    });
  }, []);

  return (
    <UserPreferencesContext.Provider value={{ hintsEnabled, setHintsEnabled }}>
      {children}
    </UserPreferencesContext.Provider>
  );
}
