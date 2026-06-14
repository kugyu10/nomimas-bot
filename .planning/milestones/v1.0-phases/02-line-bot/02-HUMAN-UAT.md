---
status: complete
phase: 02-line-bot
source: [02-VERIFICATION.md]
started: 2026-06-12T00:30:00Z
updated: 2026-06-14T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. 実LINEアカウントでの最終確認フロー体験

expected: `LINE_DRY_RUN` を解除（`supabase secrets unset LINE_DRY_RUN --project-ref cmsxvxtcdniqgvhxjqri` または値を0に）→ 実LINEで dev OA を友だち追加 → line_users と participants を手動紐付け（SQL or Phase 3 UI）→ message-sender を呼び出し → LINEで初回バンドル（イベント情報＋案内＋Q1）を受信 → Quick Reply で3問回答 → 完了メッセージ受信、answers 3行と confirm_status='completed' を確認。全機械検証は DRY_RUN=1 で完了済みのため、これは実機表示・操作感の確認のみ。
result: pass
note: "LINE_DRY_RUN は未設定（=本番送信モード）のため解除不要。配信は新設の個別送信ボタン（紐付けタブ）経由で実施。実機で初回バンドル→1問1答→完了まで確認。"

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
