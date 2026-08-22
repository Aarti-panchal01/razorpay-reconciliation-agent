import Anthropic from "@anthropic-ai/sdk";
import type { BankStatementEntry, SettlementRecord } from "@/domain/types";

/**
 * Resolves the leftovers the deterministic matcher explicitly could not
 * close — genuinely ambiguous candidates (masked UTR, unparseable
 * narration) where amount+date narrowed things down but couldn't fully
 * decide. This is deliberately the ONLY place an LLM touches this
 * pipeline: it never sees the amount math or the compliance rules, only
 * the judgment call a human reviewer would otherwise make by eye.
 *
 * Deliberately built on the plain Anthropic SDK with structured tool
 * output, not the full Claude Agent SDK. This is a single-shot, bounded
 * classification over a handful of candidates — not a multi-step
 * autonomous task — so the heavier agent loop (file access, multi-turn
 * planning, bash) would be the wrong tool for the job. That's as much an
 * "AI judgment" decision as picking Claude in the first place.
 */

export interface ResolverCandidate {
  bankEntry: BankStatementEntry;
}

export interface ResolverVerdict {
  paymentId: string;
  verdict: "confirm_match" | "escalate";
  matchedUtr?: string;
  explanation: string;
}

const RESOLUTION_TOOL = {
  name: "record_resolution",
  description:
    "Record the judgment for one ambiguous settlement-to-bank-credit attribution.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: {
        type: "string" as const,
        enum: ["confirm_match", "escalate"],
        description:
          "'confirm_match' only if one candidate is clearly the right one. 'escalate' if genuinely uncertain — never guess.",
      },
      matchedUtr: {
        type: "string" as const,
        description: "The UTR of the chosen candidate, required when verdict is confirm_match.",
      },
      explanation: {
        type: "string" as const,
        description: "One or two plain-English sentences a non-technical reviewer can read in the audit log.",
      },
    },
    required: ["verdict", "explanation"],
  },
};

function buildPrompt(settlement: SettlementRecord, candidates: ResolverCandidate[]): string {
  const candidateLines = candidates
    .map(
      (c, i) =>
        `${i + 1}. UTR=${c.bankEntry.utr}, amount=₹${(c.bankEntry.creditAmount / 100).toFixed(2)}, date=${c.bankEntry.creditDate}, narration="${c.bankEntry.narration}"`
    )
    .join("\n");

  return `A settlement could not be matched to a bank credit by exact UTR. The deterministic engine narrowed it to ${candidates.length} candidate(s) by amount and settlement-date proximity, but none had a clean UTR match, so it needs a judgment call.

Settlement: orderId=${settlement.orderId}, paymentId=${settlement.paymentId}, method=${settlement.method}, expected net=₹${(settlement.netAmount / 100).toFixed(2)}, expected settlement date=${settlement.settlementDate}.

Candidate bank credit(s):
${candidateLines}

Decide whether one candidate is clearly the correct attribution (confirm_match) or whether this should escalate to a human reviewer (escalate). Only confirm_match when you're genuinely confident — a plausible guess is worse than an honest escalation, because confirming a wrong match misattributes real money.`;
}

/**
 * Resolves one ambiguous case. Fails closed: any error (missing API key,
 * network failure, malformed response) returns an "escalate" verdict
 * rather than throwing or guessing — an unresolved exception is a correct,
 * safe output; a silently wrong match is not.
 */
export async function resolveAmbiguousCase(
  settlement: SettlementRecord,
  candidates: ResolverCandidate[]
): Promise<ResolverVerdict> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      paymentId: settlement.paymentId,
      verdict: "escalate",
      explanation: "Resolver unavailable (no API key configured) — escalated to human review rather than guessing.",
    };
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: process.env.RESOLVER_MODEL ?? "claude-sonnet-5",
      max_tokens: 512,
      tools: [RESOLUTION_TOOL],
      tool_choice: { type: "tool", name: "record_resolution" },
      messages: [{ role: "user", content: buildPrompt(settlement, candidates) }],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return {
        paymentId: settlement.paymentId,
        verdict: "escalate",
        explanation: "Resolver returned no structured verdict — escalated to human review.",
      };
    }

    const input = toolUse.input as {
      verdict: "confirm_match" | "escalate";
      matchedUtr?: string;
      explanation: string;
    };

    if (input.verdict === "confirm_match" && !input.matchedUtr) {
      // The model claimed a match without naming which UTR — treat as an
      // untrustworthy answer rather than accepting half of it.
      return {
        paymentId: settlement.paymentId,
        verdict: "escalate",
        explanation: "Resolver confirmed a match without specifying which candidate — escalated as untrustworthy output.",
      };
    }

    return {
      paymentId: settlement.paymentId,
      verdict: input.verdict,
      matchedUtr: input.matchedUtr,
      explanation: input.explanation,
    };
  } catch (error) {
    return {
      paymentId: settlement.paymentId,
      verdict: "escalate",
      explanation: `Resolver call failed (${error instanceof Error ? error.message : "unknown error"}) — escalated to human review rather than blocking the batch.`,
    };
  }
}
