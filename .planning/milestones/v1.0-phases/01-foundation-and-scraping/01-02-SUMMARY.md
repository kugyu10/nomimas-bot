---
phase: 01-foundation-and-scraping
plan: 02
subsystem: api
tags: [supabase, edge-functions, deno, cheerio, twipla, scraping, providers, tdd]

requires:
  - phase: 01-01
    provides: supabase/functions/deno.json (cheerio/zod/@supabase-js バージョン固定), supabase/config.toml, devDB 7テーブル+RLS適用済み

provides:
  - supabase/functions/_shared/providers/types.ts (ParticipantListProvider / ScrapedParticipant / ScrapeResult / ParticipantStatus 型定義)
  - supabase/functions/_shared/providers/twipla.ts (parseTwiplaHtml純関数 + twiplaProvider実装)
  - supabase/functions/_shared/providers/registry.ts (resolveProvider — scraper→プロバイダー間の間接層)
  - supabase/functions/_shared/supabase.ts (createServiceClient)
  - supabase/functions/scraper/index.ts (scraper Edge Function, devデプロイ済み)
  - supabase/functions/tests/fixtures/twipla_event.html (匿名化フィクスチャ)
  - supabase/functions/tests/twipla_parser_test.ts (フィクスチャ6テスト GREEN)
  - supabase/functions/tests/twipla_live_test.ts (実URL統合テスト GREEN)
  - supabase/seed.sql (dev検証用固定UUID3行)
  - supabase/functions/deno.lock (依存バージョン固定)

affects:
  - Phase 2以降: scraperは管理画面（Phase 3）からトリガーされる。participantsテーブル構造はLINE配信（Phase 2）の前提
  - 01-03 (webhook/message-sender): _shared/supabase.ts と _shared/providers/* を再利用可能
  - 将来のPeatix/ジモティープロバイダー: types.ts + registry.ts のインターフェース契約に従い追加

tech-stack:
  added:
    - cheerio@1.2.0 (npm:, deno.json fixed, TwiplaHTMLパース)
    - zod@4.4.3 (npm:, scraper POSTボディ検証)
    - "@supabase/supabase-js@2.108.1" (npm:, Edge Function→DBアクセス)
    - "@std/assert@1.0.19" (jsr:, Denoテストアサーション)
  patterns:
    - "プロバイダー抽象化: ParticipantListProvider インターフェース + resolveProvider でscraper関数はTwipla固有コードを持たない"
    - "TDD RED→GREEN: 型定義→フィクスチャ→テスト（RED）→実装（GREEN）の順序"
    - "div.member_list 単位セクションスコープ: ページ全体への $('a.card.namelist') 適用は興味あり/不参加を混入させるアンチパターン"
    - "フィクスチャ匿名化: 実HTMLのn/s/href/title/img-srcをダミー置換（testuser*/example.com）し機械検証済み"
    - "SSRF防止: canHandle hostname許可リスト（twipla.jpのみ）+ fetch redirect:error + zod z.url()検証"

key-files:
  created:
    - supabase/functions/_shared/providers/types.ts
    - supabase/functions/_shared/providers/twipla.ts
    - supabase/functions/_shared/providers/registry.ts
    - supabase/functions/_shared/supabase.ts
    - supabase/functions/scraper/index.ts
    - supabase/functions/tests/fixtures/twipla_event.html
    - supabase/functions/tests/twipla_parser_test.ts
    - supabase/functions/tests/twipla_live_test.ts
    - supabase/seed.sql
    - supabase/functions/deno.lock
  modified: []

key-decisions:
  - "--import-map supabase/functions/deno.json を supabase functions deploy に追加: server-side bundlerがtop-level deno.jsonの bare specifier を自動解決しないため明示指定が必要"
  - "フィクスチャは3 member_listセクション（参加者2+興味あり2+不参加0）を保持: 実HTML構造を反映しテスト価値を維持"
  - "deno.lock をコミット: テスト依存（@std/assert等）のバージョン固定。supabase deploy は server-side bundleのためlockfileは参照されないが、ローカルテストの再現性のため有用"

patterns-established:
  - "Provider Pattern: 外部プラットフォームごとに canHandle/fetchParticipants を持つプロバイダーをregistryに登録し、scraperはresolveProvider経由のみでアクセスする"
  - "Anonymization Pattern: publicリポジトリへのコミット前にa.card.namelistのn/s/href/title/text/img属性を全件ダミー置換し、testuser*/twimg grep で機械検証する"

requirements-completed: [EVENT-02]

duration: 25min
completed: 2026-06-12
---

# Phase 01 Plan 02: Twiplaスクレイピング + scraper Edge Function Summary

**cheerio + div.member_list セクションスコープパーサーによるTwipla参加者抽出（interested混入防止）、プロバイダー抽象化インターフェース確立、scraper Edge FunctionをdevにデプロイしDB保存まで機械検証（EVENT-02実証）**

## Performance

- **Duration:** 25 min
- **Started:** 2026-06-12T02:00:00Z
- **Completed:** 2026-06-12T02:30:00Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- TDD RED→GREEN: 型定義 → 匿名化フィクスチャ → パーサテスト6本（RED） → twipla.ts / registry.ts 実装（GREEN、全PASS）
- 実URL統合テスト PASS: https://twipla.jp/events/731057 から total=4, attending=2, capacity=15 を正常取得
- scraper Edge Function devデプロイ + エンドツーエンド検証: saved=true / count=4 / SSRF→400 / DBレコード一致

## Task Commits

