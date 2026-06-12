---
phase: "03-admin-ui"
plan: "01"
subsystem: "database"
tags: ["rls", "migrations", "mock-auth", "seed", "dev-setup"]
dependency_graph:
  requires: []
  provides: ["rls-write-policies", "register_owner_by_identity-rpc", "oa-members-fk", "completion_message-column", "dev-oa-2-fixture", "mock-users"]
  affects: ["supabase/migrations", "supabase/seed.sql", "scripts/setup-dev.ts"]
tech_stack:
  added: ["deno.json (root-level import map)"]
  patterns: ["SECURITY DEFINER RPC", "RLS with check integrity guard", "idempotent GoTrue admin REST", "(select auth.uid()) initplan optimization"]
key_files:
  created: []
  modified:
    - "supabase/migrations/20260611171037_create_core_tables.sql"
    - "supabase/migrations/20260611171038_enable_rls.sql"
    - "supabase/seed.sql"
    - "scripts/setup-dev.ts"
    - "deno.json"
decisions:
  - "IN-05 FK adopted: oa_members.auth_user_id → auth.users(id) ON DELETE CASCADE"
  - "oa_members excluded from seed.sql; injected by setup-dev.ts after user creation"
  - "register_owner_by_identity uses coalesce(user_name, preferred_username) for A1 key uncertainty"
  - "Root-level deno.json added to enable `deno check scripts/*.ts` without --config flag"
  - "MOCK_USER_PASSWORD generated via openssl rand and appended to env.dev (gitignored)"
metrics:
  duration: "~45 minutes"
  completed: "2026-06-12"
  tasks_completed: 3
  files_modified: 5
---

# Phase 03 Plan 01: RLS本実装 + DB基盤完成 Summary

**One-liner:** IN-05 FK + completion_message列 + 5本の書込RLSポリシー + auth.identitiesベースのowner自動登録RPC + dev-oa-2フィクスチャ + モックユーザー2名をdev DBに再適用。Phase 1-2回帰なし（82テスト全pass）。

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | マイグレーション in-place 拡張 | `5acced3` | `20260611171037_create_core_tables.sql`, `20260611171038_enable_rls.sql` |
| 2 | seed.sql + setup-dev.ts 拡張 | `3da1310` | `supabase/seed.sql`, `scripts/setup-dev.ts`, `deno.json` |
| 3 | [BLOCKING] dev スキーマ再適用 + 回帰検証 | (no file changes) | dev DB |

## What Was Built

### Task 1: Migration in-place Extensions

**20260611171037_create_core_tables.sql:**
- `oa_configs.completion_message text` 追加（OA-01 UI設定画面の完了メッセージ保存先）
- `oa_members.auth_user_id` を `uuid not null references auth.users(id) on delete cascade` に変更（IN-05）

**20260611171038_enable_rls.sql:**
- 既存SELECT 7本の `auth.uid()` を `(select auth.uid())` に書き換え（initplan最適化）
- 書込ポリシー5本追加:
  - `oa_configs_oa_member_update` (UPDATE)
  - `events_oa_member_insert` (INSERT), `events_oa_member_update` (UPDATE)
  - `event_platform_urls_oa_member_insert` (INSERT) — v1はURL追加のみ
  - `participants_oa_member_update` (UPDATE) — with checkでline_user同一OA整合性を強制（ADMIN-02 / T-03-02）
- `register_owner_by_identity()` RPC追加:
  - SECURITY DEFINER + search_path=''
  - auth.identitiesのX screen_name照合（user_metadata不使用 — T-03-01）
  - coalesce(user_name, preferred_username) でA1キー不確実性を吸収
  - on conflict do nothing で冪等
  - revoke all from public, anon; grant to authenticated
- 合計12本のポリシー（SELECT 7 + UPDATE 3 + INSERT 2。DELETE ポリシーなし）

### Task 2: seed.sql + setup-dev.ts

**supabase/seed.sql:**
- dev-oa-2 OA + dev-event-2 + event_platform_urls + line_users + participants 5行追加（固定UUID・冪等）
- answers 1行追加（...0005参加者のq_age回答 — ADMIN-01統合テスト用）
- oa_members は含めない（IN-05 FK のため auth.users 依存）

**scripts/setup-dev.ts:**
- MOCK_USER_PASSWORD / SUPABASE_SERVICE_ROLE_KEY の必須チェック追加（欠如時に明示メッセージでexit 1）
- `ensureUser()`: GoTrue admin REST APIを直接fetchで呼び、422/email_exists時にGETで既存id取得する冪等実装
- モックユーザー2名作成: dev-owner-1（user_name='dev_owner_x'）, dev-owner-2
- oa_members 3行投入（user1→oa1 owner, user2→oa2 owner, user2→oa1 co-owner）

**deno.json（新規）:**
- リポジトリルートにimport map追加（npm:postgres等）
- `deno check scripts/setup-dev.ts` が `--config` フラグなしで動くようになった

### Task 3: dev スキーマ再適用と検証結果

