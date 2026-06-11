# Requirements Intel

Extracted from classified PRD sources. IDs preserved verbatim from source.
All entries: source: /Users/kugyu10/work/nomimas-bot/docs.md (PRD, confidence: medium)

---

## v1 Requirements (12 total — all mapped to phases, 0 unmapped)

### REQ-AUTH-01 (original ID: AUTH-01)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / Authentication
- description: 管理者はX(Twitter) OAuthで管理画面にログインできる
- acceptance: X認証ログインが成立し、owner/co-ownerスコープで自分に紐付くOA・イベントのみ閲覧できる（Phase 3 成功条件より）
- phase: Phase 3

### REQ-EVENT-01 (original ID: EVENT-01)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / Event Management
- description: 管理者はイベントを作成できる（複数のイベントプラットフォームURL[Twipla, Peatix等]、集合時刻・場所・参加費・店情報を登録）
- acceptance: 管理画面からイベント作成・保存ができ、複数プラットフォームURLを登録できる
- phase: Phase 3

### REQ-EVENT-02 (original ID: EVENT-02)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / Event Management
- description: 管理者はイベントプラットフォームURLから参加者リストを自動取得できる（v1はTwiplaスクレイピング。将来的なJimoty・Peatix等への拡張を考慮したプロバイダー抽象化で実装）
- acceptance: cheerioによるTwiplaスクレイピングで `a.card.namelist` から参加者名・Xアカウント名リストを正しく取得できる（Phase 1 成功条件1）
- phase: Phase 1

### REQ-LINE-01 (original ID: LINE-01)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / LINE Bot
- description: システムはイベントN日前に未確認の参加者へLINEで最終確認メッセージを自動配信できる
- acceptance: pg_cronによる自動トリガーで未確認参加者へ配信される（Phase 2 成功条件）
- phase: Phase 2

### REQ-LINE-02 (original ID: LINE-02)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / LINE Bot
- description: 最終確認は1問1答形式で、ステートマシンで定型質問を順番に投げられる
- acceptance: 1問ずつの質問送信、Quick Reply回答で次問へ進み、全問回答で完了表示（Phase 2 成功条件）
- phase: Phase 2

### REQ-LINE-03 (original ID: LINE-03)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / LINE Bot
- description: 参加者の回答がSupabaseに保存される
- acceptance: answersテーブルへ participant_id と紐付けて正しく保存される（Phase 2 成功条件、§9-6）
- phase: Phase 2

### REQ-ADMIN-01 (original ID: ADMIN-01)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / Admin
- description: 管理者は回答状況（誰が回答済み・未回答）を一覧確認できる
- acceptance: 管理画面で回答済み・未回答が一覧表示される（Phase 3 成功条件）
- phase: Phase 3

### REQ-ADMIN-02 (original ID: ADMIN-02)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / Admin
- description: 管理者はLINEユーザーとイベントプラットフォームの参加者名を手動で紐付けられる（v1は自動紐付けなし。表記揺れ問題のため）
- acceptance: 管理画面で手動紐付け操作が完結する（Phase 3 成功条件）
- phase: Phase 3

### REQ-NOTIF-01 (original ID: NOTIF-01)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / Notifications
- description: 開催2日前以降、メンバーの出欠・最終確認に更新があった際、owner/co-ownerにLINEで都度通知する
- acceptance: 2日前以降の更新で owner/co-owner のLINEに都度通知が届く（Phase 4 成功条件）。2日前より前のリアルタイム通知はスコープ外（§7）
- phase: Phase 4

### REQ-OA-01 (original ID: OA-01)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / OA Settings
- description: LINE OAごとに定型文・質問内容・管理者Twitter IDを設定できる
- acceptance: OA設定UIで定型文・質問・管理者Twitter IDの設定が保存できる（Phase 3 成功条件）
- phase: Phase 3

### REQ-OA-02 (original ID: OA-02)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / OA Settings
- description: 複数のLINE OAを1つの管理画面で管理できる。権限モデルはroot/owner/co-ownerの3段階
- acceptance: owner/co-ownerは自分に紐付くOA・イベントのみ（Phase 3）、rootは全OA横断閲覧（Phase 4）
- phase: Phase 3 + Phase 4（root権限部分）

### REQ-OA-03 (original ID: OA-03)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §5
- scope: v1 / OA Settings
- description: 定型質問のテンプレートを保存・再利用できる
- acceptance: テンプレートの保存・再利用が動作する（Phase 4 成功条件）
- phase: Phase 4

---

## v2+ Requirements (3 total — design-aware, implementation deferred)

### REQ-LINK-01 (original ID: LINK-01)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §6
- scope: v2 / Linking
- description: LINE友だち追加時にTwipla名等を聞いて参加者と自動紐付け（v1の手動運用で表記揺れの実態を把握後に実装）
- acceptance: (deferred — to be defined when promoted to active scope)

### REQ-DATA-01 (original ID: DATA-01)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §6
- scope: v2 / Data
- description: 回答CSVエクスポート（当日の受付・集計用）
- acceptance: (deferred)

### REQ-REMIND-01 (original ID: REMIND-01)
- source: /Users/kugyu10/work/nomimas-bot/docs.md §6
- scope: v2 / Reminders
- description: イベント当日まで未回答の参加者へリマインド配信
- acceptance: (deferred)

---

## Out of Scope (from §7)

- source: /Users/kugyu10/work/nomimas-bot/docs.md §7
- LINE上での参加表明機能 — 参加表明はTwiplaで行う。既存フローを壊さない
- イベント告知のLINE一斉配信 — v1では最終確認のみ。告知はLINE OA Managerで十分
- 開催2日前より前のリアルタイム通知 — NOTIF-01で2日前以降のみ対応。それより前は管理画面で確認
- リマインド機能（v1）— v1では最終確認の1回配信のみ。v2で検討（REMIND-01）
- モバイルアプリ — Web管理画面で十分。開発コスト大
- LINE Flexメッセージの複雑なUI — シンプルなテキスト + Quick Replyで実装。Flexは後回し
