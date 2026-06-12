---
phase: 01-foundation-and-scraping
plan: 03
subsystem: edge-functions
tags: [line, webhook, signature, token, deno, deploy]
dependency_graph:
  requires:
    - supabase/config.toml (01-01 — webhook verify_jwt=false)
    - supabase/functions/deno.json (01-01 — zod@4.4.3 import map)
  provides:
    - supabase/functions/_shared/line/signature.ts (validateLineSignature — Web Crypto HMAC-SHA256)
    - supabase/functions/_shared/line/token.ts (issueStatelessToken — LINE v3 stateless token)
    - supabase/functions/webhook/index.ts (LINE webhook receiver — deployed to dev)
    - supabase/functions/message-sender/index.ts (message-sender scaffold — deployed to dev)
    - supabase/functions/tests/line_signature_test.ts (5 unit tests — official test vector)
  affects:
    - Phase 2 LINE Bot core (state machine rides on webhook + token foundation)
    - Any future plan using LINE send/receive
tech_stack:
  added:
    - Web Crypto API (crypto.subtle HMAC-SHA256 — Deno built-in, no new package)
    - zod 4.4.3 (webhook payload validation — already in deno.json from 01-01)
    - Deno test runner (unit tests — built-in)
  patterns:
    - Raw body first (req.text() before JSON.parse) for HMAC-SHA256 webhook signature
    - Constant-time XOR comparison for timing-attack-safe signature verification
    - Stateless LINE token v3 issued on-demand (no caching, no logging of token value)
    - verify_jwt=false for webhook only (config.toml + --no-verify-jwt deploy flag)
    - --import-map flag required for deno.json resolution with --use-api bundler
key_files:
  created:
    - supabase/functions/_shared/line/signature.ts
    - supabase/functions/_shared/line/token.ts
    - supabase/functions/webhook/index.ts
    - supabase/functions/message-sender/index.ts
    - supabase/functions/tests/line_signature_test.ts
    - supabase/functions/deno.lock
  modified: []
decisions:
  - "--import-map supabase/functions/deno.json required: --use-api bundler does not auto-discover deno.json imports map; bare 'zod' import fails without explicit flag"
  - "deno.lock committed: ensures reproducible builds for zod and deno std across environments"
  - "Test uses deno.land/std@0.224.0 assert (not jsr:@std/assert): consistent with existing deno.json import style"
metrics:
  duration: "3 minutes"
  completed: "2026-06-11"
  tasks_completed: 3
  files_created: 6
---

# Phase 1 Plan 03: LINE Webhook + message-sender実装・devデプロイ Summary

**One-liner:** Web Crypto HMAC-SHA256署名検証（公式テストベクタ5ケースPASS）＋zodペイロード検証のwebhook関数とステートレストークンv3発行のmessage-sender雛形をdevへデプロイし、正署名200/不正署名401・tokenIssued:trueを実呼び出しで機械検証。

## What Was Built

### Task 1: 署名検証モジュール + 公式テストベクタによるユニットテスト (TDD)

**RED:** `tests/line_signature_test.ts` を先に作成（signature.tsなし → TS2307エラーで確認）

**GREEN:** `_shared/line/signature.ts` に `validateLineSignature` 実装
- `crypto.subtle.importKey` + `crypto.subtle.sign` でHMAC-SHA256計算
- `btoa(String.fromCharCode(...new Uint8Array(mac)))` でBase64化
- 長さ不一致は即時false、長さ一致時はXOR累積比較（定数時間）
- `@line/bot-sdk` 不使用（grep -c = 0）

5テスト全PASS:
- 公式テストベクタ（body + secret → expected sig）→ true
- 署名1文字変更 → false
- 短い署名（長さ不一致） → false（例外なし）
- body末尾空白追加 → false（raw body改変検知）
- 空署名・空body → false（例外なし）

### Task 2: webhook関数 + token.ts + message-sender雛形

**webhook/index.ts:**
- 処理順序: `await req.text()` → 署名検証401 → `JSON.parse` → zod検証400 → イベント件数ログ → 200
- 非POSTは405、署名なしは401（「invalid signature」ボディで関数由来と判別可能）

**_shared/line/token.ts:**
- `issueStatelessToken(channelId, channelSecret): Promise<string>`
- `POST https://api.line.me/oauth2/v3/token` form-urlencoded
- エラー時はステータスコードのみthrow（レスポンスボディはログしない）

**message-sender/index.ts:**
- `issueStatelessToken` 呼び出し → 200 `{"status":"ok","tokenIssued":true,"expiresIn":900}`
- トークン値は応答・ログに含まれない（`access_token` grep -c = 0）
- push送信はPhase 2（TODOコメント明記）
- JWT検証有効のまま（config.tomlに[functions.message-sender]セクション不追加）

