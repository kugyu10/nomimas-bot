---
phase: 04-notifications-integration
verified: 2026-06-13T06:52:00Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "実LINE通知受信確認"
    expected: "LINE_DRY_RUN解除後にdev webhookへ実際にpostbackすると、オーナーのLINEアカウントへ通知が届く"
    why_human: "実LINE受信はDRY_RUNフラグを外した実環境でしか確認できない。テストスイートはLINE_DRY_RUN=1で実行するためpushが実際に届くかはコード検査では確認不可"
  - test: "実ブラウザでのテンプレート保存→再利用フロー"
    expected: "テンプレートとして保存→別OA切替→テンプレートを適用→設定を保存、の一連フローが実ブラウザで動作する"
    why_human: "TemplateApplySelect/TemplateSaveDialogのUI挙動（AlertDialogの表示・Select操作・4秒auto-dismiss）はbuildが通ることで存在は確認済みだがインタラクション品質は人間が要確認"
  - test: "Vercelデプロイ"
    expected: "admin/ をVercelにデプロイし、本番に近い環境でUIが正常動作する"
    why_human: "Vercelアカウント認証が必要なため自動検証不可。04-04 SUMMARYの朝のTODOに明記済み"
---

# Phase 4: 通知 + 統合仕上げ — Verification Report

