---
phase: 04-notifications-integration
plan: 02
subsystem: edge-functions
tags: [supabase, deno, typescript, line-messaging, notifications, e2e, webhook, scraper]

# Dependency graph
requires:
  - phase: 04-notifications-integration
    plan: 01
    provides: "notification_logs テーブル, oa_members.line_user_id, _shared/notify 純関数3本, dev secrets LINE_DRY_RUN=1"
provides:
  - "_shared/notify/notifier.ts: notifyConfirmUpdate + notifyScrapeChanges + NotifyResult"
  - "webhook/index.ts: answerPersistFailed フラグ + reply 後 notifyConfirmUpdate 結線"
  - "scraper/index.ts: select-before-upsert + diffParticipants + notifyScrapeChanges 結線 + changes/notified レスポンス追加"
  - "e2e_full_chain_test.ts: 全鎖 E2E（窓内/窓外/scrape差分/二重通知防止 green）"
  - "webhook/scraper dev デプロイ済み（notifier 結線込み）"
affects:
  - "04-03: RLS マトリクス（notification_logs の service role INSERT が前提）"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "notifier: I/O を pure 関数から分離（window/diff/messages を import して組み立て）"
    - "per-target push: 宛先ごとに try/catch で failed カウントして継続（message-sender パターン）"
    - "answerPersistFailed フラグ: upsert 失敗時にフラグで保存成否を後段に伝播（result 差替えだけでは後段で判別不能）"
    - "select-before-upsert diff: PostgREST は upsert の旧値を返せないため upsert 前 1 select で Map 化"
    - "E2E DB 変異トリック: 実 Twipla データが不変でも status 変更 + 1 行削除で差分を決定的に作る（Pattern 7 (c)）"
    - "Postgres current_date は UTC: JST とのズレを teardown の日付アサートで踏んだため DB 側クエリで比較"

key-files:
  created:
    - "supabase/functions/_shared/notify/notifier.ts"
    - "supabase/functions/tests/e2e_full_chain_test.ts"
  modified:
    - "supabase/functions/webhook/index.ts"
    - "supabase/functions/scraper/index.ts"

key-decisions:
  - "answerPersistFailed フラグを明示導入: result = answerPersistFailureResult(current) 差替えだけでは通知側で保存成否を判別できないため bool フラグを追加（プラン指定どおり）"
  - "reply ブロックの early return を廃止しフラグ制御に変更: reply の成否に関わらず (d) 通知呼び出しへ到達させるため（Pitfall 3 / PLAN Task 2 指定）"
  - "E2E の seed participant 保護: (c) DB 変異でタネ参加者 ...0005 を誤って変更しないよう id != SEED_PARTICIPANT_ID でフィルタ（status='attending' が壊れると message-sender ターゲットから外れる）"
  - "teardown 日付アサートに DB クエリ使用: Postgres current_date は UTC / Deno の todayJst() は JST — JST が前日になる UTC 時間帯では ±1 日ズレが生じるためサーバ側 current_date + 3 で比較"

requirements-completed: [NOTIF-01]

# Metrics
duration: 10min
completed: 2026-06-12
---

# Phase 4 Plan 02: notifier本体 + webhook/scraper結線 + dev デプロイ + 実Twipla全鎖E2E Summary

**notifier.ts 実装 + webhook/scraper 結線 + dev デプロイ + 実Twipla 全鎖 E2E（窓内通知/窓外非通知/scrape差分/二重通知防止）を green で完了**

## Performance

- **Duration:** 10 min
- **Started:** 2026-06-12T21:05:36Z
- **Completed:** 2026-06-12T21:16:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- `_shared/notify/notifier.ts` を Pattern 1 契約どおりに実装。`notifyConfirmUpdate`（webhook 経路: participant→event 1クエリ解決→窓判定→チャネルガード→受信者解決→per-target push→notification_logs INSERT）と `notifyScrapeChanges`（scraper 経路: issueStatelessToken・1スクレイプ1サマリ・同 f フロー）。deno check exit 0、console に userId 非含有を機械検査。

- `webhook/index.ts` に `answerPersistFailed` フラグを導入し、reply ブロックの early return を廃止してフラグ制御に変更。reply 送信後に try/catch 付き `notifyConfirmUpdate`（kind: completion | answer 排他）を結線。通知失敗が 200 契約を破らない構造を確立（T-04-07）。

- `scraper/index.ts` に select-before-upsert 差分検出を追加。epu lookup を `events` ネスト select に拡張（追加クエリなし）。upsert 前に既存行 Map を取得し、upsert 成功後に `diffParticipants` で差分計算。初回スキップ+件数ログ（Pitfall 2）。変化あり時のみ try/catch 付き `notifyScrapeChanges`。レスポンスに `changes/notified` 追加（既存キー不変 — A5）。dev デプロイ 2本 exit 0。

