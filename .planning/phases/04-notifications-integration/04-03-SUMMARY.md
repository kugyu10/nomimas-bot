---
phase: 04-notifications-integration
plan: 03
subsystem: admin-ui + integration-tests
tags: [typescript, react, zod, supabase, rls, vitest, template-ui, root-rbac]

# Dependency graph
requires:
  - phase: 04-01
    provides: "question_templates テーブル, root_users テーブル, notification_logs テーブル, is_root() SECURITY DEFINER, dev-root@nomimas.test"
provides:
  - "questionsSchema export from oa.ts (T-03-14 同型性維持)"
  - "templateSchema (name max100 + questionsSchema 同一バリデーション)"
  - "listQuestionTemplates: フィルタなし SELECT (RLS oa_members チェーン自動スコープ)"
  - "saveQuestionTemplate: server action (zod 再検証 → INSERT → revalidatePath)"
  - "template-save-dialog.tsx: 04-UI-SPEC §1 準拠 (保存しない / テンプレートとして保存)"
  - "template-apply-select.tsx: 04-UI-SPEC §2 準拠 (適用しない / テンプレートを適用)"
  - "rls.test.ts: root 横断閲覧 + SELECT-only + root_users 不可視 + question_templates + notification_logs"
  - "data.test.ts: listQuestionTemplates クロスOA 適用候補テスト (user2 両OA取得 / user1 OA1 のみ)"
affects:
  - "04-04: 同 admin/ に影響なし (独立 UI 修正)"
  - "04-02: data/templates.ts を間接利用可 (notification_logs RLS は固定UUID でスコープ)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TemplateSaveDialog: controlled Dialog + form onSubmit + server action呼び出し"
    - "TemplateApplySelect: AlertDialog 確認フロー + クライアント state 置換"
    - "TDD RED → GREEN: schema/data/action 層を単体テスト先行で実装"
    - "RLS asUser ハーネス: rootId を root_users から動的取得し全テーブル横断 SELECT を検証"
    - "parallel-safe fixture: 固定UUID + where id = FIXTURE_LOG_ID で波2並列と衝突なし"

# Key files
key-files:
  created:
    - admin/lib/schemas/template.ts
    - admin/lib/data/templates.ts
    - admin/lib/actions/templates.ts
    - admin/components/oa/template-save-dialog.tsx
    - admin/components/oa/template-apply-select.tsx
    - admin/tests/unit/template-schema.test.ts
  modified:
    - admin/lib/schemas/oa.ts (questionsSchema を export に切り出し)
    - admin/components/oa/question-list-editor.tsx (template props + アクションエリア flex)
    - admin/components/oa/oa-settings-form.tsx (templates prop + saveTemplateAction 結線)
    - admin/app/(app)/oa/settings/page.tsx (RSC Promise.all → templates prop 渡し)
    - admin/tests/integration/rls.test.ts (root 軸 + templates + notification_logs 追記)
    - admin/tests/integration/data.test.ts (user2 sign-in + listQuestionTemplates クロスOA)

# Decisions
decisions:
  - "saveTemplateAction を prop として QuestionListEditor に注入（server action の直接 import を避け test 容易性を確保）"
  - "TemplateApplySelect の onApply コールバック: onChange と同一型 (QuestionItem[]) で結線し controller 不変"
  - "notification_logs fixture に固定UUID = aaaaaaaa-0403-0403-0403-000000000001 を割り当て（波2 並列衝突防止）"
  - "pre-existing failure: data.test.ts の getParticipantsWithAnswers テストは dev 環境の seed answers が空であるため以前から失敗（04-03 の変更に無関係）"

# Metrics
metrics:
  duration: "~40 minutes"
  completed: "2026-06-13"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 6
---

# Phase 04 Plan 03: 質問テンプレートUI + root権限RLSテスト Summary

**One-liner:** questionsSchema export + templateSchema/data/action + UI-SPEC §1&§2 準拠の保存/適用 Dialog + root 横断閲覧・SELECT-only・OA スコープの RLS 自動テスト完備

## What was built

### Task 1: questionsSchema 切り出し + templateSchema + data/action 層 (TDD)

**RED → GREEN サイクル:**
- `admin/tests/unit/template-schema.test.ts` を先に書き、`templateSchema` / `questionsSchema` の import が解決できないことで RED を確認してからコミット
- 実装: `oaSettingsSchema` のインライン questions 配列スキーマを `questionsSchema` として export に切り出し（T-03-14 同型性維持）、`template.ts` で `questionsSchema` を import して再利用
- `listQuestionTemplates`: `.eq()` フィルタなし SELECT（RLS の oa_members チェーンが自動スコープ）
- `saveQuestionTemplate`: `saveOaSettings` と同型の server action（zod 再検証 → INSERT `.select("id")` → revalidatePath）

**テスト結果:** template-schema.test.ts 16件 + oa-schema.test.ts 18件 = 34件 green / tsc clean

### Task 2: テンプレート保存 Dialog + 適用 Select UI

**04-UI-SPEC §1 準拠（template-save-dialog.tsx）:**
- トリガー: BookmarkPlus アイコン + 「テンプレートとして保存」(variant=outline size=sm)
- 質問 0件時は disabled + Tooltip「質問がありません」
- Dialog: テンプレート名 Input (autoFocus) + ヘルパー「現在の質問 {n} 件を保存します」
- footer: [保存しない(ghost)][テンプレートとして保存(default)] — canonical ラベル厳守
- 保存成功: Dialog close → 親 Alert「テンプレートを保存しました」4秒 auto-dismiss
- 失敗時: Dialog 維持 + footer 下 destructive 文言