**Phase Goal:** 主催者への更新通知・テンプレート再利用・root横断管理が動作し、実Twipla URLでのE2E通しで本番運用に耐える
**Verified:** 2026-06-13T06:52:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 開催2日前以降の更新でowner/co-ownerへ通知が届き、2日前より前では通知されない（テスト検証済み） | VERIFIED | E2E step(e): notification_logs kind='answer'/'completion' assert pass / step(f): window-out event の notification_logs COUNT=0 assert pass。窓境界ユニット: notify_window_test.ts 8ケース(diff=0/1/2→通知, diff=3/-1/null→非通知) green |
| 2 | 定型質問テンプレートを保存し、別イベント・別OAで再利用できる | VERIFIED | templateSchema/listQuestionTemplates/saveQuestionTemplate 実装済み。template-save-dialog.tsx+template-apply-select.tsx がquestion-list-editor.tsx に結線。data.test.ts: user2(OA2 owner+OA1 co-owner)で両OAのテンプレートが返ることをアサート。RLS_TEST 121件 green。npm run build green |
| 3 | rootユーザーは全OA・全イベント・全データを横断閲覧でき、owner/co-ownerとの権限差がテストで検証できる | VERIFIED | rls.test.ts describe「root 横断閲覧（OA-02完成・成功条件3）」: root=oa_configs 2行 / user1=1行の対比assert、root UPDATE 0行、root INSERT reject、root_users不可視、root_users INSERT 不可の5系統。RLS_TEST 121件 green |
| 4 | 実Twipla URLを使ったE2E全鎖（スクレイピング→紐付け→配信→1問1答→保存→通知→管理画面）が成功する | VERIFIED | E2E_TEST=1 LINE_DRY_RUN=1 deno test e2e_full_chain_test.ts: 1 passed, 0 failed (6s)。実URL https://twipla.jp/events/731057 スクレイプ→seed紐付け→message-sender配信→postback×3→answers保存→notification_logs assertの全鎖 green |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/functions/_shared/notify/window.ts` | todayJst()+isWithinNotifyWindow() 純関数 | VERIFIED | 30行。isWithinNotifyWindow: UTCミッドナイト差分で整数日数計算。8ケースunit green |
| `supabase/functions/_shared/notify/diff.ts` | diffParticipants() 純関数 | VERIFIED | 47行。ExistingRow/DiffResult型。IN-01: display_name除去済み |
| `supabase/functions/_shared/notify/messages.ts` | 通知文面純関数（3要素のみ） | VERIFIED | 43行。userId引数なし（型でPII漏洩防止） |
| `supabase/functions/_shared/notify/notifier.ts` | notifyConfirmUpdate+notifyScrapeChanges | VERIFIED | 365行。窓外はnotification_logs INSERT前にreturn。oa_members SELECT失敗を0行に偽装しない(WR-04修正済み) |
| `supabase/functions/tests/e2e_full_chain_test.ts` | 全鎖E2E（4系統assert） | VERIFIED | 524行(>150行要件充足)。窓内/窓外/scrape差分/二重通知防止。E2E green |
| `supabase/migrations/20260611171037_create_core_tables.sql` | root_users/question_templates/notification_logs/oa_members.line_user_id | VERIFIED | 全テーブル・列の定義を確認 |
| `supabase/migrations/20260611171038_enable_rls.sql` | is_root() + SELECT 9本のOR拡張 | VERIFIED | `or (select public.is_root())` が9箇所（grep確認） |
| `admin/lib/schemas/template.ts` | templateSchema（questionsSchema再利用） | VERIFIED | questionsSchema import確認。templateSchema = name+questions |
| `admin/lib/schemas/oa.ts` | questionsSchema export切り出し | VERIFIED | line 70: `export const questionsSchema` |
| `admin/lib/actions/templates.ts` | saveQuestionTemplate server action | VERIFIED | 実装済み |
| `admin/lib/data/templates.ts` | listQuestionTemplates（フィルタなし） | VERIFIED | .eq()フィルタなし確認済み（RLSがスコープ） |
| `admin/components/oa/template-save-dialog.tsx` | テンプレート保存Dialog（UI-SPEC §1） | VERIFIED | TemplateSaveDialog: question-list-editor.tsx line 304で結線済み |
| `admin/components/oa/template-apply-select.tsx` | テンプレート適用Select（UI-SPEC §2） | VERIFIED | onApply→onChange クライアント置換。サーバー呼び出しなし確認済み(grep count=0) |
| `admin/app/(app)/events/loading.tsx` | イベント一覧スケルトン | VERIFIED | Skeleton+aria-busy=true。build green |
| `admin/app/(app)/events/[id]/loading.tsx` | イベント詳細スケルトン | VERIFIED | 存在確認済み |
| `admin/app/(app)/oa/settings/loading.tsx` | OA設定スケルトン | VERIFIED | 存在確認済み |
| `scripts/setup-dev.ts` | dev-root投入+line_user_id設定+dev refガード | VERIFIED | WR-03修正済み: ref!=='cmsxvxtcdniqgvhxjqri'でABORT |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `supabase/migrations/20260611171038_enable_rls.sql` | 既存SELECT ポリシー7本+新テーブル2本 | `or (select public.is_root())` | VERIFIED | grep: 9箇所ヒット |
| `supabase/functions/webhook/index.ts` | `_shared/notify/notifier.ts` | reply送信後のnotifyConfirmUpdate | VERIFIED | line 38: import / line 459: 呼び出し (reply後) |
| `supabase/functions/scraper/index.ts` | `_shared/notify/notifier.ts` | diffParticipants→notifyScrapeChanges | VERIFIED | line 8-9: import / line 152,167: 呼び出し |
| `notifier.ts` | `notification_logs` | 送信実行時のみINSERT（窓外は書かない） | VERIFIED | 窓外return(line12 コメント確認) / INSERT=line 131,183,272 |
| `admin/lib/schemas/template.ts` | `admin/lib/schemas/oa.ts` | questionsSchema import | VERIFIED | line 9: `import { questionsSchema } from "@/lib/schemas/oa"` |
| `admin/app/(app)/oa/settings/page.tsx` | `admin/lib/data/templates.ts` | RSCでlistQuestionTemplates→prop渡し | VERIFIED | line 13,39: Promise.all でlistQuestionTemplates |
| `admin/components/oa/template-apply-select.tsx` | question-list-editor の onChange | onApply→handleApplyTemplate→onChange | VERIFIED | question-list-editor.tsx line 160-165 |
| `admin/components/oa-selector.tsx` | `router.refresh()` | useTransition で包みisPending中Loader2表示 | VERIFIED | line 3,28,35: useTransition+startTransition |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `template-save-dialog.tsx` | saveTemplateAction | saveQuestionTemplate server action → question_templates INSERT | Yes — zod再検証+INSERT | FLOWING |
| `template-apply-select.tsx` | templates prop | RSC listQuestionTemplates → question_templates SELECT | Yes — フィルタなしSELECT (RLSスコープ) | FLOWING |
| `e2e_full_chain_test.ts` | notification_logs rows | webhook/scraper経由でINSERT | Yes — E2E green (4系統assertpass) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Deno 全件テスト（notify unit含む） | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` | 105 passed, 0 failed | PASS |
| admin vitest（非RLS） | `npx vitest run` (in admin/) | 76 passed, 0 failed | PASS |
| RLS_TEST マトリクス（root軸含む） | `RLS_TEST=1 npx vitest run` | 121 passed, 0 failed | PASS |
| Next.js build | `npm run build` | green (9 routes) | PASS |
| E2E 全鎖 | `E2E_TEST=1 LINE_DRY_RUN=1 deno test e2e_full_chain_test.ts` | 1 passed, 0 failed (6s) | PASS |
| zinc ハードコードなし | `grep -rn "bg-zinc-900\|hover:bg-zinc-800\|..."` | 0 hits | PASS |
| 二重プラスCTAなし | `grep -rn "+ イベントを作成\|+URL追加"` | 0 hits | PASS |
| aria-label="URLを削除"存在 | `grep -q 'aria-label="URLを削除"' event-form-dialog.tsx` | match found | PASS |
| ログイン文言locked | `grep -q "メールアドレスまたはパスワードが正しくありません" login/page.tsx` | match found | PASS |
| ステータス列削除 | `grep -n "ステータス" events-table.tsx` | 0 hits | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| NOTIF-01 | 04-01, 04-02, 04-04 | 開催2日前以降、owner/co-ownerにLINEで都度通知 | SATISFIED | window.ts+diff.ts+notifier.ts実装。E2E step(e)/(f)で窓内/窓外対比。RLS_TEST+E2E全green |
| OA-03 | 04-03, 04-04 | 定型質問テンプレートを保存・再利用できる | SATISFIED | templateSchema+listQuestionTemplates+saveQuestionTemplate+UI。data.test.ts クロスOA。RLS 4テスト green |
| OA-02 (root完成) | 04-01, 04-03 | root権限による全OA横断閲覧 | SATISFIED | is_root() SECURITY DEFINER + 9本OR拡張。rls.test.ts「root横断閲覧」7テスト green（root=2行/owner=1行の対比含む） |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| なし | — | — | — | Phase 4ファイルにTBD/FIXME/XXX/return null/hardcoded empty なし |

**Note:** REVIEW.md発行後のfix commitにより、WR-02(スパム抑止)、WR-03(setup-dev devガード)、WR-04(oa_members SELECT失敗区別)、WR-05(teardownアサート黙殺防止)、WR-06(空虚assert修正)、IN-01(未使用display_name除去)、IN-03(タイマーunmount解除)がすべて修正済み。

WR-01(in-place migration)とWR-07(prod ref in docs)はREVIEW.mdでacknowledgedされており検証の阻害要因ではない。

### Human Verification Required

#### 1. 実LINE通知受信確認

**Test:** LINE_DRY_RUN環境変数を除去してdev webhookに実際にpostback（参加者の回答操作）を行い、OAのオーナーLINEアカウントへ通知が届くことを確認する
**Expected:** オーナーのLINEに「[イベント名] から [参加者名] さんの回答が更新されました」相当のメッセージが届く
**Why human:** pushMessageはLINE_DRY_RUN=1では実際に送信されない。コード上は送信処理が呼ばれることをE2EのnotifyResult.sent>=1で確認済みだが、LINEプラットフォームへの実配信は外部サービス依存のため自動検証不可

#### 2. 実ブラウザでのテンプレート保存→再利用フロー

**Test:** 管理画面でOA設定を開き、①質問を複数追加→「テンプレートとして保存」をクリック→名前入力→保存 ②OAを切り替え→「テンプレートを選択」→適用→「設定を保存」の一連フローを実行する
**Expected:** テンプレートが保存され別OAで適用候補に表示され、適用後の質問が置換される。AlertDialogの文言「現在の質問を上書きしますか？」「テンプレートを適用」「適用しない」が表示される
**Why human:** UI状態遷移（disabled/loading/AlertDialog表示・4秒auto-dismiss・Select reset）はbuildが通ることで存在は確認済みだがインタラクション品質は実ブラウザ操作でのみ確認可能

#### 3. Vercelデプロイ確認

**Test:** `cd admin && npx vercel` でdeployし、デプロイ先URLで管理画面が正常に動作することを確認する
**Expected:** 全ルート（/login / /events / /events/[id] / /oa/settings）が正常にレンダリングされ、Skeleton loading状態とコンテンツ表示が正常
**Why human:** Vercelアカウント認証とデプロイプロセスは対話的操作が必要

---

## Gaps Summary

なし — 全4成功条件が自動テストで検証済み。REVIEW.md発見の7警告のうち5件はfix済み、2件はacknowledgedで合理的な理由あり。フェーズゲートコマンド5本（Deno 105件/vitest 76件/RLS_TEST 121件/build/E2E 全鎖）がすべてexit 0で通過。

残存する未充足項目は実LINE受信・実ブラウザ操作・Vercelデプロイの3つのみで、これらはplan上から「HUMAN-UAT（朝のTODO）」として明示的に除外されていた範囲。

---

_Verified: 2026-06-13T06:52:00Z_
_Verifier: Claude (gsd-verifier)_
