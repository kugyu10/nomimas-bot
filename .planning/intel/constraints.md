# Constraints Intel

No standalone SPECs in ingest set. Constraints below were mined from
SPEC-like content (tech tables, schema names, NFRs, protocol details)
inside the consolidated PRD, per classifier note.

All entries: source: /Users/kugyu10/work/nomimas-bot/docs.md

---

## CON-db-schema (type: schema)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §8 Phase 1 成功条件2
- 本番スキーマのテーブル: events / event_platform_urls / participants / line_users / oa_configs / answers
- マイグレーションで再現可能であること
- answers は participant_id と紐付けて保存（§9-6）
- Row Level Security を使用（§3）

## CON-twipla-scrape-selector (type: api-contract)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §4, §8
- Twiplaは静的HTML（curlで確認済み）。セレクタ `a.card.namelist` で参加者名・Xアカウント名を取得
- cheerioで実装、ヘッドレスブラウザ（Playwright）不使用

## CON-line-webhook (type: protocol)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §8 Phase 1 成功条件3
- LINE WebhookのEdge Functionは署名検証をパスしてメッセージを受信できること
- LINE Messaging API、@line/bot-sdk v11

## CON-edge-functions-topology (type: api-contract)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §8 Phase 1 成功条件4
- Edge Functions 3本構成: webhook / scraper / message-sender
- スケジュール実行は pg_cron（自動トリガー配信、参加者取得）

## CON-qa-state-machine (type: protocol)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5 LINE-02, §8 Phase 2, §7
- 最終確認は1問1答形式のステートマシン。Quick Reply回答で次問へ、全問回答で完了表示
- UIはシンプルなテキスト + Quick Reply（Flexメッセージの複雑なUIは不使用 — §7 Out of Scope）

## CON-cost-scale (type: nfr)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §3
- 個人開発のため低コスト運用。全てサーバーレスで AWSアカウント不要
- 想定規模: 月数回のイベント、各10〜30人程度
- 管理画面は Vercel 無料デプロイ

## CON-permission-model (type: nfr)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §2
- 権限は root / owner / co-owner の3段階
- root: 全OA・全イベント・全データ閲覧・管理可
- owner / co-owner: 自分に紐付くOA・イベントのみ閲覧可

## CON-env-isolation (type: nfr)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §3 環境構成
- 開発用・本番用で別Supabaseプロジェクト。本番データに影響を与えずにマイグレーション/Edge Functions/LINE連携を検証できること
