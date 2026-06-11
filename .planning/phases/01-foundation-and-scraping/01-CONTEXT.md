# Phase 1: 基盤構築 + スクレイピング検証 - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — infrastructure phase, decisions auto-resolved

<domain>
## Phase Boundary

最大リスク（Twiplaスクレイピング）の実証と、DB・Edge Functions・LINE Webhookの土台構築。dev Supabase（cmsxvxtcdniqgvhxjqri）のみ使用。具体的には:

- モノリポ初期化 + 本番DBスキーマ（events / event_platform_urls / participants / line_users / oa_configs / answers + RLS）のマイグレーション
- cheerioによるTwiplaスクレイパー（プロバイダー抽象化インターフェース経由、`a.card.namelist` から参加者名・Xアカウント名取得）
- Edge Functions 3本（webhook / scraper / message-sender）のdevデプロイ。webhookはLINE署名検証まで、message-senderは雛形

参加者向け配信フロー（N日前配信・1問1答）はPhase 2、管理画面はPhase 3のスコープ。

</domain>

<decisions>
## Implementation Decisions

### Locked（PROJECT.mdから継承）
- スタック: Supabase Edge Functions + pg_cron / PostgreSQL + RLS / cheerio / TypeScript 5.x + zod 4.x / @line/bot-sdk v11
- dev環境（cmsxvxtcdniqgvhxjqri）のみ使用。prod（hgojtooexbknqotzkkja）には一切触れない
- LINEアクセストークンは静的に持たず、実行時にステートレストークン(v3, POST https://api.line.me/oauth2/v3/token, 有効15分)を都度発行
- リポジトリはpublic — env.dev / env.prod / 全シークレットのコミット禁止（.gitignore整備済み）

### Claude's Discretion
純粋な基盤構築フェーズのため、上記Locked事項に反しない範囲で実装上の選択（モノリポのディレクトリ構成、テストランナー、マイグレーションファイル分割、プロバイダーインターフェースのシグネチャ等）はすべてClaudeの裁量とする。ROADMAPの成功条件・コードベース規約・docs.mdの仕様を判断基準にする。

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- コードは未着手。リポジトリには docs.md（要件原本）、docs/SETUP.md・docs/NIGHT-RUN.md、.planning/、空の supabase/ ディレクトリのみ
- .gitignore は env.dev / env.prod / .env* / *.key / *.pem を除外済み
- .env.example が変数名のテンプレートとして存在

### Established Patterns
- env.dev に SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_DIRECT_CONNECTION_STRING / LINE_CHANNEL_ID / LINE_CHANNEL_SECRET / X_OAUTH_CLIENT_ID / X_OAUTH_CLIENT_SECRET が格納済み
- Supabase CLIはログイン済み（dev/prodプロジェクト作成済み）

### Integration Points
- supabase/ ディレクトリ（CLI init用）
- Phase 2がwebhook/state machine、Phase 3がNext.js管理画面でこの土台に接続する

</code_context>

<specifics>
## Specific Ideas

- Twiplaスクレイパー実地検証用サンプルイベント: https://twipla.jp/events/731057
- セレクタは `a.card.namelist`（curl検証済み・静的HTML）。フィクスチャHTMLを保存して自動テスト、加えて実URLでの取得確認
- プロバイダー抽象化: Twipla実装をPeatix・ジモティー等へ将来差し替え可能なインターフェースにする（EVENT-02）
- ROADMAPのプラン分割案: ①モノリポ初期化＋DBスキーマ ②共有モジュール＋scraper ③webhook＋message-sender雛形

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
