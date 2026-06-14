---
status: complete
phase: 03-admin-ui
source: [03-VERIFICATION.md]
started: 2026-06-12T03:30:00Z
updated: 2026-06-14T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. 実X OAuthログイン

expected: `cd admin && npm run dev` → http://localhost:3000/login → 「Xでログイン」→ X認可画面 → コールバック → イベント一覧表示。oa_members に owner 行が自動登録される（X screen_name が oa_configs.admin_twitter_id と一致する場合）。プロバイダーは Management API で有効化済み。Xアプリ側コールバックURL（https://cmsxvxtcdniqgvhxjqri.supabase.co/auth/v1/callback）の登録確認も兼ねる。初回ログイン後 `select provider, identity_data from auth.identities` で screen_name のキー名（user_name/preferred_username）を確認。
result: pass
resolution: "Xアプリを Development Project に紐付けて 403 client-not-enrolled を解消。実ログイン→イベント一覧到達を確認。"
reported: "（解消前）OAuth往復後 /auth/callback?error=server_error&error_code=unexpected_failure&error_description=Error+getting+user+profile+from+external+provider で /login?error=auth に戻る"
severity: major
diagnosis: "Supabase Auth ログで根本原因を確定。X API v2 /2/users/me が 403 client-not-enrolled を返す: 'you must use keys and tokens from a Twitter developer App that is attached to a Project'。Xアプリが Project に未所属（スタンドアロン）のため v2 エンドポイントを呼べない。アプリ側コード(callback route)は無関係。Type of App=Web App化・Client Secret再発行・Request email ON は実施済みだが、Project未所属が真因。"
fix_external: "X Developer Portal → Projects & Apps で Project を作成し既存アプリを紐付ける。紐付け後 OAuth2 Client ID/Secret が変われば Supabase と .env.local に再反映。"
blocked_by: third-party
fixed_subbug: "admin/app/login/page.tsx の hydration mismatch を修正（window参照をuseEffectへ移動）"

### 2. 実ブラウザでの一連の操作

expected: イベント作成（複数URL・集合時刻・場所・参加費・店情報）→ 「参加者を取得」（実Twipla URL https://twipla.jp/events/731057）→ 紐付けタブで LINE友だちと参加者を紐付け → 回答状況タブ表示 → OA設定の保存。すべてUIから完結し、エラーなし。
result: pass

### 3. 質問リストのドラッグ&ドロップ並び替え

expected: OA設定の質問エディタでドラッグ&ドロップとキーボード上下移動の両方で並び替えができ、保存後も順序が保持される。
result: pass

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "ログインページが hydration エラーなく表示される"
  status: fixed
  reason: "User reported: Hydration failed — server rendered <Alert> didn't match client <button> at app/login/page.tsx:70"
  severity: major
  test: 1
  artifacts: [admin/app/login/page.tsx]
  root_cause: "error state の lazy useState initializer が render 中に window.location.search を読んでいた。SSR では window 不在で null、クライアントでは ?error=auth で文字列になり Alert 有無がズレて hydration mismatch"
  fix: "window 参照を useEffect (マウント後) に移動。初期値は SSR/クライアント共に null"
  missing: []
