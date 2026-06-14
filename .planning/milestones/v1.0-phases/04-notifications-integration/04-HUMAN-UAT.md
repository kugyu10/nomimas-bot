---
status: complete
phase: 04-notifications-integration
source: [04-VERIFICATION.md]
started: 2026-06-13T00:00:00Z
updated: 2026-06-14T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. 実LINE通知受信

expected: `supabase secrets unset LINE_DRY_RUN --project-ref cmsxvxtcdniqgvhxjqri`（または値を0に）した上で、自分のLINEを owner として oa_members.line_user_id に設定 → 参加者の回答 or 再スクレイプでの出欠変化（開催2日前以内のイベント）→ ownerのLINEに更新通知が届く。機械検証（DRY_RUN・notification_logs）は完了済み — 実機受信の確認のみ。
result: pass
note: "実機で owner 宛通知の受信を確認。UAT中に挙動改善を実施: (1) 通知は最終確認の完了時のみ（途中回答ごとの通知を廃止）、(2) 完了通知に確定参加者数を表示。webhook/notifier/messages を変更しdevへデプロイ済み。"

### 2. 実ブラウザのテンプレート操作

expected: OA設定 → 質問エディタ「テンプレートとして保存」→ 名前入力 → 保存 → 別OAに切替（またはそのまま）→「テンプレートを適用」→ 上書き確認 → 質問リストが置き換わる → 設定を保存。
result: pass

### 3. Vercelデプロイ（朝のTODO）

expected: `cd admin && npx vercel`（要 Vercel ログイン）。環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY（+ 必要なら NEXT_PUBLIC_AUTH_MOCK=1）を Vercel に設定してデプロイ。X OAuth コールバックは Supabase 経由のため追加設定不要（XアプリのコールバックURLが登録済みであること）。
result: pass
note: |
  本番 https://nomimas-bot.vercel.app で実X OAuthログイン→管理画面(root+owner)→OA設定保存まで実機確認。
  デプロイ過程で発見・解決した問題:
  - Root Directory=admin 設定（サブディレクトリアプリ）
  - env名不一致: コードは NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 参照 → Vercelに追加
  - 本番Vercelは prod Supabase(hgojtooexbknqotzkkja) を指す → prod環境を新規構築（別途実施）
  prod構築内容: 全migration適用 / Edge Functions(webhook,message-sender,scraper)デプロイ /
  Edge secrets(LINE,CRON_FUNCTION_KEY) / Vault(project_url,cron_function_key,cron_shared_secret) /
  Twitterプロバイダー有効化(Management API) / 最初のoa_config seed / root+owner(kugyu10)登録。
  残: prod LINE channel への Webhook URL 登録（実LINE運用時）。

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
