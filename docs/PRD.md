# ContextSaver — PRD

**Stop Claude Code from wasting tokens doing useless shit, in realtime.**

A Claude Mod (function-hooks plugin). 2026-09-17. API facts and background research live with the build notes outside this repo; the build spec is `docs/SPEC.md`.

## Problem

Long Claude Code sessions fill their context with waste that compounds while Claude works: the third full test-suite run, the fourth read of the same file, a log dumped into the window, the plan re-summarized every turn, two subagents editing one file. Context fills, compaction fires, Claude forgets. The user's only tools today are Esc and typing. Nothing watches behavior inside the session; compression proxies and log miners act after the fact and cannot stop a tool before it runs.

## What it does

1. **Detects waste in real time**, inside the session.
2. **Lets the user steer, fix, or stop it with one click**, before the wasteful action runs.
3. **On demand, turns those decisions into skills, CLAUDE.md rules, guards and agent briefs** for the next session.

## Users

Every Claude Code user on sessions longer than ~30 minutes. Zero configuration. Heaviest value for subagent, `/loop` and `/goal` users.

## v1 features

### Ledger (deterministic, always on)
One row per `tool.call`: tool, normalized input signature, duration, output size, error, `agentId`, turn, command class (test/lint/format/typecheck/build/git/read/other). Per turn: tokens, output tokens, tool-call count. Context % from `$.session.usage()`. Paths edited since the last run of each command class.

### Judge (model, periodic, open-ended)
`$.model.fork` over the transcript plus the ledger as text, on a cadence driven by tokens/turns. Returns strict JSON:

```json
{ "focus": "what this session is spending time on",
  "findings": [{ "category": "execution|reading|production|behavior|communication|multi-agent|environment|process|other",
                 "kind": "free text", "evidence": ["tool_use_id"],
                 "context_pct": 6.1, "time_ms": 700000, "tokens_est": 48000,
                 "why": "...", "alternative": "...", "confidence": 0.85,
                 "signature": { "where": {...}, "when": {...}, "fires_after": 2 } }],
  "rule_candidates": ["..."] }
```

Categories are lenses (the taxonomy is Appendix B of `docs/SPEC.md`); `kind` is free text so discovery stays open. Findings merge into a pattern registry in `$.store` (dedupe via `$.model.classify`). Steered patterns are promoted; Kept patterns are demoted and stop appearing. The judge's prompt carries the user's past Keep/Steer decisions as calibration. The judge reports its own cost and throttles itself.

### Armed signatures (real-time trigger)
Each finding's `signature` is armed in the ledger. The next matching `tool.check` fires the card **before** the tool runs. No model call on that path. First occurrences are never interrupted.

### Card
```
⚠ Full test suite, run #3 · ~6% context · 11m so far
  Only src/auth.ts changed since run #2.
  [Keep]   [Steer → run tests/auth.test.ts]   [Kill]
```
- **Keep**: silence this pattern for the session; recorded as a label.
- **Steer**: tool-adjacent waste → `context` note on the next tool result (read mid-turn). Behavioral waste → steering note appended to a `prompt.section`, invalidated once. Fallback: queued prompt.
- **Kill**: `tool.check` deny with the reason, or `$.turn.abort`.

### Band (AbovePrompt)
```
ContextSaver · 41% left · ~35 min to compaction · 2 wasters live · saved ~18% · ~41 min   [Rules]
```

### Saved counter
After each Steer/Kill: toast `+3m 50s · +~6% context saved`; accumulates in the band. Baseline is the session's own history (median cost of the pattern's prior occurrences). Kill saves the baseline; Steer saves baseline minus the alternative's measured cost; if Claude ignores the steer, saved = 0 and the card records "steer ignored". Behavioral steers accrue per subsequent turn. Always shown with `~`, basis on hover.

### Rules pane (on demand only)
`/saver rules` or the [Rules] button. Never auto-opens. Proposes, per counted pattern, with evidence and estimated saving:

| Waste | Artifact |
|---|---|
| Behavioral | CLAUDE.md line |
| Workflow (targeted tests, lint once per batch, flaky protocol) | Skill |
| Hard constraint | Generated guard mod (validated) or hook |
| Multi-agent | Subagent briefs with disjoint scopes |
| Permission thrash | `settings.json` allow rule |
| Model/effort mismatch | Agent `model` field |

Buttons: **Write** (project/user scope), **Try once** (session-scoped), **Skip**. Nothing is written without a click.

## v2
- Informed compaction: `session.compact` drops messages labeled as waste before summarizing.
- Next-session measurement: count each written artifact's pattern again; propose removal if it didn't help.
- Pre-execution trims: hold an oversized read at `tool.check` with [Run] [Trim to errors] [Skip].
- **Compressor routing (opt-in)**: if `rtk` (or `headroom`) is installed, automatically route eligible commands through it — rewrite the Bash input on `tool.call` from `cargo test` to `rtk cargo test` (with a `context` note so the model knows), or pipe the raw output through the compressor via `$.process.run` stdin and return the trimmed `{ result }`. Detected on `session.start`; user enables per command class; band tags routed calls; saved counter credits the measured reduction. Bytes handled by them, behavior by us.

## v3
Exportable/importable pattern registries; aggregate "top waste patterns".

## Non-goals
No cost dashboard. No blanket output compression (native persistence >30K chars; Headroom/rtk own it). No session summaries. Never hides errors or trims stderr. Never acts without a click except on user-pre-approved patterns.

## Success metrics
Cards acted on ≥ 50%; Keep rate on judge-only findings < 30%; judge overhead < 3% of session tokens; context saved per session.

## Open questions (answer with the first probe)
- Does a `context` note on the next tool result change Claude's course mid-turn?
- Does the judge cite real `tool_use_id`s and real repeated text, or invent them?
- Fork cost/latency on a long session → cadence thresholds.
- Does "full suite while ≤ 3 files changed" fire correctly and stay quiet after a fix lands?