| 検証項目 | 結果 |
|---------|------|
| `supabase db reset --linked --yes` | SUCCESS（dev ref=cmsxvxtcdniqgvhxjqri 確認済み） |
| `setup-dev.ts` 実行1回目 | SUCCESS（ユーザー2名作成 + oa_members 3行） |
| `setup-dev.ts` 実行2回目（冪等確認） | SUCCESS（ユーザー既存確認 + on conflict do nothing） |
| `verify-cron.ts` | SUCCESS（confirm-broadcast-daily 登録確認） |
| Deno回帰テスト | 82 passed / 0 failed / 6 ignored |
| pg_policies 本数 | 12本（期待値12 — OK） |
| register_owner_by_identity | EXISTS, security_definer=true |
| oa_configs.completion_message | EXISTS |
| oa_members FK | oa_members_auth_user_id_fkey → auth.users(id) ON DELETE CASCADE |
| oa_members 行数 | 3行（user1-oa1-owner, user2-oa2-owner, user2-oa1-co-owner） |
| auth.users 行数 | 2名 |
| dev-oa-2 フィクスチャ | EXISTS（id=00000000-0000-0000-0000-000000000011） |
| answers フィクスチャ | 1行（...0006） |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Root-level deno.json が存在しなかった**
- **Found during:** Task 2 verify（`deno check scripts/setup-dev.ts` が npm:postgres 未解決で失敗）
- **Issue:** リポジトリルートに deno.json がなく、`supabase/functions/deno.json` に定義されたimportが scripts/ ディレクトリから参照できなかった
- **Fix:** リポジトリルートに `deno.json` を新規作成（supabase/functions/deno.json と同内容のimport map）
- **Files modified:** `deno.json` (new), `deno.lock` (generated)
- **Commit:** `3da1310`

**2. [Rule 2 - Security] auth.uid() 裸呼び in RPC body**
- **Found during:** Task 1 verify
- **Issue:** register_owner_by_identity() の PLPGSQL 本体内の auth.uid() が (select auth.uid()) でラップされていなかった（受入基準の非コメント行に裸のauth.uid()を出さない）
- **Fix:** RPC内の2箇所（WHERE句のi.user_id参照、INSERT SELECT句のauth.uid()）を (select auth.uid()) でラップ
- **Files modified:** `supabase/migrations/20260611171038_enable_rls.sql`
- **Commit:** `5acced3`（事前修正済み）

**3. [Rule 3 - Blocking] seed.sql のコメントに "oa_members" が含まれていた**
- **Found during:** Task 2 verify（`! grep -rn "oa_members" supabase/seed.sql` が FAIL）
- **Issue:** dev-oa-2フィクスチャのコメントに "oa_members はここに入れない" というコメントが含まれ、自動検証がfalse positiveで失敗
- **Fix:** コメントから "oa_members" という語を除去（意味は保持）
- **Files modified:** `supabase/seed.sql`
- **Commit:** `3da1310`

**4. [Execution] MOCK_USER_PASSWORD を env.dev に自動生成・追記**
- **Found during:** Task 3 実行前
- **Issue:** env.dev に MOCK_USER_PASSWORD が存在しなかった
- **Fix:** `openssl rand -base64 18` でランダム値を生成し env.dev に追記（gitignored）
- **Files modified:** `/Users/kugyu10/work/nomimas-bot/env.dev`（gitignore対象。コミットなし）

## Known Stubs

なし。全フィクスチャデータは実際の値（固定UUID・実在するOAデータ構造）。

## Threat Flags

なし（計画の脅威モデル通りに実装済み）。

| Threat ID | Status |
|-----------|--------|
| T-03-01 (user_metadata偽装) | MITIGATED: register_owner_by_identity は auth.identities のみ参照 |
| T-03-02 (participants紐付けTampering) | MITIGATED: with check で line_users.oa_config_id 同一OA強制 |
| T-03-03 (全テーブルRLS) | MITIGATED: INSERT/UPDATE の with check を using と同形 |
| T-03-04 (MOCK_USER_PASSWORD流出) | MITIGATED: env.dev (gitignored) のみ。コード/ログに値なし |
| T-03-05 (prod誤接続) | MITIGATED: connectDev() の ref ガード + Task 3 冒頭で手動確認 |

## Self-Check: PASSED

- [x] `supabase/migrations/20260611171037_create_core_tables.sql` 存在確認
- [x] `supabase/migrations/20260611171038_enable_rls.sql` 存在確認
- [x] `supabase/seed.sql` 存在確認
- [x] `scripts/setup-dev.ts` 存在確認
- [x] `deno.json` 存在確認
- [x] commit `5acced3` 存在確認（Task 1）
- [x] commit `3da1310` 存在確認（Task 2）
- [x] pg_policies = 12本（dev DB確認済み）
- [x] register_owner_by_identity EXISTS + security_definer=true
- [x] oa_configs.completion_message 列 EXISTS
- [x] oa_members FK → auth.users(id) ON DELETE CASCADE
- [x] Deno 82テスト全pass
