import { decodeFeltString } from "./format";
import { symbolFor } from "./tokens";
import type { Campaign } from "../app/types";

// Matches a campaign against a free-text query: title, token symbol,
// organizer address, or exact campaign id. Case-insensitive.
export function matchesCampaignSearch(c: Campaign, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const title = (decodeFeltString(c.title) ?? "").toLowerCase();
  const symbol = symbolFor(c.token).toLowerCase();
  const organizer = c.organizer.toLowerCase();
  return title.includes(q) || symbol.includes(q) || organizer.includes(q) || String(c.id) === q;
}