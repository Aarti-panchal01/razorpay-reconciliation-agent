import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { persistRun, listRecentRuns } from "@/lib/persist-run";
import { generateFixture } from "@/data/generator";
import { matchBatch } from "@/engine/match";

const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  if (savedUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
  if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
});

describe("persistRun — persistence is optional, never load-bearing", () => {
  it("no-ops silently when Supabase isn't configured, rather than throwing", async () => {
    const fixture = generateFixture({ seed: 1, orderCount: 20 });
    const batch = {
      settlements: fixture.settlements,
      bankEntries: fixture.bankEntries,
      ledgerEntries: fixture.ledgerEntries,
    };
    const naiveReport = matchBatch(batch, { naiveTdsHandling: true });
    const currentReport = matchBatch(batch);

    await expect(
      persistRun({ seed: 1, orderCount: 20, usedResolver: false, naiveReport, currentReport })
    ).resolves.toBeUndefined();
  });
});

describe("listRecentRuns — degrades to an empty list, not an error", () => {
  it("returns an empty array when Supabase isn't configured", async () => {
    const runs = await listRecentRuns();
    expect(runs).toEqual([]);
  });
});
