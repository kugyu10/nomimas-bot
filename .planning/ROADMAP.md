# Roadmap: nomimas

## Overview

最大リスク（Twiplaスクレイピング）と基盤（DBスキーマ・Edge Functions・LINE Webhook）をPhase 1で先に潰し、Phase 2でLINE Botの自動配信〜回答収集をE2Eで完成させる。Phase 3で管理画面（認証・イベント管理・回答状況・手動紐付け・OA設定）を構築し、Phase 4で通知・テンプレート・root権限を加えて本番運用に耐える状態に仕上げる。全フェーズの成功条件は夜間自律実行（gsd-autonomous）で機械検証可能な形で定義する。

**Mode:** MVP / **Granularity:** coarse / **v1要件:** 12件（全件マッピング済み）

## Phases

- [x] **Phase 1: 基盤構築 + スクレイピング検証** - DBスキーマ・Edge Functions土台・Twiplaスクレイピングの実証 (completed 2026-06-11)
- [x] **Phase 2: LINE Botコア機能** - pg_cron自動配信・1問1答ステートマシン・回答保存のE2E完成 (completed 2026-06-11)
- [x] **Phase 3: 管理画面** - X OAuth認証・イベント管理・回答状況一覧・手動紐付け・OA設定UI (completed 2026-06-12)
- [ ] **Phase 4: 通知 + 統合仕上げ** - 2日前以降の更新通知・質問テンプレート・root権限・E2E通し検証

## Phase Details

### Phase 1: 基盤構築 + スクレイピング検証