**04-UI-SPEC §2 準拠（template-apply-select.tsx）:**
- セクションラベル「テンプレートを適用」(muted)
- Select: placeholder「テンプレートを選択...」/ option「{名前}（{n}件の質問）」
- 空時: disabled option「保存済みテンプレートがありません」
- AlertDialog: [適用しない(outline)][テンプレートを適用(default)]
- confirm: onChange クライアント置換 + Select リセット（サーバー呼び出しなし — Locked）

**結線:**
- `question-list-editor.tsx`: oaConfigId / templates / saveTemplateAction props 追加（既存 value/onChange 契約は不変）
- `oa-settings-form.tsx`: saveQuestionTemplate import + templates prop 渡し
- `page.tsx`: Promise.all([getOaSettings, listQuestionTemplates]) → OaSettingsForm

**検証:** tsc clean + Next.js build green

### Task 3: RLS root 軸 + テンプレート/通知ログ RLS + クロスOA data テスト

**rls.test.ts 追加（14テスト）:**

1. **root 横断閲覧 describe（成功条件3・OA-02 完成）:**
   - root が両OA の oa_configs = 2行 / 同クエリで owner(user1) = 1行（権限差対比 assert が同一テスト内）
   - root events 2行以上 / OA1 participants 1行以上
   - root の oa_configs UPDATE = 0行（SELECT-only 構造的担保）
   - root の events INSERT = エラー（with check 違反）
   - root_users が root（authenticated）からも 0行（存在秘匿）
   - user1 が root_users へ INSERT できない（権限昇格防止）

2. **question_templates RLS describe（4テスト）:**
   - user1: OA2 テンプレ SELECT 0行 / OA2 INSERT reject
   - user1: 自OA(OA1) INSERT 成功（afterAll で削除）
   - root: 両OA テンプレ全件 SELECT

3. **notification_logs RLS describe（3テスト）:**
   - 固定UUID `aaaaaaaa-0403-0403-0403-000000000001` でフィクスチャ投入
   - user1: 0行（OA1 owner は OA2 ログ不可視）
   - root: 1行（全OA横断）
   - user1: INSERT reject（書込ポリシーなし）

**data.test.ts 追加（2テスト）:**
- `listQuestionTemplates` cross-OA: user2（OA2 owner + OA1 co-owner）→ 両OA テンプレ含む
- user1（OA1 owner のみ）→ OA1 分のみ / OA2 分は含まれない

**検証:** rls.test.ts 35件（既存 21 + 新規 14）全 green / data.test.ts 新規 2件 green

## Deviations from Plan

### Pre-existing Issue (Out of Scope)

`data.test.ts > getParticipantsWithAnswers > user1 が dev-event (OA-1) の参加者を回答ネスト付きで取得できる` テストが dev 環境で失敗している（seed participant ...0005 の answers が空 = 0件）。

- **原因:** dev の seed answers がクリアされた状態（`select count(*) from public.answers where participant_id = '00000000-0000-0000-0000-000000000005'` = 0）
- **影響:** 04-03 の変更に無関係（このテストは Task 3 実装前から失敗していた）
- **対応:** 記録のみ。復元は E2E フローが answers を書き込む際に自然に解消するか、setup-dev の再実行で修復可能
- **04-03 の新規テストへの影響:** なし（全 green）

## Threat Surface Scan

新規ネットワークエンドポイントなし。`saveQuestionTemplate` server action は `templateSchema`（= `questionsSchema` 再利用）でサーバー再検証済み（T-04-11 Tampering 対策実施）。`template-apply-select.tsx` にサーバー呼び出しなし（UI-SPEC Locked）。

| Threat ID | Mitigation Status |
|-----------|------------------|
| T-04-11 (テンプレート注入) | ✓ templateSchema でサーバー再検証。unit テスト 16件で oaSettingsSchema との同一性を検証 |
| T-04-12 (root 権限昇格) | ✓ root_users INSERT 不可 / root UPDATE 0行 / root INSERT reject の5系統が rls.test.ts で自動検証 |
| T-04-13 (クロスOA 情報漏えい) | ✓ user1 が OA2 テンプレ 0行を rls.test.ts で検証 |
| T-04-14 (owner スコープ退行) | ✓ 既存 21テスト無修正 green |

## Self-Check

**Created files:**
- admin/lib/schemas/template.ts: FOUND
- admin/lib/data/templates.ts: FOUND
- admin/lib/actions/templates.ts: FOUND
- admin/components/oa/template-save-dialog.tsx: FOUND
- admin/components/oa/template-apply-select.tsx: FOUND
- admin/tests/unit/template-schema.test.ts: FOUND

**Commits:**
- 1f17b45: test(04-03): add failing test for templateSchema + questionsSchema export [RED]
- 7ade196: feat(04-03): questionsSchema export + templateSchema + data/actions layers [GREEN]
- b511d9e: feat(04-03): template save dialog + apply select UI (04-UI-SPEC §1&§2)
- 06395ee: feat(04-03): RLS root axis + template/notification_logs RLS + cross-OA data tests

## Self-Check: PASSED
