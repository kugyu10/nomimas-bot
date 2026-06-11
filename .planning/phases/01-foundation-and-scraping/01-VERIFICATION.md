---
phase: 01-foundation-and-scraping
verified: 2026-06-12T00:00:00Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "LINE Developers Console へ Webhook URL を登録し、Verify ボタンで 200 を確認する"
    expected: "LINE コンソールの Verify 応答が 200 OK になる"
    why_human: "LINE Developers Console への URL 登録は GUI 操作が必要でプログラムから確認できない。署名付き curl での機械検証は完了済み（正署名 200 / 不正署名 401 を実機確認）"
---

# Phase 1: foundation-and-scraping Verification Report

**Phase Goal:** 最大リスク（Twiplaスクレイピング）が実証され、DB・Edge Functions・LINE Webhookの土台がdev環境で動作している
**Verified:** 2026-06-12
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | cheerioによるTwiplaスクレイピングで `a.card.namelist` から参加者名・Xアカウント名リストを正しく取得できる（フィクスチャHTMLに対する自動テストがパスし、実Twipla URLでも取得を確認。プロバイダー抽象化インターフェース経由で実装） | VERIFIED | `deno test` 12 passed / 1 ignored (live gated). フィクスチャテスト: attending=2, interested=2, capacity=15 が正しく分離。実URL: `{"platform":"twipla","count":4,"saved":true}` を確認。`scraper/index.ts` に `"twipla"` リテラルなし（grep count=0）、`resolveProvider` 呼び出し確認。`div.member_list` セクションスコープ実装確認 |
| 2 | 本番スキーマ（events / event_platform_urls / participants / line_users / oa_configs / answers）がマイグレーションでゼロから再現できる（`supabase db reset` が成功し、全テーブルとRLSポリシーが存在する） | VERIFIED | `migrations/20260611171037_create_core_tables.sql` に `create table` が7回（6必須+oa_members）。`migrations/20260611171038_enable_rls.sql` に `enable row level security` 7回・`create policy` 7回。`participants` に `natural_key text not null` + `unique(event_platform_url_id, natural_key)`（CR-01対応済み、commit 4330526）。実スクレイパーが `saved:true` を返したことでDB書き込みが成功 → live DBスキーマ整合確認 |
| 3 | LINE WebhookのEdge Functionが署名検証をパスしてメッセージを受信できる（正しい署名は200・不正な署名は拒否されることがテストで検証できる） | VERIFIED | 署名検証ユニットテスト6本全PASS（LINE公式テストベクタ含む）。deployed関数への実呼び出し: 正署名 → HTTP 200、不正署名 → HTTP 401 `invalid signature`（関数コード由来）を実機確認 |
| 4 | Edge Functions 3本（webhook / scraper / message-sender）がdev Supabaseプロジェクトにデプロイされ、呼び出しログが確認できる | VERIFIED | `supabase functions list` にwebhook/scraper/message-sender の3本がACTIVEで表示。message-senderが `{"status":"ok","tokenIssued":true,"expiresIn":900}` を返し実トークン発行成功。scraper が `{"platform":"twipla","count":4,"saved":true}` を返し実URL取得+DB保存確認 |
| 5 | リポジトリ初期化時に `.gitignore` が env.dev / env.prod を除外しており、シークレットがコミット対象に含まれない（リポジトリはpublic） | VERIFIED | `git check-ignore env.dev env.prod` → 両ファイルを出力（exit 0）。`git ls-files \| grep -E '^env.(dev\|prod)$'` → 空。`grep -rl 'hgojtooexbknqotzkkja' supabase/` → 空（prod refは.planningドキュメントにのみ存在し、supabase/配下のコードには不在）。`config.toml` に service_role / postgres:// なし |

