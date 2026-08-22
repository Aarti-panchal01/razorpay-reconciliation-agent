import OpenAI from "openai";
import type { BankStatementEntry, SettlementRecord } from "@/domain/types";

/**
 * Resolves the leftovers the deterministic matcher explicitly could not
 * close — genuinely ambiguous candidates (masked UTR, unparseable
 * narration) where amount+date narrowed things down but couldn't fully
 * decide. This is deliberately the ONLY place an LLM touches this
 * pipeline: it never sees the amount math or the compliance rules, only
 * the judgment call a human reviewer would otherwise make by eye.
 *
 * Runs against OpenRouter's OpenAI-compatible chat-completions API rather
 * than a provider-specific SDK, on purpose: the resolver only needs
 * standard tool-calling, so building it against the OpenAI-compatible
 * shape (via the official `openai` package pointed at OpenRouter's base
 * URL) means the same code works against any OpenRouter-hosted model —
 * including free-tier ones — without touching resolver logic, just the
 * env var. Model defaults to a free OpenRouter model; check
 * https://openrouter.ai/models?max_price=0 for what's currently free, since
 * that roster changes, and override via RESOLVER_MODEL if the default ever
 * disappears.
 *
 * Deliberately a single-shot structured tool call, not the full Claude
 * Agent SDK or any multi-step agent framework — this is a bounded
 * classification over a handful of candidates, not a multi-turn autonomous
 * task, so a heavier agent loop (file access, multi-turn planning) would
 * be the wrong tool for the job regardless of which model sits behind it.
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

const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

const RESOLUTION_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "record_resolution",
    description: "Record the judgment for one ambiguous settlement-to-bank-credit attribution.",
    parameters: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          enum: ["confirm_match", "escalate"],
          description:
            "'confirm_match' only if one candidate is clearly the right one. 'escalate' if genuinely uncertain — never guess.",
        },
        matchedUtr: {
          type: "string",
          description: "The UTR of the chosen candidate, required when verdict is confirm_match.",
        },
        explanation: {
          type: "string",
          description: "One or two plain-English sentences a non-technical reviewer can read in the audit log.",
        },
      },
      required: ["verdict", "explanation"],
    },
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

Decide whether one candidate is clearly the correct attribution (confirm_match) or whether this should escalate to a human reviewer (escalate). Only confirm_match when you're genuinely confident — a plausible guess is worse than an honest escalation, because confirming a wrong match misattributes real money.

Call the record_resolution tool with your answer.`;
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
  if (!process.env.OPENROUTER_API_KEY) {
    return {
      paymentId: settlement.paymentId,
      verdict: "escalate",
      explanation: "Resolver unavailable (no API key configured) — escalated to human review rather than guessing.",
    };
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const response = await client.chat.completions.create({
      model: process.env.RESOLVER_MODEL ?? DEFAULT_MODEL,
      max_tokens: 512,
      tools: [RESOLUTION_TOOL],
      tool_choice: { type: "function", function: { name: "record_resolution" } },
      messages: [{ role: "user", content: buildPrompt(settlement, candidates) }],
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.type !== "function") {
      return {
        paymentId: settlement.paymentId,
        verdict: "escalate",
        explanation: "Resolver returned no structured verdict — escalated to human review.",
      };
    }

    let input: { verdict: "confirm_match" | "escalate"; matchedUtr?: string; explanation: string };
    try {
      input = JSON.parse(toolCall.function.arguments);
    } catch {
      return {
        paymentId: settlement.paymentId,
        verdict: "escalate",
        explanation: "Resolver returned malformed structured output — escalated to human review.",
      };
    }

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
