# INGEST-CONFLICTS

Mode: new | Docs in set: 1 | Precedence: ADR > SPEC > PRD > DOC
Generated: 2026-06-12 by gsd-doc-synthesizer

## Conflict Detection Report

### BLOCKERS (0)

(none)

### WARNINGS (0)

(none)

### INFO (3)

[INFO] Hybrid document classified as PRD (medium confidence)
  Note: /Users/kugyu10/work/nomimas-bot/docs.md mixes PRD content (12 ID'd v1 requirements, v1/v2 scope split, out-of-scope table) with SPEC-like tech-stack/schema tables and ADR-like "Key Decisions". Classified PRD because requirements content dominates; SPEC/ADR-like content was still extracted into constraints.md and decisions.md with source attribution. No precedence conflicts possible within a single source.

[INFO] No locked decisions in ingest set
  Note: All "Key Decisions" in /Users/kugyu10/work/nomimas-bot/docs.md §4 carry status "Pending" except the cheerio scraping decision ("✓ 確認済み"); the §3 tech stack is marked "決定済み" in the source but no ADR carries locked: true. Decisions are recorded as proposed/decided-in-source in .planning/intel/decisions.md — downstream roadmapper may formalize/lock them.

[INFO] Cross-refs point outside the ingest set (no cycles)
  Note: /Users/kugyu10/work/nomimas-bot/docs.md references PROJECT.md, REQUIREMENTS.md, ROADMAP.md, requirements.md, and .planning/research — these are the documents it consolidates and were not part of this ingest set. Cycle detection ran on a single-node graph: no cycles found.

---

GSD > No conflicts detected.