- `e2e_full_chain_test.ts` でシナリオ (a)〜(g) を実装し E2E_TEST=1 で green 確認。窓内 kind='answer'/'completion' 行あり（sent>=1 / skipped_no_line_id=1）、窓外 notification_logs 0 行、scrape 差分 kind='scrape_changes' 行あり（detail 件数一致）、Q3 で kind='answer' が増えない（二重通知防止）の 4 系統 assert がすべて green。2 回連続実行で冪等性確認。

## Task Commits

1. **Task 1: notifier.ts 実装** - `d4780b5` (feat)
2. **Task 2: webhook/scraper 結線 + dev デプロイ** - `b2bb85f` (feat)
3. **Task 3: e2e_full_chain_test.ts 全鎖 E2E green** - `2002e8f` (feat)

## Files Created/Modified

- `supabase/functions/_shared/notify/notifier.ts` - notifyConfirmUpdate + notifyScrapeChanges + NotifyResult（310行）
- `supabase/functions/webhook/index.ts` - answerPersistFailed フラグ + reply フラグ制御 + notifyConfirmUpdate 結線
- `supabase/functions/scraper/index.ts` - epu ネスト select 拡張 + select-before-upsert + diffParticipants + notifyScrapeChanges 結線 + changes/notified レスポンス
- `supabase/functions/tests/e2e_full_chain_test.ts` - 全鎖 E2E テスト（495行）

## Decisions Made

- `answerPersistFailed` フラグを明示導入: `result = answerPersistFailureResult(current)` 差替えだけでは通知側で保存成否を判別できないため bool フラグを追加
- reply ブロックの early return を廃止しフラグ制御に変更: reply の成否に関わらず (d) 通知呼び出しへ到達させる（Pitfall 3 対策）
- E2E teardown 日付アサートを DB クエリ使用: Postgres `current_date` は UTC / Deno `todayJst()` は JST でズレが発生するため `SELECT (current_date + 3)::text` で比較

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] E2E seed participant の status 破壊防止**
- **Found during:** Task 3 (E2E テスト実行時)
- **Issue:** (c) の DB 変異クエリが `event_platform_url_id = SEED_EPU_ID` で参加者を検索するが、seed participant ...0005 も同じ epu に紐付くため先頭に返され、status が 'attending' → 'interested' に変更された。これで `get_confirm_targets()` のターゲットから外れ (d) message-sender が 0 件送信となり assert 失敗。
- **Fix:** クエリに `AND id != SEED_PARTICIPANT_ID` フィルタを追加。setup (a) と teardown (g) でも `status = 'attending'` を明示 UPDATE する冪等リセットを追加。
- **Files modified:** supabase/functions/tests/e2e_full_chain_test.ts
- **Commit:** 2002e8f

**2. [Rule 1 - Bug] E2E teardown 日付アサートの timezone ズレ**
- **Found during:** Task 3 (E2E テスト実行時)
- **Issue:** teardown の `event_date = current_date + 3` 復元後アサートで、Deno 側 `todayJst()` (JST) と Postgres `current_date` (UTC) が JST 午前 0 時〜9 時の時間帯に 1 日ズレる。期待値 2026-06-16 に対して実際値 2026-06-15 でアサート失敗。
- **Fix:** Deno 側での date 計算をやめ、`SELECT (current_date + 3)::text` を DB クエリで取得してアサートに使用。
- **Files modified:** supabase/functions/tests/e2e_full_chain_test.ts
- **Commit:** 2002e8f

---

**Total deviations:** 2 auto-fixed (Rule 1 - Bug x2)
**Impact on plan:** スコープの変更なし。E2E テストの堅牢性が向上。

## Known Stubs

なし — 全関数が実装済み。E2E テスト 2 回連続 green 確認。

## Threat Flags

なし — PLAN.md の `<threat_model>` 全項目（T-04-06〜T-04-10 / T-04-SC）を実装で対処済み。

- T-04-06: console に userId・参加者生データ含まず（`grep -n "console\." notifier.ts | grep userId` = 0 行で機械検査済み）
- T-04-07: notify は reply 後 + try/catch で握る（webhook/scraper の 200 契約不変）
- T-04-08: 1スクレイプ=1サマリ + 初回スキップ + 登録 URL 完全一致で通知スパム律速
- T-04-09: answerPersistFailed=false のとき（=保存成功後）のみ通知に到達（コード順で構造的に担保）
- T-04-10: 既存キー platform/count/saved 不変（changes/notified は追加のみ）
- T-04-SC: 新規パッケージなし

## Self-Check: PASSED

All created/modified files verified, all commit hashes exist.
