# Phase 3: 管理画面 - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 推奨案を自動採用（夜間無人実行）

<domain>
## Phase Boundary

主催者がイベント作成・参加者取得・手動紐付け・回答状況確認・OA設定の全操作をUIで完結できる。具体的には:

- X(Twitter) OAuth ログイン（Supabase Auth、モックフォールバック付き — AUTH-01）
- イベント作成・編集（複数プラットフォームURL・集合時刻/場所/参加費/店情報 — EVENT-01）+ 画面からの参加者取得トリガー
- 回答状況一覧（誰が回答済み・未回答 — ADMIN-01）
- LINEユーザー × Twipla参加者の手動紐付けUI（ADMIN-02）
- OAごとの設定（定型文・質問・管理者Twitter ID — OA-01）と複数OA切り替え管理（OA-02 owner/co-ownerスコープ）
- owner/co-ownerのRLSスコープ強制（成功条件6 — 自動テストで検証）

通知（NOTIF-01）・テンプレート（OA-03）・root横断閲覧・Vercel本番デプロイはPhase 4。

</domain>

<decisions>
## Implementation Decisions

### 認証・権限
- Supabase Auth の Twitter プロバイダー有効化を Management API で試行（X creds は env.dev に格納済み: X_OAUTH_CLIENT_ID/SECRET。コールバック https://cmsxvxtcdniqgvhxjqri.supabase.co/auth/v1/callback）。成功してもブラウザ往復が必要な実OAuth E2EはHUMAN-UATへ。API有効化が失敗してもブロッカーにせずモックで続行
- モック認証: 環境フラグ（例 NEXT_PUBLIC_AUTH_MOCK=1）で email+password テストユーザーログインにフォールバック。どちらも auth.uid() ベースで RLS は同一に機能 — プロバイダー差し替えのみで本番化できる構造（成功条件1）
- 初回ログイン時、X の screen_name（モック時はテスト用識別子）を oa_configs.admin_twitter_ids と照合して oa_members に自動登録（owner）。未登録ユーザーは「権限がありません」画面
- ルート保護: Next.js middleware + @supabase/ssr のサーバー側セッション検証

### 画面構成
- アプリはモノリポ内 `admin/` ディレクトリ（Next.js 16 App Router + shadcn/ui + Tailwind CSS v4 + TypeScript 5.x + zod 4.x — Lockedスタック）
- ナビ: shadcn sidebar。ヘッダにOAセレクタ（切替で全画面のスコープが変わる）。ページ: イベント一覧 / イベント詳細（参加者・回答状況・紐付けのタブ）/ OA設定
- 紐付けUI: イベント詳細内で未紐付け参加者リスト × LINE友だち（line_users）コンボボックスの1対1割当・解除
- UI文言は日本語

### データアクセス・RLS
- DBアクセスはユーザーJWTの supabase クライアント（@supabase/ssr）— RLSが実効。service role はサーバーアクションでも使わない（成功条件6の検証可能性のため）
- RLSポリシーを本実装に置き換え: oa_members(auth_user_id, oa_config_id, role) 経由で owner/co-owner が自OAの行のみ SELECT/INSERT/UPDATE。既存マイグレーション（20260611171038_enable_rls.sql）を in-place 拡張 + `db reset --linked --yes` 再適用（確立パターン）
- RLS自動テスト: pooler経由でJWTロールを切り替え、他者OAのデータが見えない・書けないことを検証（成功条件6）
- 参加者取得トリガー: サーバーアクションから scraper Edge Function を呼ぶ（ユーザーセッション必須化）

### 検証範囲
- 機械検証: `next build` 成功 + ユニット/統合テスト + RLSテスト + モック認証での主要フロー（route handler / server action レベル）テスト。Playwrightフルブラウザは使わない（夜間安定性優先）
- 実X OAuthログイン体験・実ブラウザ操作感はHUMAN-UAT
- Vercelデプロイは Phase 4（統合仕上げ）へ

### Claude's Discretion
コンポーネント分割、フォームバリデーション構成（zod）、テストランナー選択（Next.js側: vitest推奨だが裁量）、shadcnコンポーネント選定、サーバーアクション vs route handler の使い分けは裁量。Phase 1-2の確立パターン（dev only / public repo / in-place migration + db reset --linked / --use-api deploy）に従う。

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- DBスキーマ7テーブル + get_confirm_targets RPC（dev適用済み）。oa_configs.questions JSONB / admin_twitter_ids は既存列（Phase 1-2で作成）
- Edge Functions 3本デプロイ済み（webhook / scraper / message-sender）。scraperはPOST {url} + Bearer
- scripts/db/sql.ts（pooler SQLヘルパー、dev ref強制）/ setup-dev.ts / verify-cron.ts
- supabase/seed.sql にE2Eフィクスチャ（oa_config / event / participants / line_users）

### Established Patterns
- dev only（cmsxvxtcdniqgvhxjqri）/ prod禁止 / public repoでシークレット非コミット
- スキーマ変更 = 既存マイグレーション in-place 編集 + `supabase db reset --linked --yes` + setup-dev.ts + verify-cron.ts（cronはresetで消えmigrationが再作成）
- Deno側テスト: `deno test --config supabase/functions/deno.json --allow-read`（E2EはE2E_TEST=1ゲート）
- admin/ は Node 領域 — Deno と分離（lockfile・依存は admin/ 内で完結。ルートの deno.json と干渉させない）

### Integration Points
- Supabase Auth（dev）: Twitter プロバイダー設定は Management API（PATCH /v1/projects/{ref}/config/auth）で external_twitter_enabled 等を設定可能か確認 — SUPABASE_ACCESS_TOKEN は CLI ログイン済みのため `supabase` CLI の認証情報を利用可
- line_users / participants の紐付け列（participants.line_user_id）は既存
- 回答状況: answers × participants × questions JSONB の結合ビュー（または既存クエリ）

</code_context>

<specifics>
## Specific Ideas

- 成功条件6のRLSテストは「ユーザーA（OA-1のowner）がOA-2のイベント・参加者・回答を SELECT できない / INSERT・UPDATE できない」をJWT切替で機械検証
- seed に2つ目のOA + 別ownerユーザーを追加するとRLSテストが書きやすい（Claude裁量）
- イベント作成フォーム: 名称 / 開催日 / 集合時刻 / 場所 / 参加費 / 店情報 / confirm_days_before / プラットフォームURL（複数、Twipla形式チェック）
- X OAuthアプリ側コールバックURL（dev/prod両方登録済みか）は未確認 — 実OAuth検証はHUMAN-UATで

</specifics>

<deferred>
## Deferred Ideas

- NOTIF-01（更新通知）/ OA-03（テンプレート）/ root横断閲覧 / Vercelデプロイ → Phase 4
- IN-05（oa_members.auth_user_id → auth.users FK）: 本フェーズのRLS実装で対応可能なら対応（裁量）
- DATA-01 / REMIND-01 / LINK-01 → v2

</deferred>
