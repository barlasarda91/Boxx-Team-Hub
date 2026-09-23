import { useState, useEffect } from "react";
import { api } from "./api.js";

// Active roster from the server — the users table is the source of truth, so
// hiring or deactivating someone in Settings updates every picker. The
// fallback only covers the moment before the fetch lands.
const FALLBACK = ["Alex", "Amin", "Ben", "Brandon", "Manny", "Travis", "Vicky"];

export function useRoster() {
  const [roster, setRoster] = useState({ members: FALLBACK, all: [...FALLBACK, "Owner"] });
  useEffect(() => {
    api.get("/api/roster").then(r => setRoster(r)).catch(() => {});
  }, []);
  return roster;
}
