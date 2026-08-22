import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mocked at the module level — no network, no API key, no credits needed.
// This is what actually closes the coverage gap the fail-closed tests leave
// open: resolve-batch.test.ts proves the "no key" path degrades safely, but
// says nothing about whether a real model response gets parsed correctly.
// That's exactly what this file covers instead.
const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

const savedKey = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key-not-real";
  createMock.mockReset();
});

afterEach(() => {
  if (savedKey) process.env.OPENROUTER_API_KEY = savedKey;
  else delete process.env.OPENROUTER_API_KEY;
});

const settlement = {
  paymentId: "pay_TESTRESOLVER01",
  orderId: "ORD-100000",
  method: "upi_bank" as const,
  transactionDate: "2026-08-01",
  grossAmount: 100_000,
  mdrAmount: 0,
  gstOnMdr: 0,
  tcsSection52: 100,
  tdsRegime: "legacy_194O" as const,
  tdsAmount: 100,
  netAmount: 99_800,
  settlementUtr: "UTR0000000001",
  settlementDate: "2026-08-02",
};

const candidates = [
  {
    bankEntry: {
      utr: "UTR0000000000",
      creditAmount: 99_800,
      creditDate: "2026-08-02",
      narration: "NEFT CR-MISC SETTLEMENT BATCH",
    },
  },
];

function toolCallResponse(args: object) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              type: "function",
              function: { name: "record_resolution", arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

describe("resolveAmbiguousCase — with a mocked model response (OpenRouter, OpenAI-compatible)", () => {
  it("confirms a match when the model returns a well-formed confirm_match verdict", async () => {
    createMock.mockResolvedValue(
      toolCallResponse({
        verdict: "confirm_match",
        matchedUtr: "UTR0000000000",
        explanation: "Amount and date line up exactly; this is the only unclaimed candidate.",
      })
    );

    const { resolveAmbiguousCase } = await import("@/resolver/ambiguous-resolver");
    const verdict = await resolveAmbiguousCase(settlement, candidates);

    expect(verdict.verdict).toBe("confirm_match");
    expect(verdict.matchedUtr).toBe("UTR0000000000");
  });

  it("falls back to the default model when RESOLVER_MODEL is an empty string, not just when it's unset", async () => {
    // Regression test for a real bug found live: `RESOLVER_MODEL=` with
    // nothing after the `=` in .env.local reads back as "", and `??` only
    // falls back on null/undefined — so this used to send `model: ""` to
    // OpenRouter and get a genuine "400 No models provided" back.
    process.env.RESOLVER_MODEL = "";
    createMock.mockResolvedValue(
      toolCallResponse({ verdict: "escalate", explanation: "irrelevant to this test" })
    );

    const { resolveAmbiguousCase } = await import("@/resolver/ambiguous-resolver");
    await resolveAmbiguousCase(settlement, candidates);

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ model: expect.stringMatching(/.+/) }));
    delete process.env.RESOLVER_MODEL;
  });

  it("escalates rather than trusting a confirm_match with no named UTR", async () => {
    createMock.mockResolvedValue(
      toolCallResponse({ verdict: "confirm_match", explanation: "Looks right." })
    );

    const { resolveAmbiguousCase } = await import("@/resolver/ambiguous-resolver");
    const verdict = await resolveAmbiguousCase(settlement, candidates);

    expect(verdict.verdict).toBe("escalate");
    expect(verdict.explanation).toContain("untrustworthy");
  });

  it("escalates when the model returns no tool call at all", async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: "I'm not sure." } }] });

    const { resolveAmbiguousCase } = await import("@/resolver/ambiguous-resolver");
    const verdict = await resolveAmbiguousCase(settlement, candidates);

    expect(verdict.verdict).toBe("escalate");
  });

  it("escalates when the tool call arguments are malformed JSON", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              { type: "function", function: { name: "record_resolution", arguments: "{not valid json" } },
            ],
          },
        },
      ],
    });

    const { resolveAmbiguousCase } = await import("@/resolver/ambiguous-resolver");
    const verdict = await resolveAmbiguousCase(settlement, candidates);

    expect(verdict.verdict).toBe("escalate");
    expect(verdict.explanation).toContain("malformed");
  });

  it("escalates and includes the error message when the API call throws", async () => {
    createMock.mockRejectedValue(new Error("rate_limit_error: too many requests"));

    const { resolveAmbiguousCase } = await import("@/resolver/ambiguous-resolver");
    const verdict = await resolveAmbiguousCase(settlement, candidates);

    expect(verdict.verdict).toBe("escalate");
    expect(verdict.explanation).toContain("rate_limit_error");
  });

  it("respects the model's own decision to escalate rather than forcing a match", async () => {
    createMock.mockResolvedValue(
      toolCallResponse({
        verdict: "escalate",
        explanation: "Two candidates share the same amount; cannot tell them apart.",
      })
    );

    const { resolveAmbiguousCase } = await import("@/resolver/ambiguous-resolver");
    const verdict = await resolveAmbiguousCase(settlement, candidates);

    expect(verdict.verdict).toBe("escalate");
    expect(verdict.matchedUtr).toBeUndefined();
  });
});
