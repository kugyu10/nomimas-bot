---
status: partial
phase: 03-admin-ui
source: [03-VERIFICATION.md]
started: 2026-06-12T03:30:00Z
updated: 2026-06-12T03:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. 実X OAuthログイン

expected: `cd admin && npm run dev` → http://localhost:3000/login → 「Xでログイン」→ X認可画面 → コールバック → イベント一覧表示。oa_members に owner 行が自動登録される（X screen_name が oa_configs.admin_twitter_id と一致する場合）。プロバイダーは Management API で有効化済み。Xアプリ側コールバックURL（https://cmsxvxtcdniqgvhxjqri.supabase.co/auth/v1/callback）の登録確認も兼ねる。初回ログイン後 `select provider, identity_data from auth.identities` で screen_name のキー名（user_name/preferred_username）を確認。
result: [pending]

### 2. 実ブラウザでの一連の操作

expected: イベント作成（複数URL・集合時刻・場所・参加費・店情報）→ 「参加者を取得」（実Twipla URL https://twipla.jp/events/731057）→ 紐付けタブで LINE友だちと参加者を紐付け → 回答状況タブ表示 → OA設定の保存。すべてUIから完結し、エラーなし。
result: [pending]

### 3. 質問リストのドラッグ&ドロップ並び替え

expected: OA設定の質問エディタでドラッグ&ドロップとキーボード上下移動の両方で並び替えができ、保存後も順序が保持される。
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