`deno check` 3ファイル全通過（FNS_OK）

### Task 3: secrets投入 + devデプロイ + 実呼び出し検証

**secrets投入:** `supabase secrets set` でLINE_CHANNEL_ID / LINE_CHANNEL_SECRET をenv展開で設定（実値はシェル履歴に残らない）

**デプロイ:**
- `supabase functions deploy webhook --project-ref "$DEV_PROJECT_REF" --use-api --no-verify-jwt --import-map supabase/functions/deno.json`
- `supabase functions deploy message-sender --project-ref "$DEV_PROJECT_REF" --use-api --import-map supabase/functions/deno.json`

**実呼び出し検証（DEPLOY_OK確認）:**
- 正署名POST → HTTP 200 / body: `ok` ✓
- 不正署名POST → HTTP 401 / body: `invalid signature`（関数コード由来）✓
- message-sender POST（Bearer anon key）→ HTTP 200 / `{"status":"ok","tokenIssued":true,"expiresIn":900}` ✓
- `supabase functions list` → webhook / message-sender ともにACTIVE ✓

## Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| 1 RED | 19259c6 | test | failing tests for LINE signature validation (5 cases) |
| 1 GREEN | 18e0719 | feat | implement LINE signature validation with Web Crypto |
| 2 | 783d502 | feat | webhook (signature+zod), token.ts, message-sender scaffold |
| 3 | b528edb | chore | deno.lock + task 3 verification note |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] --use-api bundler が deno.json imports mapを自動解決しない**
- **Found during:** Task 3 (deploy)
- **Issue:** `supabase functions deploy webhook --use-api` でバンドル時に `zod` のbare importが解決できず400エラー: `"Relative import path "zod" not prefixed with / or ./ or ../"`
- **Fix:** デプロイコマンドに `--import-map supabase/functions/deno.json` を追加して明示指定
- **Impact:** webhook/message-senderの両デプロイに同フラグを追加。将来のデプロイコマンドにも必要
- **Files modified:** なし（デプロイコマンドの修正のみ）

## Human TODOs (Post-Deploy Manual Steps)

LINE Developersコンソールへの Webhook URL 設定（機械検証済みのため夜間ブロッカーにしない）:
1. LINE Developers Console > チャネル設定 > Messaging API
2. Webhook URL を `https://cmsxvxtcdniqgvhxjqri.supabase.co/functions/v1/webhook` に設定
3. Webhook の利用: オン
4. 「検証」ボタン → 200 OK を確認（署名付きcurlで既に機械検証済み）

## Success Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Phase 1 成功条件3: 署名検証（正200・不正401）ユニットテスト | PASSED | 5テストPASS（deno test PASS）|
| Phase 1 成功条件3: 署名検証（正200・不正401）実機curl | PASSED | curl 200 (valid sig) / 401 "invalid signature" (bad sig) |
| Phase 1 成功条件4: webhook devデプロイ + 呼び出しログ生成 | PASSED | functions list ACTIVE + curl呼び出し完了 |
| Phase 1 成功条件4: message-sender devデプロイ + 呼び出しログ生成 | PASSED | functions list ACTIVE + tokenIssued:true確認 |
| ステートレストークンv3実発行成功 | PASSED | 200 + {"tokenIssued":true,"expiresIn":900} |
| トークン値の応答/ログ非露出 | PASSED | access_token grep -c = 0 in message-sender |
| 実チャネルシークレット非コミット | PASSED | テストは公式テストベクタのみ。env.devはgitignore済み |

## Known Stubs

- **message-sender push送信**: `message-sender/index.ts` のpushメッセージ送信処理はPhase 2で実装（TODOコメント明記済み）。Phase 1の成功条件（トークン発行確認）は満たしており、雛形としての目的を達成

## Threat Flags

本プランで導入したセキュリティサーフェスはPLANのthreat_modelに記載済み:
- T-01-10 (Spoofing): x-line-signature HMAC-SHA256検証実装 + unit+e2eで実証済み
- T-01-11 (Info Disclosure): access_token非露出 + secrets setはenv展開 + トークンボディ非ログ
- T-01-13 (EoP): verify_jwt=falseはwebhookのみ（config.toml + deployフラグ限定）

## Self-Check: PASSED

Files verified:
- supabase/functions/_shared/line/signature.ts: FOUND
- supabase/functions/_shared/line/token.ts: FOUND
- supabase/functions/webhook/index.ts: FOUND
- supabase/functions/message-sender/index.ts: FOUND
- supabase/functions/tests/line_signature_test.ts: FOUND
- supabase/functions/deno.lock: FOUND

Commits verified:
- 19259c6: test(01-03) RED
- 18e0719: feat(01-03) GREEN
- 783d502: feat(01-03) Task 2
- b528edb: chore(01-03) Task 3