**Score:** 5/5 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/config.toml` | `[functions.webhook] verify_jwt = false` + webhookセクション | VERIFIED | `grep -A1 '[functions.webhook]'` → `verify_jwt = false` 確認 |
| `supabase/functions/deno.json` | cheerio@1.2.0 / zod@4.4.3 / @supabase/supabase-js@2.108.1 | VERIFIED | imports完全一致確認 |
| `supabase/migrations/20260611171037_create_core_tables.sql` | 7テーブルDDL + updated_atトリガー（CR-01/WR-05対応込み） | VERIFIED | create table 7回、natural_key列、set_updated_atトリガー定義確認 |
| `supabase/migrations/20260611171038_enable_rls.sql` | RLS有効化7本 + SELECTポリシー7本 | VERIFIED | enable row level security 7回・create policy 7回確認 |
| `supabase/functions/_shared/providers/types.ts` | ParticipantListProvider / ScrapedParticipant / ScrapeResult / ParticipantStatus export | VERIFIED | 全4型のexport確認 |
| `supabase/functions/_shared/providers/twipla.ts` | parseTwiplaHtml / twiplaProvider export、div.member_listスコープ | VERIFIED | export確認、member_list grep count=2、ポート拒否(WR-02)・タイムアウト(WR-04)・空displayName除外(WR-06)対応済み |
| `supabase/functions/_shared/providers/registry.ts` | resolveProvider export | VERIFIED | resolveProvider export確認、dead code除去(IN-01)済み |
| `supabase/functions/_shared/supabase.ts` | createServiceClient + 明示エラー（IN-04対応） | VERIFIED | throw Error on missing env確認 |
| `supabase/functions/scraper/index.ts` | resolveProvider経由・natural_key upsert・maybeSingle(WR-03) | VERIFIED | resolveProvider呼び出し2回、natural_key upsert、maybeSingle+epuError 500対応確認 |
| `supabase/functions/_shared/line/signature.ts` | validateLineSignature export、空シークレットガード(WR-01)、crypto.subtle使用 | VERIFIED | crypto.subtle grep count=2、空シークレットガード確認、@line/bot-sdk不使用確認 |
| `supabase/functions/_shared/line/token.ts` | issueStatelessToken export、https://api.line.me/oauth2/v3/token、形状検証(WR-08) | VERIFIED | endpoint完全一致、typeof json.access_token検証確認 |
| `supabase/functions/webhook/index.ts` | validateLineSignature使用、raw body先行、401分岐、env未設定500(WR-01) | VERIFIED | validateLineSignature呼び出し2回確認、await req.text()がJSON.parseより前確認、env未設定500確認 |
| `supabase/functions/message-sender/index.ts` | issueStatelessToken使用、access_token非露出、env欠落500(IN-03) | VERIFIED | issueStatelessToken呼び出し3回確認、access_token grep count=0確認、env欠落500ガード確認 |
| `supabase/functions/tests/fixtures/twipla_event.html` | member_list 3セクション、twimg 0件、s属性全件testuser* | VERIFIED | member_list count=3、twimg count=0、testuser grep hits確認 |
| `supabase/functions/tests/twipla_parser_test.ts` | フィクスチャ6テスト + canHandle境界テスト | VERIFIED | 6テスト全PASS(deno test実行) |
| `supabase/functions/tests/twipla_live_test.ts` | LIVE_TEST=1オプトイン(WR-07) | VERIFIED | LIVE_TEST条件確認、deno testで ignored表示 |
| `supabase/functions/tests/line_signature_test.ts` | 公式テストベクタ5ケース+空シークレット1ケース = 6テスト | VERIFIED | 6テスト全PASS(deno test実行) |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scraper/index.ts` | `_shared/providers/registry.ts` | `resolveProvider(url)` | WIRED | grep count=2確認、twipla固有コードなし |
| `_shared/providers/twipla.ts` | `div.member_list` セクション | cheerio `$("div.member_list").each` | WIRED | member_list grep count=2確認 |
| `scraper/index.ts` | `public.participants` | `supabase.upsert(rows, { onConflict: "event_platform_url_id,natural_key" })` | WIRED | upsert + natural_key確認。実呼び出し saved:true で動作実証 |
| `webhook/index.ts` | `_shared/line/signature.ts` | `await req.text()` 先行 → `validateLineSignature` | WIRED | validateLineSignature呼び出し2回確認、raw body先行確認 |
| `message-sender/index.ts` | `https://api.line.me/oauth2/v3/token` | `issueStatelessToken(LINE_CHANNEL_ID, LINE_CHANNEL_SECRET)` | WIRED | issueStatelessToken呼び出し確認、endpoint完全一致確認。実呼び出しでtokenIssued:true実証 |
| `supabase/config.toml [functions.webhook] verify_jwt=false` | deployed webhook | `--no-verify-jwt` フラグ二重指定 | WIRED | 署名なし（bad=）POSTが401を返し、Supabaseゲートウェイではなく関数コード由来のボディ `invalid signature` で到達確認 |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `scraper/index.ts` | `result.participants` | `provider.fetchParticipants(url)` → Twipla HTML parse → `parseTwiplaHtml()` | Yes — 実URL呼び出しでcount=4, saved:trueを確認 | FLOWING |
| `webhook/index.ts` | `payload.events` | `JSON.parse(rawBody)` → zod検証。Phase 1はログのみ | Yes — ただしPhase 1はイベント件数ログのみ。ストレージへのデータ保存はPhase 2スコープ | FLOWING (Phase 1 scope) |
| `message-sender/index.ts` | `access_token` (internal) | `issueStatelessToken()` → LINE API v3 | Yes — tokenIssued:true実機確認 | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Twiplaパーサーテスト全PASS | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` | 12 passed / 0 failed / 1 ignored | PASS |
| 署名検証テスト全PASS | （上記同一実行） | 6 passed | PASS |
| scraper 実URL → 200 + saved:true | `curl POST $BASE/scraper {"url":"https://twipla.jp/events/731057"}` | `{"platform":"twipla","count":4,"saved":true}` | PASS |
| scraper SSRF防止 → 400 | `curl POST $BASE/scraper {"url":"https://example.com/"}` | HTTP 400 | PASS |
| webhook 正署名 → 200 | `curl POST $BASE/webhook -H "x-line-signature: $SIG"` | HTTP 200 | PASS |
| webhook 不正署名 → 401 | `curl POST $BASE/webhook -H "x-line-signature: bad="` | HTTP 401 `invalid signature` | PASS |
| message-sender tokenIssued → 200 | `curl POST $BASE/message-sender -H "Authorization: Bearer $ANON_KEY"` | `{"status":"ok","tokenIssued":true,"expiresIn":900}` | PASS |
| functions list = 3本ACTIVE | `supabase functions list --project-ref $DEV_PROJECT_REF` | webhook/scraper/message-sender ACTIVE | PASS |
| git hygiene | `git check-ignore env.dev env.prod` + `git ls-files \| grep env.*` | 両ファイル除外確認、ls-files空 | PASS |
| prod ref 不在（supabase/） | `grep -rl 'hgojtooexbknqotzkkja' supabase/` | 空（.planning/文書にのみ存在） | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| EVENT-02 | 01-02, 01-03 | 管理者はイベントプラットフォームURLから参加者リストを自動取得できる（v1はTwiplaスクレイピング。プロバイダー抽象化で実装） | SATISFIED | ParticipantListProvider / twiplaProvider / resolveProvider 実装完了。cheerio + div.member_list セクションスコープで attending/interested/declined 正確分離。scraper Edge Function devデプロイ + 実URL取得DB保存まで実証。SSRF防止（canHandle hostname許可リスト + zod z.url() + redirect:error）実装済み |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `message-sender/index.ts` | 7 | `TODO(Phase 2): push送信実装` | Info | 意図的な未実装。Phase 2で対処予定と明記済み。Phase 1の成功条件（トークン発行確認）は充足 |

No `TBD`, `FIXME`, or `XXX` markers found in any tracked supabase/ files. The `TODO(Phase 2)` marker is intentional and references a formal future phase.

---

## Human Verification Required

### 1. LINE Developers Console Webhook URL 登録

**Test:** LINE Developers Console > チャネル設定 > Messaging API の Webhook URL に `https://cmsxvxtcdniqgvhxjqri.supabase.co/functions/v1/webhook` を設定し、「Webhook の利用: オン」にして「検証」ボタンを押す
**Expected:** 検証ダイアログが 200 OK を返す
**Why human:** LINE Developers Console は GUI 操作が必要であり、プログラムから確認できない。なお署名付き curl での機械検証（正署名 200 / 不正署名 401）は自動テストで完了済みのため、このアイテムは機能の正当性ではなく運用設定の確認のみ

