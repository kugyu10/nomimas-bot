# nomimas

## What This Is

Twiplaで参加表明したオフ会参加者に対し、LINEで最終確認メッセージ（イベント情報＋定型質問）を自動配信し、回答を収集するツール。月数回・10〜30人規模のオフ会を主催する個人主催者（owner/co-owner）向け。現在TwitterのDMで一人ずつ手作業送信している最終確認を、Twiplaスクレイピング→LINE配信→1問1答回答収集→管理画面確認のフローで完全自動化する。

## Core Value

Twiplaの参加者リスト取得から最終確認の配信・回答収集まで、主催者の手作業がゼロであること。

**Success metric (developer-facing):** Twipla参加表明者へのLINE最終確認配信〜回答収集までが主催者の手作業ゼロで回ること（v1要件12件の充足）。

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] **AUTH-01**: 管理者はX(Twitter) OAuthで管理画面にログインできる
- [ ] **EVENT-01**: 管理者はイベントを作成できる（複数のイベントプラットフォームURL、集合時刻・場所・参加費・店情報を登録）
- [ ] **EVENT-02**: 管理者はイベントプラットフォームURLから参加者リストを自動取得できる（v1はTwiplaスクレイピング、プロバイダー抽象化）
- [ ] **LINE-01**: システムはイベントN日前に未確認の参加者へLINEで最終確認メッセージを自動配信できる
- [ ] **LINE-02**: 最終確認は1問1答形式で、ステートマシンで定型質問を順番に投げられる
- [ ] **LINE-03**: 参加者の回答がSupabaseに保存される
- [ ] **ADMIN-01**: 管理者は回答状況（誰が回答済み・未回答）を一覧確認できる
- [ ] **ADMIN-02**: 管理者はLINEユーザーとイベントプラットフォームの参加者名を手動で紐付けられる
- [ ] **NOTIF-01**: 開催2日前以降、メンバーの出欠・最終確認に更新があった際、owner/co-ownerにLINEで都度通知する
- [ ] **OA-01**: LINE OAごとに定型文・質問内容・管理者Twitter IDを設定できる
- [ ] **OA-02**: 複数のLINE OAを1つの管理画面で管理できる（権限: root/owner/co-ownerの3段階）
- [ ] **OA-03**: 定型質問のテンプレートを保存・再利用できる

### Out of Scope

- LINE上での参加表明機能 — 参加表明はTwiplaで行う。既存フローを壊さない
- イベント告知のLINE一斉配信 — v1では最終確認のみ。告知はLINE OA Managerで十分
- 開催2日前より前のリアルタイム通知 — NOTIF-01で2日前以降のみ対応。それより前は管理画面で確認
- リマインド機能（v1） — v1では最終確認の1回配信のみ。v2（REMIND-01）で検討
- モバイルアプリ — Web管理画面で十分。開発コスト大
- LINE Flexメッセージの複雑なUI — シンプルなテキスト + Quick Replyで実装

## Context

**背景・課題:**
- 現在はTwiplaで参加表明を受け、TwitterのDMで一人ずつ手作業で最終確認を送っている（送信漏れ・相互フォロー制約あり）
- 最終確認の質問はほぼ毎回同じ（年齢確認、飲酒有無、遅刻早退予定など）
- 現状はアイマス系オフ会だが、将来的にRoselia・Vtuber等の別コミュニティも主催予定。LINE公式アカウント（OA）をコミュニティごとに作り、それぞれ独立した設定を持たせる

**用語:** root（特権管理者・全データ閲覧可）/ line-oa（LINE公式アカウント）/ owner（主催者）/ co-owner（共同主催者）/ member（OAの友だち、LineUserIdと紐づく）

**実行環境（既存リソース）:**
- Supabaseプロジェクトは作成済み: dev = `cmsxvxtcdniqgvhxjqri`（nomimas-bot-dev）、prod = `hgojtooexbknqotzkkja`（nomimas-bot）
- 接続情報は `env.dev` / `env.prod` に格納（gitignore必須 — **リポジトリは public**: github.com/kugyu10/nomimas-bot。秘密情報は絶対にコミットしない）
- LINE dev/prod のチャネルID・チャネルシークレットはenvファイルに格納済み。LINEのチャネルアクセストークンは静的発行せず、実行時にステートレストークン(v3・有効15分)を channel_id+channel_secret から都度発行する（POST https://api.line.me/oauth2/v3/token）。dev/prod両チャネルとも発行テスト成功済み
- X OAuthアプリ作成済み（Client ID/Secretはenvに格納。当面devアプリをprodにも流用）。Supabase Auth側のプロバイダー有効化が未実施のため、Phase 3の認証はプロバイダー設定を後から差し込める構造にする（設定完了までmock/テストプロバイダーでのフォールバック可）
- 想定処理フロー: イベント作成 → scraperがTwipla取得 → 管理者が手動紐付け → N日前にpg_cronトリガーで配信 → Quick Replyで1問1答 → answersに保存 → 2日前以降は更新を都度通知 → 管理画面で状況確認
- ロードマップは gsd-autonomous により夜間自律実行される前提。各フェーズの成功条件は機械検証可能（テスト・CLI・デプロイ確認）であること

