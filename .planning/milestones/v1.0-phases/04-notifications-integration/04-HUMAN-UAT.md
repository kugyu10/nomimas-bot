---
status: partial
phase: 04-notifications-integration
source: [04-VERIFICATION.md]
started: 2026-06-13T00:00:00Z
updated: 2026-06-13T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. 実LINE通知受信

expected: `supabase secrets unset LINE_DRY_RUN --project-ref cmsxvxtcdniqgvhxjqri`（または値を0に）した上で、自分のLINEを owner として oa_members.line_user_id に設定 → 参加者の回答 or 再スクレイプでの出欠変化（開催2日前以内のイベント）→ ownerのLINEに更新通知が届く。機械検証（DRY_RUN・notification_logs）は完了済み — 実機受信の確認のみ。
result: [pending]

### 2. 実ブラウザのテンプレート操作

expected: OA設定 → 質問エディタ「テンプレートとして保存」→ 名前入力 → 保存 → 別OAに切替（またはそのまま）→「テンプレートを適用」→ 上書き確認 → 質問リストが置き換わる → 設定を保存。
result: [pending]

### 3. Vercelデプロイ（朝のTODO）

expected: `cd admin && npx vercel`（要 Vercel ログイン）。環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY（+ 必要なら NEXT_PUBLIC_AUTH_MOCK=1）を Vercel に設定してデプロイ。X OAuth コールバックは Supabase 経由のため追加設定不要（XアプリのコールバックURLが登録済みであること）。
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