**Goal**: 最大リスク（Twiplaスクレイピング）が実証され、DB・Edge Functions・LINE Webhookの土台がdev環境で動作している
**Depends on**: Nothing (first phase)
**Requirements**: EVENT-02
**Success Criteria** (what must be TRUE):

  1. cheerioによるTwiplaスクレイピングで `a.card.namelist` から参加者名・Xアカウント名リストを正しく取得できる（フィクスチャHTMLに対する自動テストがパスし、実Twipla URLでも取得を確認。プロバイダー抽象化インターフェース経由で実装）
  2. 本番スキーマ（events / event_platform_urls / participants / line_users / oa_configs / answers）がマイグレーションでゼロから再現できる（`supabase db reset` が成功し、全テーブルとRLSポリシーが存在する）
  3. LINE WebhookのEdge Functionが署名検証をパスしてメッセージを受信できる（正しい署名は200・不正な署名は拒否されることがテストで検証できる）
  4. Edge Functions 3本（webhook / scraper / message-sender）がdev Supabaseプロジェクトにデプロイされ、呼び出しログが確認できる
  5. リポジトリ初期化時に `.gitignore` が env.dev / env.prod を除外しており、シークレットがコミット対象に含まれない（リポジトリはpublic）

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — モノリポ初期化＋DBスキーマ（7テーブル+RLS）＋dev適用 [Wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — プロバイダー抽象化＋Twiplaスクレイパー＋scraper関数デプロイ [Wave 2]
- [x] 01-03-PLAN.md — LINE webhook（署名検証）＋message-sender雛形＋デプロイ検証 [Wave 2]

### Phase 2: LINE Botコア機能

**Goal**: イベントN日前の自動配信から1問1答の回答収集・保存まで、参加者側のフローが手作業ゼロで完結する
**Depends on**: Phase 1
**Requirements**: LINE-01, LINE-02, LINE-03
**Success Criteria** (what must be TRUE):

  1. pg_cronのスケジュールトリガーで、イベントN日前に未確認の参加者のみへ最終確認メッセージが自動配信される（cronジョブが登録済みで、配信対象抽出ロジックが「未確認のみ・N日前条件」をテストで満たす）
  2. 定型質問が1問ずつ順番に送信され、参加者のQuick Reply回答ごとにステートマシンが次の質問へ遷移する（全状態遷移が自動テストで検証できる）
  3. 全問回答すると完了メッセージが送信され、参加者の確認ステータスが完了状態になる
  4. 各回答がanswersテーブルにparticipant_idと紐付けて正しく保存される（webhook受信→保存をテストで検証できる）

**Plans**: 4 plans

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — スキーマ拡張（questions/状態列/IN-06/default 7）＋cron基盤（Vault参照）＋[BLOCKING] dev再適用 [Wave 1]
- [x] 02-02-PLAN.md — 1問1答ステートマシン・postbackコーデック・メッセージビルダー（純関数, TDD） [Wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-03-PLAN.md — LINE送信クライアント（DRY_RUN）＋message-sender配信本体＋抽出E2E [Wave 2]

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-04-PLAN.md — webhookステートマシン統合＋IN-08修正＋フルE2E（配信→3問回答→完了） [Wave 3]

### Phase 3: 管理画面

**Goal**: 主催者がイベント作成・参加者取得・手動紐付け・回答状況確認・OA設定の全操作をUIで完結できる
**Depends on**: Phase 1
**Requirements**: AUTH-01, EVENT-01, ADMIN-01, ADMIN-02, OA-01, OA-02
**Success Criteria** (what must be TRUE):

  1. 管理者がSupabase Auth経由のX(Twitter) OAuthで管理画面にログインできる（X OAuthアプリ未作成のため、プロバイダー設定を差し込むだけで本番化できる構造とし、それまでテストプロバイダー/モックで認証フローを検証）
  2. 管理者がイベントを作成・保存できる（複数のプラットフォームURL、集合時刻・場所・参加費・店情報を登録でき、登録URLからの参加者取得を画面からトリガーできる）
  3. 管理者がイベントごとの回答状況（誰が回答済み・未回答か）を一覧で確認できる
  4. 管理者がLINEユーザー（友だち）とTwipla参加者名をUI上で手動紐付けでき、紐付け結果がDBに反映される
  5. LINE OAごとに定型文・質問内容・管理者Twitter IDを設定・保存でき、複数OAを1つの管理画面で切り替え管理できる
  6. owner/co-ownerは自分に紐付くOA・イベントのみ閲覧でき、他者のデータにはアクセスできない（RLSポリシーが自動テストで検証できる）

**Plans**: 5 plans
**UI hint**: yes

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — スキーマ/RLS本実装（書込ポリシー+owner登録RPC+IN-05）+ seed/setup-dev拡張 + [BLOCKING] dev再適用 [Wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — admin/スキャフォールド + @supabase/ssr認証（X OAuth/モック二経路・ルート保護）+ OAセレクタ付きシェル [Wave 2]

**Wave 3** *(blocked on Wave 2 completion — 並列実行可)*

- [x] 03-03-PLAN.md — イベントCRUD + 参加者取得トリガー + 参加者タブ（EVENT-01） [Wave 3]
- [x] 03-04-PLAN.md — OA設定ページ（OA-01）+ RLSマトリクス/モック認証テスト（成功条件1・6） [Wave 3]

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-05-PLAN.md — 回答状況タブ（ADMIN-01）+ 手動紐付けUI（ADMIN-02）+ フェーズゲート [Wave 4]

### Phase 4: 通知 + 統合仕上げ

**Goal**: 主催者への更新通知・テンプレート再利用・root横断管理が動作し、実Twipla URLでのE2E通しで本番運用に耐える
**Depends on**: Phase 2, Phase 3
**Requirements**: NOTIF-01, OA-03
**Success Criteria** (what must be TRUE):

  1. 開催2日前以降にメンバーの出欠・最終確認に更新があると、owner/co-ownerのLINEへ都度通知が届く（2日前より前の更新では通知されないことも含めテストで検証できる）
  2. 定型質問のテンプレートを保存し、別イベント・別OAで再利用できる
  3. rootユーザーは全OA・全イベント・全データを横断閲覧できる（OA-02のroot権限部分の完成。owner/co-ownerスコープとの権限差がテストで検証できる）
  4. 実Twipla URLを使ったE2E通し（スクレイピング→手動紐付け→配信→1問1答回答→保存→管理者通知→管理画面で確認）が成功する

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:** 1 → 2 → 3 → 4（Phase 2と3はともにPhase 1のみに依存するが、自律実行では番号順に進める）

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 基盤構築 + スクレイピング検証 | 3/3 | Complete   | 2026-06-11 |
| 2. LINE Botコア機能 | 4/4 | Complete   | 2026-06-11 |
| 3. 管理画面 | 5/5 | Complete   | 2026-06-12 |
| 4. 通知 + 統合仕上げ | 0/? | Not started | - |

## Coverage

| Requirement | Phase |
|-------------|-------|
| EVENT-02 | 1 |
| LINE-01, LINE-02, LINE-03 | 2 |
| AUTH-01, EVENT-01, ADMIN-01, ADMIN-02, OA-01, OA-02 | 3 |
| NOTIF-01, OA-03 | 4 |

✓ 12/12 v1要件マッピング済み・重複なし（OA-02のroot権限部分のみPhase 4成功条件3で完成検証）

---
*Roadmap created: 2026-06-12 from docs.md ingest*