1. **Task 1: 型定義 + 匿名化フィクスチャ + パーサテスト（RED）** - `02b9f9b` (test)
2. **Task 2: Twiplaパーサ + プロバイダー + レジストリ実装（GREEN）+ 実URL統合テスト** - `e38d470` (feat)
3. **Task 3: scraper Edge Function + seed + devデプロイ + DB保存検証** - `4afda27` (feat)

## Files Created/Modified

- `supabase/functions/_shared/providers/types.ts` — ParticipantListProvider / ScrapedParticipant / ScrapeResult / ParticipantStatus 型定義（プロバイダー抽象化契約）
- `supabase/functions/_shared/providers/twipla.ts` — parseTwiplaHtml純関数 + twiplaProvider実装（div.member_listスコープ・canHandle SSRF防止）
- `supabase/functions/_shared/providers/registry.ts` — resolveProvider(url)（scraper→プロバイダー間の間接層）
- `supabase/functions/_shared/supabase.ts` — createServiceClient（SUPABASE_URL/SERVICE_ROLE_KEY 自動注入）
- `supabase/functions/scraper/index.ts` — scraper Edge Function（zod検証→resolveProvider→upsert。twipla固有コードなし）
- `supabase/functions/tests/fixtures/twipla_event.html` — 匿名化フィクスチャ（s属性全件testuser*/twimg 0件）
- `supabase/functions/tests/twipla_parser_test.ts` — パーサ6テスト + canHandle境界テスト（GREEN）
- `supabase/functions/tests/twipla_live_test.ts` — 実URL統合テスト（GREEN, attending>0確認）
- `supabase/seed.sql` — dev検証用固定UUID3行（oa_configs/events/event_platform_urls）
- `supabase/functions/deno.lock` — ローカルテスト依存バージョン固定

## Decisions Made

- **`--import-map` 必須**: server-side bundlerは `supabase/functions/deno.json` のbare specifierを自動解決しない。`supabase functions deploy --import-map supabase/functions/deno.json` が必要（Wave 2以降の全deploy命令に適用すること）
- **deno.lock コミット**: ローカルテストの再現性のため含める（deployには不要だが開発ループの安定化に有効）
- **フィクスチャ構造保持**: セクションヘッダの人数表記（参加者 2人／定員15人）を維持することでcapacity抽出テストが有意義になる

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `supabase functions deploy` に `--import-map` フラグを追加**
- **Found during:** Task 3（scraperデプロイ時）
- **Issue:** PLAN記載の `supabase functions deploy scraper --project-ref "$DEV_PROJECT_REF" --use-api` コマンドでは `"zod"` bare specifierが解決されず400エラー
- **Fix:** `--import-map supabase/functions/deno.json` を追加してデプロイ成功
- **Files modified:** なし（コマンド変更のみ）
- **Verification:** デプロイ成功 + curl PASS
- **Committed in:** 4afda27 (Task 3コミットのコミットメッセージに偏差注記)

**2. [Rule 3 - Blocking] `cheerio.AnyNode` 型が cheerio 1.2.0 の exports に存在しない**
- **Found during:** Task 2（twipla.ts 実装時）
- **Issue:** `cheerio.AnyNode` 型は cheerio 1.2.0 のindex.d.tsにexportされていない（domhandler経由でのみ存在）
- **Fix:** cheerioコールバックの型注釈を `any` に変更（`// deno-lint-ignore no-explicit-any` 付き）
- **Files modified:** supabase/functions/_shared/providers/twipla.ts
- **Verification:** `deno test` 6テスト全PASS
- **Committed in:** e38d470 (Task 2コミット)

---

**Total deviations:** 2 auto-fixed (2x Rule 3 - Blocking)
**Impact on plan:** 両方ともデプロイ/コンパイルのブロッカー解消。機能スコープへの影響なし。

## Issues Encountered

- IPv6専用DBホスト（Plan 01-01からの継続）: SUPABASE_DIRECT_CONNECTION_STRING は IPv6のみ解決のため psql 直接接続不可。`supabase link` + `supabase db reset --linked` + pooler-url経由psqlで回避（Plan 01-01と同じ解決策）

## Known Stubs

なし — すべての実装が実際のデータソースに接続済み（フィクスチャテストはフィクスチャHTMLを使用、ライブテストは実URLを使用）。

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: SSRF-mitigated | scraper/index.ts | resolveProvider(canHandle) + zod z.url() + redirect:error で T-01-05 対策済み |
| threat_flag: data-anonymization-verified | tests/fixtures/twipla_event.html | s属性全件testuser* / twimg 0件を機械検証（T-01-06対策済み） |

## Success Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Phase 1成功条件1: フィクスチャ自動テストPASS | PASSED | deno test 6/6 PASS（attending=2, interested≠attending確認） |
| Phase 1成功条件1: 実URL取得確認 | PASSED | live test PASS (total=4, attending=2, capacity=15) |
| Phase 1成功条件1: プロバイダー抽象化経由 | PASSED | scraper/index.ts に twipla 文字列リテラルなし（resolveProvider経由のみ） |
| Phase 1成功条件4 (scraper分): devにデプロイ + 呼び出しログ | PASSED | functions list確認 + curl→200+saved:true |
| twipla.jp以外URL→400 | PASSED | example.com→400確認 |
| participants DB保存 | PASSED | count=4, attending=2, DB件数=curl応答値 |
| フィクスチャ匿名化 | PASSED | s属性全件testuser* / twimg 0件 / 3 member_listセクション |

## TDD Gate Compliance

- RED gate commit: `02b9f9b` (test(01-02): add type definitions + anonymized fixture + failing parser test (RED))
- GREEN gate commit: `e38d470` (feat(01-02): implement Twipla parser + provider + registry (GREEN) + live URL test)
- REFACTOR: なし（コードは十分シンプル）

## Self-Check: PASSED
