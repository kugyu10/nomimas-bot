# Phase 4: 通知 + 統合仕上げ - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 推奨案を自動採用（夜間無人実行）

<domain>
## Phase Boundary

主催者への更新通知・テンプレート再利用・root横断管理が動作し、実Twipla URLでのE2E通しで本番運用に耐える。具体的には:

- 開催2日前以降の出欠・最終確認更新を owner/co-owner の LINE へ都度通知（NOTIF-01。2日前より前は通知しないことのテスト含む）
- 定型質問テンプレートの保存・再利用（OA-03）
- root ユーザーの全OA・全イベント・全データ横断閲覧（OA-02 root部分。owner/co-owner との権限差をテストで検証）
- 実Twipla URL での E2E 通し（スクレイピング→紐付け→配信→1問1答→保存→通知→管理画面確認）
- 統合仕上げ: Phase 3 UIレビューの優先修正（top-3 + 軽微なa11y）

</domain>

<decisions>
## Implementation Decisions

### 更新通知（NOTIF-01）
- イベント駆動: 更新の発生箇所から共有 notifier モジュール（`_shared/notify/` 等）を直接呼ぶ。新規 cron は作らない
  - webhook: 回答保存・全問完了時
  - scraper: 再スクレイプで既存参加者の status が変化した時（新規参加者の出現も通知対象）
- 2日前判定は送信時: `event_date - interval '2 days' <= 今日` かつイベント未終了。範囲外は送信せず件数ログ — 「2日前より前では通知されない」を機械検証
- 通知先: `oa_members.line_user_id text nullable` 列を追加（マイグレーション in-place）。未設定の owner/co-owner はスキップ+ログ。dev では seed/setup-dev で E2E 用の値を投入
- 送信は既存 `_shared/line/client.ts` の pushMessage（LINE_DRY_RUN 対応）。テキストのみ（参加者名・更新種別・イベント名）

### 質問テンプレート（OA-03）
- `question_templates(id uuid, oa_config_id uuid fk, name text, questions jsonb, created_at)` — RLS は他テーブル同パターン（oa_members スコープ + root SELECT）
- UI: OA設定の質問エディタに「テンプレートとして保存」（名前入力Dialog）と「テンプレートを適用」（Select→確認→questionsへコピー）。自分がアクセスできる全OAのテンプレートが適用候補（「別イベント・別OAで再利用」の充足）
- 保存スキーマは oaSettingsSchema.questions と同一バリデーション

### root権限（OA-02完成）
- `root_users(auth_user_id uuid pk references auth.users)` テーブル + `is_root()` SECURITY DEFINER 関数（search_path=''）
- 全テーブルの SELECT ポリシーに `or is_root()` を追加。書込ポリシーは変更しない（root は閲覧専用 — 安全側）
- `listMyOas` が root なら全OA返却 → 既存のOAセレクタ/全画面がそのまま横断管理UIになる
- RLSマトリクステストに root 軸を追加: root が全OAを SELECT でき、owner が他OAを見られない権限差を同一テストで対比検証。dev に root テストユーザーを setup-dev で投入

### E2E通し（成功条件4）
- E2E_TEST=1 ゲートの自動テストで全鎖を通す: 実Twipla URL https://twipla.jp/events/731057 スクレイプ → 手動紐付け相当（管理画面のデータ層 or SQL）→ message-sender 配信（LINE_DRY_RUN=1）→ webhook へ署名付き postback×3 → answers 保存確認 → 通知発火確認（DRY_RUNログ or 関数戻り値）→ admin データ層（getParticipantsWithAnswers）で回答状況が見えることを確認
- 実LINE配信・実ブラウザはHUMAN-UAT（Phase 2/3 と同じ分離）

### 統合仕上げ（Phase 3 UIレビュー優先対応）
- 03-UI-REVIEW.md の top-3 を修正: ①CTAの二重プラス除去 ②app/(app)/loading.tsx + Skeleton + OAセレクタ切替フィードバック ③ハードコード bg-zinc-900 → Button デフォルト/bg-primary 統一
- 軽微: ゴミ箱ボタンの aria-label、ログイン失敗文言（「ログインが必要です」→「メールアドレスまたはパスワードが正しくありません」）、イベント一覧の死にステータス列（回答状況サマリ表示 or 列削除 — 裁量）
- 残り11件の警告/軽微項目は対応しない（v2/任意）

### Claude's Discretion
通知文面、notifier の関数分割、テンプレートUIの細部、root テストユーザーの作り方、E2Eテストの配置（deno側/vitest側の分担）は裁量。確立パターン（dev only / in-place migration + db reset --linked / --use-api deploy / DRY_RUN / RLS_TEST・E2E_TEST ゲート）に従う。

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_shared/line/client.ts`（pushMessage/replyMessage、DRY_RUN、retry key）— 通知送信にそのまま使う
- `_shared/confirm/*`（state machine等）/ webhook/index.ts（回答保存箇所 = 通知フック挿入点）/ scraper（upsert箇所 = 出欠変化検出点。natural_key upsert なので変化検出は upsert 前後の比較 or returning）
- admin/: lib/data/oa.ts（listMyOas — root対応拡張点）、components/oa/question-list-editor.tsx（テンプレートUI挿入点）、tests/integration/rls.{helpers,test}.ts（root軸追加点）
- scripts/setup-dev.ts（rootユーザー・oa_members.line_user_id 投入の拡張点）
- マイグレーション3本（in-place編集 + db reset --linked パターン確立済み）

### Established Patterns
- dev only（cmsxvxtcdniqgvhxjqri）/ public repo / シークレットはVault・env
- テスト: Deno（supabase側 82+件）+ vitest（admin側 94件 incl. RLS_TEST）。E2EはE2E_TEST=1
- cron 認証は x-cron-key（CRON_FUNCTION_KEY）。scraper/webhook/message-sender はデプロイ済み

### Integration Points
- scraper の participants upsert: 通知には「変化があった行」の検出が必要 — upsert を returning 付きにして旧値比較、または upsert 前に現在値を select
- webhook の回答処理は既に participant・event を解決済み — 通知呼び出しは安価
- 通知の重複防止: 同一更新で1通。再配達(isRedelivery)スキップ済みなのでwebhook側は自然に冪等

</code_context>

<specifics>
## Specific Ideas

- 成功条件1のテスト: event_date を「今日+1日」（2日前以内）と「今日+10日」（範囲外）の2イベントで通知発火/非発火を対比
- E2E通しは Phase 2 の e2e_confirm_flow_test.ts を拡張 or 新規 e2e_full_chain_test.ts（実Twipla fetch を含むため LIVE 性あり — E2E_TEST=1 かつ実URL到達性が前提）
- root テストユーザー: dev-root@nomimas.test を setup-dev.ts で作成し root_users へ投入

</specifics>

<deferred>
## Deferred Ideas

- Vercel デプロイ: Vercel アカウント認証が必要なため夜間スコープ外 — 朝のTODO（HUMAN-UAT に記録）
- 03-UI-REVIEW の残り警告11件（タッチターゲット44px、スペーシング微調整等）— 任意/v2
- IN-08(prod email provider無効化)等の prod 系作業 — prod 禁止のため人間作業
- DATA-01 / REMIND-01 / LINK-01 — v2

</deferred>
