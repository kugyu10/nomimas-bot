# Requirements: nomimas

**Defined:** 2026-06-12（docs.md 2026-06-11版からのingest）
**Core Value:** Twiplaの参加者リスト取得から最終確認の配信・回答収集まで、主催者の手作業がゼロであること

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Authentication

- [x] **AUTH-01**: 管理者はX(Twitter) OAuthで管理画面にログインできる

### Event Management

- [x] **EVENT-01**: 管理者はイベントを作成できる（複数のイベントプラットフォームURL[Twipla, Peatix等]、集合時刻・場所・参加費・店情報を登録）
- [x] **EVENT-02**: 管理者はイベントプラットフォームURLから参加者リストを自動取得できる（v1はTwiplaスクレイピング。将来的なJimoty・Peatix等への拡張を考慮したプロバイダー抽象化で実装）

### LINE Bot

- [x] **LINE-01**: システムはイベントN日前に未確認の参加者へLINEで最終確認メッセージを自動配信できる
- [x] **LINE-02**: 最終確認は1問1答形式で、ステートマシンで定型質問を順番に投げられる
- [x] **LINE-03**: 参加者の回答がSupabaseに保存される

### Admin

- [x] **ADMIN-01**: 管理者は回答状況（誰が回答済み・未回答）を一覧確認できる
- [x] **ADMIN-02**: 管理者はLINEユーザーとイベントプラットフォームの参加者名を手動で紐付けられる（v1は自動紐付けなし。表記揺れ問題のため）

### Notifications

- [x] **NOTIF-01**: 開催2日前以降、メンバーの出欠・最終確認に更新があった際、owner/co-ownerにLINEで都度通知する

### OA Settings

- [x] **OA-01**: LINE OAごとに定型文・質問内容・管理者Twitter IDを設定できる
- [x] **OA-02**: 複数のLINE OAを1つの管理画面で管理できる。権限モデルはroot/owner/co-ownerの3段階
- [x] **OA-03**: 定型質問のテンプレートを保存・再利用できる

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.（設計には含めるが実装は後回し）

### Linking

- **LINK-01**: LINE友だち追加時にTwipla名等を聞いて参加者と自動紐付け（v1の手動運用で表記揺れの実態を把握後に実装）

### Data

- **DATA-01**: 回答CSVエクスポート（当日の受付・集計用）

### Reminders

- **REMIND-01**: イベント当日まで未回答の参加者へリマインド配信

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| LINE上での参加表明機能 | 参加表明はTwiplaで行う。既存フローを壊さない |
| イベント告知のLINE一斉配信 | v1では最終確認のみ。告知はLINE OA Managerで十分 |
| 開催2日前より前のリアルタイム通知 | NOTIF-01で2日前以降のみ対応。それより前は管理画面で確認 |
| リマインド機能（v1） | v1では最終確認の1回配信のみ。v2（REMIND-01）で検討 |
| モバイルアプリ | Web管理画面で十分。開発コスト大 |
| LINE Flexメッセージの複雑なUI | シンプルなテキスト + Quick Replyで実装。Flexは後回し |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| EVENT-02 | Phase 1 | Pending |
| LINE-01 | Phase 2 | Pending |
| LINE-02 | Phase 2 | Pending |
| LINE-03 | Phase 2 | Pending |
| AUTH-01 | Phase 3 | Pending |
| EVENT-01 | Phase 3 | Pending |
| ADMIN-01 | Phase 3 | Pending |
| ADMIN-02 | Phase 3 | Pending |
| OA-01 | Phase 3 | Pending |
| OA-02 | Phase 3 | Pending |
| NOTIF-01 | Phase 4 | Pending |
| OA-03 | Phase 4 | Pending |

> 注: OA-02の主担当はPhase 3（owner/co-ownerスコープ・複数OA管理）。root権限による全OA横断閲覧の完成はPhase 4の成功条件で検証する（docs.md §8の「Phase 3 + Phase 4（root権限）」分割を反映）。

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-12*
*Last updated: 2026-06-12 after roadmap creation*
