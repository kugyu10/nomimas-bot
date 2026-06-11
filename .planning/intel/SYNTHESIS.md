# SYNTHESIS

Entry point for downstream consumers (gsd-roadmapper).
Mode: new (fresh bootstrap, no existing .planning context)
Generated: 2026-06-12 by gsd-doc-synthesizer

## Project

nomimas — Twipla→LINE 最終確認自動配信ツール（オフ会主催者向け）。
Core Value: Twiplaの参加者リスト取得から最終確認の配信・回答収集まで、主催者の手作業がゼロであること。

## Docs Synthesized

- Total: 1
- PRD: 1 (/Users/kugyu10/work/nomimas-bot/docs.md — consolidated PROJECT.md / REQUIREMENTS.md / ROADMAP.md, classified medium confidence, hybrid doc)
- ADR: 0 / SPEC: 0 / DOC: 0
- Cycle detection: single-node graph, no cycles. Cross-refs are external (the docs this file consolidates).

## Decisions

- File: /Users/kugyu10/work/nomimas-bot/.planning/intel/decisions.md
- Entries: 8 (6 Key Decisions §4 + tech stack §3 + environment separation §3)
- Locked: 0 — only DEC-scraping-cheerio is confirmed ("✓ 確認済み"); the rest are Pending or "決定済み" without lock status
- Notable: backend unified on Supabase Edge Functions + pg_cron (initial AWS Lambda design abandoned); v1 LINE-Twipla linking is manual; provider pattern for multi-platform event URLs

## Requirements

- File: /Users/kugyu10/work/nomimas-bot/.planning/intel/requirements.md
- v1: 12 — AUTH-01, EVENT-01, EVENT-02, LINE-01, LINE-02, LINE-03, ADMIN-01, ADMIN-02, NOTIF-01, OA-01, OA-02, OA-03 (all phase-mapped, 0 unmapped)
- v2 (design-aware, deferred): 3 — LINK-01, DATA-01, REMIND-01
- Out-of-scope list preserved (6 items, §7)

## Constraints

- File: /Users/kugyu10/work/nomimas-bot/.planning/intel/constraints.md
- Entries: 8 — schema: 1 (CON-db-schema) / api-contract: 2 (CON-twipla-scrape-selector, CON-edge-functions-topology) / protocol: 2 (CON-line-webhook, CON-qa-state-machine) / nfr: 3 (CON-cost-scale, CON-permission-model, CON-env-isolation)

## Context

- File: /Users/kugyu10/work/nomimas-bot/.planning/intel/context.md
- Topics: 8 — product overview, background/problem, terminology, roadmap phases 1–4 (MVP/coarse), requirement-to-phase map, processing flow (9 steps), future expansion, source/update policy

## Roadmap Signal (for roadmapper)

- Phase 1: 基盤構築+スクレイピング検証 (EVENT-02) — de-risk Twipla scraping first
- Phase 2: LINE Botコア (LINE-01/02/03), depends on Phase 1
- Phase 3: 管理画面 (AUTH-01, EVENT-01, ADMIN-01/02, OA-01/02), depends on Phase 1
- Phase 4: 通知+統合仕上げ (NOTIF-01, OA-03, OA-02 root), depends on Phases 2 and 3

## Conflicts

- Blockers: 0 / Competing variants: 0 / Auto-resolved: 0 (3 INFO notes)
- Report: /Users/kugyu10/work/nomimas-bot/.planning/INGEST-CONFLICTS.md
- STATUS: READY — safe to route
