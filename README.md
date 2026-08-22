# Reconciliation Agent

**Track:** AI Finance Controller — Razorpay AI Buildathon 2026

A multi-rail settlement reconciliation engine that closes the loop between a
merchant's Razorpay settlements, their bank statement, and their internal
order ledger — and, unlike a naive implementation, correctly survives the
live Indian TDS regime transition instead of flagging half the batch as
anomalous.

## The problem this is actually solving

Razorpay's own "why now" for this track: *"verification capacity, not
generation speed, is the bottleneck. Reconciliation, settlement and
forecasting are still done by hand."* That's not hackathon flavor text —
it's a documented 2026 phenomenon: median code review time is up 441.5%
even as AI-assisted task throughput rose 33.7%, and 96% of developers don't
fully trust AI-generated output without checking it
([SRLabs](https://srlabs.de/blog/ai-verification-bottleneck)). Financial
reconciliation is the same crisis in a different domain: money moves faster
than anyone can verify it moved correctly.

Indian multi-rail reconciliation specifically is harder than a generic
"match two CSVs" exercise:

- Settlement files net out **MDR, GST on MDR, and TCS under Section 52 of
  the CGST Act** before crediting the merchant — the deductions have to be
  unpacked before matching even starts.
- **UPI bank-account (P2M) transactions carry zero MDR** under the RBI/NPCI
  nil-MDR mandate; wallet-on-UPI and RuPay-credit-on-UPI are *not* covered
  by that mandate and carry real interchange-bearing MDR.
- **UPI typically settles T+1, cards typically settle T+2** — cross-rail
  reconciliation is a time-lagged match, not a same-day join.
- For exactly 12 months, **April 2026 through March 2027**, Indian
  e-commerce reconciliation has to handle **two live income-tax TDS
  regimes simultaneously**: legacy Section 194O closing out in Form 26AS,
  and the Income Tax Act 2025's renumbered **Section 393(1), reporting
  code 1035**. Both are valid on the same batch during this window. A
  reconciler built before this transition will misclassify every
  393(1)/1035-tagged transaction as an anomaly — which is exactly what
  this project measures and fixes.

## The actual result (not asserted — reproducible)

Running the same 300-order synthetic batch (seed 42) through both a naive
baseline and the current engine, verified live against the running dashboard,
not estimated:

| | Naive (only recognizes legacy 194O) | Current engine |
|---|---|---|
| Match rate | 43.1% | 81.4% |
| False "unrecognized TDS regime" flags | 132 | **0** |

The naive baseline isn't a strawman — it's what any reconciliation system
built before this transition window actually does: treat the new,
perfectly legitimate 393(1)/1035 code as a data error, on roughly half the
batch, because the TDS regime is assigned close to 50/50 by design (see
`src/data/generator.ts`). Reproduce it yourself: `npm run dev`, run a batch
with seed 42 and 300 orders, and compare the two report panels — these
numbers came from that exact request, not a smaller sample scaled up.

## Architecture

```
src/
  domain/types.ts         — the shared data model (settlements, bank
                             entries, ledger, exceptions, reports)
  engine/tax.ts            — MDR/GST/TCS/TDS unpacking + settlement lag.
                             Pure functions, fully unit tested.
  engine/match.ts          — the deterministic matcher. Zero LLM calls.
                             UTR-exact match → amount+date fallback search
                             → honest exception. Every exception carries a
                             category and a human-readable reason.
  engine/resolve-batch.ts  — orchestrates the second pass over whatever
                             the deterministic engine explicitly could
                             not close.
  resolver/
    ambiguous-resolver.ts  — the ONLY place an LLM touches this pipeline.
  data/generator.ts        — synthetic fixture generator with a labeled
                             ground truth, deterministic under a seed.
  app/page.tsx             — dashboard: run a batch, see the naive-vs-
                             current comparison and the full exception list.
  app/api/run-batch/       — the one API route.
tests/                     — 35 tests: tax math, every exception category
                             by hand, the naive/current TDS comparison,
                             the resolver's fail-closed AND mocked-success
                             paths (no API credits needed to verify either),
                             the persistence layer's graceful degradation,
                             and an end-to-end accuracy check against
                             generated ground truth.
```

### Where AI is used, and — just as deliberately — where it isn't

The matching core (`engine/match.ts`, `engine/tax.ts`) is **plain
deterministic TypeScript, with no LLM anywhere near it.** Whether a
transaction is matched or exceptioned is the number a merchant's cash
position depends on — it has to be reproducible from the same inputs every
time, not probabilistic. Every exception carries a specific, checkable
reason (`amount_mismatch`, `duplicate_utr`, `orphan_settlement`, etc.), not
a vibe.

The LLM is confined to exactly one job: judging the small number of
genuinely ambiguous cases the deterministic engine narrows down but can't
close — a masked UTR plus an unparseable narration, where amount-and-date
proximity found one or more candidates but no clean key match. That's a
bounded, single-shot classification, not a multi-step autonomous task, so
a full agent framework (file access, bash, multi-turn planning) would be
the wrong tool for the job regardless of which model sits behind it — using
one anyway just because it sounds more impressive would be worse judgment,
not better. The resolver is built against the plain `openai` package
pointed at **OpenRouter's** OpenAI-compatible endpoint rather than a
provider-specific SDK, on purpose: it only needs standard tool-calling, so
the same code runs against any OpenRouter-hosted model — including
free-tier ones — by changing an env var, not the resolver logic. That
matters concretely here: this submission runs the resolver on a free
OpenRouter model rather than a paid one, and the code didn't need to change
to make that swap. The resolver is also built to **fail closed**: no API
key, a network error, malformed tool-call arguments, or a model claiming a
match without naming which candidate — all of these resolve to `escalate`,
never a guessed match. A wrong confirmed match misattributes real money; an
honest escalation doesn't. Both paths are tested: `tests/resolve-batch.test.ts`
covers the no-key fail-closed path end to end, and `tests/ambiguous-resolver.test.ts`
mocks the model response to cover the success path, the "confirms without
naming a UTR" defensive check, and the malformed-response/network-error
paths — none of it needs a real API key or credits to verify.

## What broke, and how we got out

While writing the "never double-counts one bank credit across two
settlements" test, the test itself was wrong, not the engine: both
hand-crafted settlements were given the *same* UTR as the masked bank
entry they were supposed to be ambiguously competing for, which made the
exact-UTR-match path fire directly for both instead of exercising the
amount+date fallback search the test was meant to exercise. The fix wasn't
a code change to the matcher — it was recognizing that in the real
generator, a masked bank-entry UTR never matches any settlement's real
UTR by construction, and rewriting the test fixture to actually reflect
that (two settlements keeping their own distinct real UTRs, neither of
which has a bank entry). Kept the failing-then-fixed commit history rather
than squashing it, since this is the kind of mistake that's easy to make
again in a slightly different shape.

A second one, once the naive-vs-current comparison was pushed across five
different seeds instead of just seed 42: the test asserted that *every*
new-regime settlement gets misflagged by the naive baseline, and it failed
on three of the five seeds by a handful of records each time. Not a flaky
test — a real ordering fact in `match.ts` that the single-seed version
had been too small to expose: an orphan settlement (references an order
that doesn't exist in the ledger) is caught by that check *before* the
TDS-regime check ever runs, in both naive and current modes, because an
orphan has a more fundamental problem than its TDS code regardless of
which regime it claims. The engine's behavior was correct; the test's
expectation wasn't accounting for it. Fixed by excluding orphaned
settlements from the expected count rather than loosening the assertion —
the whole point of this test is that the naive baseline misses *every*
non-orphan new-regime case, and a looser threshold would have quietly
hidden a real regression if one were ever introduced.

## Running it

```bash
npm install
npm test          # 35 tests, ~1s
npx tsc --noEmit  # typecheck
npm run build     # production build
npm run dev       # dashboard at http://localhost:3000 (or next free port)
```

Copy `.env.local.example` to `.env.local` and fill in your own values.
Set `OPENROUTER_API_KEY` to enable the LLM resolver pass (a free-tier
OpenRouter model works — see the comment in `.env.local.example`); without
it, ambiguous cases correctly escalate instead of silently resolving.
Set the three `SUPABASE_*` values to persist batch runs (apply
`supabase/schema.sql` via your project's SQL Editor once); without them,
the engine works identically, it just doesn't save a history.

## What's intentionally not built

No job queue or background worker — batches are 50–2000 rows, not big
data; a synchronous server action processes that in well under a second,
and reaching for a queue here would be solving a scale problem this
project doesn't have. No persistence layer yet (results are computed
fresh per request) — the deterministic core and its test coverage were
prioritized over storage, on the theory that a smaller, fully-working
submission beats a bigger one that's still wiring up its database on
September 5.