## Constraints

- **Tech stack**: 下記 <decisions> の決定済みスタックに従う（Supabase + Next.js + Vercel + LINE Messaging API）— 変更不可
- **Security**: リポジトリがpublicのため、env.dev / env.prod および全シークレットをコミット禁止。git初期化時に.gitignoreを先に整備
- **Cost**: 個人開発のため低コスト・全サーバーレス。AWSアカウント不要。Vercel無料デプロイ
- **Scale**: 月数回のイベント、各10〜30人程度を想定
- **Environments**: 開発・本番でSupabaseプロジェクトを分離。本番データに影響を与えずに検証できること
- **Permissions**: root / owner / co-owner の3段階。owner/co-ownerは自分に紐付くOA・イベントのみ閲覧（RLSで強制）
- **Dependencies**: X OAuth credsはenv格納済みだがSupabase Authプロバイダー設定が未実施 — 認証はモック/テストでも通る構造にしつつ、設定が入れば実OAuthで検証。LINEはステートレストークン実行時発行で実機検証可能

## Key Decisions

<decisions>

### Locked: 技術スタック（docs.md §3「決定済み」）

| 領域 | 採用技術 |
|------|----------|
| バックエンド処理 | Supabase Edge Functions + pg_cron（スケジュール実行） |
| データベース | Supabase (PostgreSQL) + Row Level Security |
| LINE連携 | LINE Messaging API（@line/bot-sdk v11） |
| 管理画面 | Next.js 16 + shadcn/ui + Tailwind CSS v4 |
| ホスティング | Vercel（無料デプロイ） |
| 認証 | X(Twitter) OAuth（Supabase Auth公式サポート） |
| スクレイピング | cheerio（Twiplaは静的HTML、確認済み） |
| 言語 / バリデーション | TypeScript 5.x / zod 4.x |

環境構成: 開発・本番で別Supabaseプロジェクト（dev=cmsxvxtcdniqgvhxjqri / prod=hgojtooexbknqotzkkja）。

</decisions>

<decisions>

### Locked: v1 / v2 スコープ分割

- **v1（12件）**: AUTH-01, EVENT-01, EVENT-02, LINE-01, LINE-02, LINE-03, ADMIN-01, ADMIN-02, NOTIF-01, OA-01, OA-02, OA-03
- **v2（設計には含めるが実装は後回し）**: LINK-01（友だち追加時の自動紐付け）, DATA-01（回答CSVエクスポート）, REMIND-01（未回答者リマインド）
- v1のLINE-Twipla紐付けは**手動**（表記揺れのため。v1で実態把握後にv2 LINK-01で自動化）

</decisions>

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 参加表明はTwiplaのまま | 既存フローを壊さない。参加者にとって慣れた方法を維持 | — Pending |
| Twiplaスクレイピング = cheerio（Playwright不要） | curlで確認済み → 静的HTML。`a.card.namelist` で参加者名取得可能 | ✓ 確認済み |
| バックエンドをSupabase Edge Functions + pg_cronに統一 | Playwright不要と判明しLambda不要に。全スタックSupabase統一で管理コスト大幅減 | — Pending |
| v1のLINE-Twipla紐付けは手動 | 表記揺れが大きく自動マッチングの精度を担保できない | — Pending |
| イベントURL複数登録＋プロバイダーパターン | Peatix・ジモティー等への拡張を考慮し実装を差し替え可能に | — Pending |
| LINE OA単位で設定を分離 | コミュニティごとに異なる定型文・質問・管理者を使いたい | — Pending |
| dev/prodでSupabaseプロジェクト分離 | 本番データに影響を与えずに検証 | — Pending |

---
*Last updated: 2026-06-12 after initial project definition (ingest from docs.md)*
