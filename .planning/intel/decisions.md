# Decisions Intel

No standalone ADRs in ingest set. The decisions below were mined from the
"Key Decisions" and tech-stack sections of the consolidated PRD, per
classifier note. None carry locked: true — statuses are as recorded in the
source ("Pending" = decided in planning but not yet formally confirmed;
"確認済み" = verified/confirmed).

All entries: source: /Users/kugyu10/work/nomimas-bot/docs.md (PRD, §3–§4)

---

## DEC-twipla-signup-stays
- source: /Users/kugyu10/work/nomimas-bot/docs.md §4
- status: proposed (Pending), not locked
- decision: 参加表明はTwiplaのまま（本システムでは参加表明機能を持たない）
- rationale: 既存フローを壊さない。参加者にとって慣れた方法を維持
- scope: signup flow

## DEC-scraping-cheerio
- source: /Users/kugyu10/work/nomimas-bot/docs.md §4
- status: confirmed (✓ 確認済み — only verified decision in set), not locked
- decision: Twiplaスクレイピングは cheerio で実装（Playwright不要）
- rationale: curlで確認済み → Twiplaは静的HTML。`a.card.namelist` で参加者名取得可能
- scope: scraping implementation

## DEC-backend-supabase-edge-functions
- source: /Users/kugyu10/work/nomimas-bot/docs.md §4
- status: proposed (Pending), not locked
- decision: バックエンドを Supabase Edge Functions + pg_cron に統一（AWS Lambda構成を放棄）
- rationale: Twiplaが静的HTMLと判明しPlaywright不要 → Lambda不要。全スタックをSupabaseに統一でき管理コスト大幅減
- scope: backend architecture
- note: アーキテクチャ変遷 — 初期構想は AWS Lambda + API Gateway + EventBridge。Twipla静的HTML判明により一本化

## DEC-v1-manual-linking
- source: /Users/kugyu10/work/nomimas-bot/docs.md §4
- status: proposed (Pending), not locked
- decision: v1のLINE-Twipla紐付けは手動（自動マッチングなし）
- rationale: X名・Xアカウント名・LINE表示名の表記揺れが大きく、自動マッチングの精度を担保できない。v1で実態を把握してからv2（LINK-01）で自動化
- scope: participant linking

## DEC-multi-url-provider-pattern
- source: /Users/kugyu10/work/nomimas-bot/docs.md §4
- status: proposed (Pending), not locked
- decision: イベント作成でURLを複数登録可能に。プロバイダーパターンで各URLのスクレイピング/API実装を差し替え可能に
- rationale: Twipla以外（Peatix、ジモティー等）への拡張を考慮
- scope: event platform integration

## DEC-oa-scoped-settings
- source: /Users/kugyu10/work/nomimas-bot/docs.md §4
- status: proposed (Pending), not locked
- decision: LINE OA単位で設定を分離
- rationale: コミュニティごとに異なる定型文・質問・管理者を使いたい
- scope: OA configuration model

## DEC-tech-stack
- source: /Users/kugyu10/work/nomimas-bot/docs.md §3（「決定済み」と明記）
- status: decided in source ("決定済み"), not locked
- decision: 採用スタック —
  - バックエンド処理: Supabase Edge Functions + pg_cron
  - DB: Supabase (PostgreSQL) + Row Level Security
  - LINE連携: LINE Messaging API（@line/bot-sdk v11）
  - 管理画面: Next.js 16 + shadcn/ui + Tailwind CSS v4
  - ホスティング: Vercel（無料デプロイ）
  - 認証: X(Twitter) OAuth（Supabase Auth公式サポート）
  - スクレイピング: cheerio
  - 言語: TypeScript 5.x / バリデーション: zod 4.x
- scope: full stack

## DEC-env-separation
- source: /Users/kugyu10/work/nomimas-bot/docs.md §3（環境構成）
- status: decided in source, not locked
- decision: 開発と本番で Supabase プロジェクトを分離。DB・Edge Functions・認証などBE一式を環境ごとに独立プロジェクトとして持ち、接続情報（URL・APIキー等）を環境ごとに切り替える
- scope: environments / deployment