---

## Code Review Compliance

Phase 1 のコードレビュー（01-REVIEW.md）で発見された 18 件の知見のうち 14 件が修正済み（commit 4330526〜d27b2a6）:

- **CR-01 FIXED (4330526):** participants の unique キーを `display_name` から `natural_key`（screen_name ?? 'dn:'+display_name）に変更。バッチ内重複 last-wins 除去実装
- **WR-01〜WR-08 FIXED:** 全8件の Warning 修正済み（空シークレットガード / ポート拒否 / maybeSingle / タイムアウト / updated_at トリガー / displayName 空文字正規化 / live テストゲート / token 形状検証）
- **IN-01〜IN-04, IN-07 FIXED:** 5件の Info 修正済み
- **IN-05, IN-06, IN-08, IN-09 DEFERRED:** 4件は後続フェーズ（Phase 2/3）で対処予定（oa_members FK、line_users multi-OA、URL正規化、スクレイプ削除者処理）。いずれも Phase 1 の動作には影響なし

---

## Gaps Summary

自動検証可能なすべての must-have が VERIFIED。Human verification item は 1 件（LINE Console webhook URL 登録）のみで、機能の正確性ではなく運用設定確認のみ。

---

_Verified: 2026-06-12_
_Verifier: Claude (gsd-verifier)_
