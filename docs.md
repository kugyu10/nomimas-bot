# nomimas 要件・決定事項まとめ

> オフ会主催者向けの最終確認自動化ツール。
> これまでの要件定義（PROJECT.md / REQUIREMENTS.md / ROADMAP.md）で決まったことを集約したドキュメント。
> 最終更新: 2026-06-11

---

## 1. これは何か（プロダクト概要）

Twiplaで参加表明した人に対して、LINEで最終確認メッセージ（イベント情報＋定型質問）を自動配信し、回答を収集するツール。**主催者の手作業をゼロにすること**が目的。

**Core Value:** Twiplaの参加者リスト取得から最終確認の配信・回答収集まで、主催者の手作業がゼロであること。

### 背景・解決したい課題
- 現在はTwiplaで参加表明を受け、TwitterのDMで一人ずつ手作業で最終確認を送っている
- DMの送信漏れ・忘れ、相互フォローでないと送れない問題がある
- 月に数回、参加者10〜30人規模のオフ会を主催
- 現状はアイマス好きのオフ会だが、将来的にRoselia、Vtuberなど別コミュニティのオフ会も主催予定
- LINE公式アカウントをコミュニティごとに作り、それぞれ独立した設定を持たせる
- 最終確認の質問はほぼ毎回同じ（年齢確認、飲酒有無、遅刻早退予定など）

---

## 2. 用語定義

| 用語 | 意味 |
|------|------|
| **root** | 特権管理者。システムの全OA・全イベント・全データを閲覧・管理できる |
| **line-oa** | LINE公式アカウント。本システムでは1つのオフ会（定期開催ならN回分）と紐づくLINE公式アカウント |
| **owner** | オフ会のオーナー（主催者） |
| **co-owner** | 副オーナー、オフ会の共同主催者（いれば） |
| **member** | LINE公式アカウントの友だち。オフ会に興味がある／1回でも参加したことがある全員。LineUserIdと紐づく |

### 権限モデル（root / owner / co-owner の3段階）
- **root**: 全OA・全イベント・全データ閲覧可
- **owner / co-owner**: 自分に紐付くOA・イベントのみ閲覧可

---

## 3. 技術スタック（決定済み）

| 領域 | 採用技術 |
|------|----------|
| バックエンド処理 | **Supabase Edge Functions** + **pg_cron**（スケジュール実行） |
| データベース | **Supabase（PostgreSQL）** + Row Level Security |
| LINE連携 | **LINE Messaging API**（`@line/bot-sdk` v11） |
| 管理画面 | **Next.js 16** + **shadcn/ui** + **Tailwind CSS v4** |
| 管理画面ホスティング | **Vercel**（無料デプロイ） |
| 認証 | **X(Twitter) OAuth**（Supabase Auth公式サポート） |
| スクレイピング | **cheerio**（Twiplaは静的HTML、対応確認済み） |
| 言語 | **TypeScript 5.x** |
| バリデーション | **zod 4.x** |

### 環境構成
バックエンド（BE）は **Supabase** で構築する。開発と本番で Supabase プロジェクトを分離して運用する。

| 環境 | バックエンド | 用途 |
|------|------------|------|
| **開発環境** | 開発環境用 Supabase（別プロジェクト） | 機能開発・検証用。本番データに影響を与えずにマイグレーション/Edge Functions/LINE連携を試す |
| **本番環境** | 本番環境用 Supabase（別プロジェクト） | 実運用。実際のオフ会・参加者データを扱う |

- DB・Edge Functions・認証など BE 一式を環境ごとに独立した Supabase プロジェクトとして持つ
- 環境ごとに接続情報（URL・APIキー等）を切り替えて利用する

### コスト・スケール方針
- 個人開発のため低コスト運用。全てサーバーレスで**AWSアカウント不要**
- 月数回のイベント、各10〜30人程度の規模を想定

---

## 4. 主要な設計判断（Key Decisions）

| 決定 | 理由 | 状態 |
|------|------|------|
| 参加表明はTwiplaのまま | 既存フローを壊さない。参加者にとって慣れた方法を維持 | Pending |
| Twiplaスクレイピング = cheerio（Playwright不要） | curlで確認 → 静的HTML。`a.card.namelist` で参加者名取得可能 | ✓ 確認済み |
| バックエンドをSupabase Edge Functionsに統一 | Twiplaが静的HTMLと判明しPlaywright不要 → Lambda不要に。全スタックをSupabaseに統一でき管理コスト大幅減 | Pending |
| v1のLINE-Twipla紐付けは手動 | X名・Xアカウント名・LINE表示名の表記揺れが大きく、自動マッチングの精度を担保できない。v1で実態を把握してからv2で自動化 | Pending |
| イベント作成でURLを複数登録可能に | Twipla以外（Peatix、ジモティー等）への拡張を考慮。プロバイダーパターンで各URLのスクレイピング/API実装を差し替え可能に | Pending |
| LINE OA単位で設定を分離 | コミュニティごとに異なる定型文・質問・管理者を使いたい | Pending |

> **アーキテクチャの変遷:** 初期構想はAWS Lambda + API Gateway + EventBridge だったが、Twiplaが静的HTMLと判明したことでPlaywright（ヘッドレスブラウザ）が不要になり、Supabase Edge Functions + pg_cron に一本化した。

---

## 5. v1 要件一覧

### 認証（Authentication）
- **AUTH-01**: 管理者はX(Twitter) OAuthで管理画面にログインできる

### イベント管理（Event Management）
- **EVENT-01**: 管理者はイベントを作成できる（複数のイベントプラットフォームURL[Twipla, Peatix等]、集合時刻・場所・参加費・店情報を登録）
- **EVENT-02**: 管理者はイベントプラットフォームURLから参加者リストを自動取得できる（v1はTwiplaスクレイピング。将来的なJimoty・Peatix等への拡張を考慮したプロバイダー抽象化で実装）

### LINE Bot
- **LINE-01**: システムはイベントN日前に未確認の参加者へLINEで最終確認メッセージを自動配信できる
- **LINE-02**: 最終確認は1問1答形式で、ステートマシンで定型質問を順番に投げられる
- **LINE-03**: 参加者の回答がSupabaseに保存される

### 管理画面（Admin）
- **ADMIN-01**: 管理者は回答状況（誰が回答済み・未回答）を一覧確認できる
- **ADMIN-02**: 管理者はLINEユーザーとイベントプラットフォームの参加者名を手動で紐付けられる（v1は自動紐付けなし。表記揺れ問題のため）

### 通知（Notifications）
- **NOTIF-01**: 開催2日前以降、メンバーの出欠・最終確認に更新があった際、owner/co-ownerにLINEで都度通知する

### LINE OA設定（OA Settings）
- **OA-01**: LINE OAごとに定型文・質問内容・管理者Twitter IDを設定できる
- **OA-02**: 複数のLINE OAを1つの管理画面で管理できる。権限モデルはroot/owner/co-ownerの3段階
- **OA-03**: 定型質問のテンプレートを保存・再利用できる

> v1要件は計12個。すべてフェーズにマッピング済み（未マッピング: 0）。

---

## 6. v2以降の要件（設計には含めるが実装は後回し）

| ID | 内容 |
|----|------|
| **LINK-01** | LINE友だち追加時にTwipla名等を聞いて参加者と自動紐付け（v1の手動運用で表記揺れの実態を把握後に実装） |
| **DATA-01** | 回答CSVエクスポート（当日の受付・集計用） |
| **REMIND-01** | イベント当日まで未回答の参加者へリマインド配信 |

### さらに将来の拡張構想
- ユーザー個人の行動履歴トラッキング（ドタキャン有無、皆勤賞判定など）
- 全体のアナリティクス・統計可視化（参加率ランキングなど）
- SaaS化

---

## 7. スコープ外（Out of Scope）

| 機能 | 理由 |
|------|------|
| LINE上での参加表明機能 | 参加表明はTwiplaで行う。既存フローを壊さない |
| イベント告知のLINE一斉配信 | v1では最終確認のみ。告知はLINE OA Managerで十分 |
| 開催2日前より前のリアルタイム通知 | NOTIF-01で2日前以降は対応。それより前は管理画面で確認 |
| リマインド機能（v1） | v1では最終確認の1回配信のみ。v2で検討 |
| モバイルアプリ | Web管理画面で十分。開発コスト大 |
| LINE Flexメッセージの複雑なUI | シンプルなテキスト + Quick Replyで実装。Flexは後回し |

---

## 8. ロードマップ（フェーズ構成）

**モード:** MVP / **粒度:** coarse / **v1要件:** 12個

### Phase 1: 基盤構築 + スクレイピング検証
最大リスク（Twiplaスクレイピング）を最初に潰し、DB・Edge Functions・LINE Webhookの土台を作る。
- **対象要件:** EVENT-02
- **成功条件:**
  1. cheerioによるTwiplaスクレイピングで `a.card.namelist` から参加者名・Xアカウント名リストを正しく取得できる
  2. 本番スキーマ（events / event_platform_urls / participants / line_users / oa_configs / answers）がマイグレーションで再現できる
  3. LINE WebhookのEdge Functionが署名検証をパスしてメッセージを受信できる
  4. Edge Functions 3本（webhook / scraper / message-sender）がデプロイされログ確認できる
- **プラン:** 3本（モノリポ初期化＋DBスキーマ / 共有モジュール＋scraper / webhook＋message-sender雛形）

### Phase 2: LINE Botコア機能
1問1答ステートマシン・回答保存・スケジュール配信を実装し、E2Eの自動確認フローを完成させる。
- **対象要件:** LINE-01, LINE-02, LINE-03
- **依存:** Phase 1
- **成功条件:** pg_cronによる自動トリガー配信 / 1問ずつの質問送信 / Quick Reply回答で次問へ・完了表示 / answersテーブルへの正しい保存

### Phase 3: 管理画面
X OAuth認証・イベント管理・回答状況一覧・手動紐付け・OA設定を実装し、主催者が全操作をUIで完結できるようにする。
- **対象要件:** AUTH-01, EVENT-01, ADMIN-01, ADMIN-02, OA-01, OA-02
- **依存:** Phase 1
- **成功条件:** X認証ログイン＋owner/co-ownerスコープ / イベント作成保存 / 回答状況一覧 / 手動紐付け / OA設定UI

### Phase 4: 通知 + 統合仕上げ
開催2日前以降の更新通知・質問テンプレート・root権限を追加し、本番運用に耐える状態にする。
- **対象要件:** NOTIF-01, OA-03, OA-02（root権限部分）
- **依存:** Phase 2, Phase 3
- **成功条件:** 2日前以降の更新通知 / テンプレート保存・再利用 / root横断閲覧 / 実Twipla URLでのE2E通し動作

### 要件 → フェーズ対応表

| 要件 | フェーズ |
|------|---------|
| AUTH-01 | Phase 3 |
| EVENT-01 | Phase 3 |
| EVENT-02 | Phase 1 |
| LINE-01 / 02 / 03 | Phase 2 |
| ADMIN-01 / 02 | Phase 3 |
| NOTIF-01 | Phase 4 |
| OA-01 | Phase 3 |
| OA-02 | Phase 3 + Phase 4（root権限） |
| OA-03 | Phase 4 |

---

## 9. 想定する処理の流れ

1. **イベント作成:** 管理画面からイベントを作成 → DBに登録（複数のプラットフォームURLを登録可）
2. **参加者取得:** pg_cron or 手動トリガーでscraper Edge FunctionがTwiplaをスクレイピング → 参加者リストをDB保存
3. **紐付け:** 管理者が管理画面でLINEユーザーとTwipla参加者名を手動で紐付け（v1）
4. **最終確認配信:** イベントN日前にpg_cronがトリガー → 未確認の参加者へLINEで最終確認メッセージを自動配信
5. **1問1答回答:** 参加者がLINEのQuick Replyで回答 → ステートマシン制御で次の質問を順次送信 → 全問回答で完了表示
6. **回答保存:** 回答はSupabaseのanswersテーブルにparticipant_idと紐付けて保存
7. **管理者通知:** 開催2日前以降に出欠・最終確認の更新があれば owner/co-owner のLINEへ都度通知
8. **状況確認:** 管理者は管理画面で回答状況（回答済み・未回答）を一覧確認

---

*このドキュメントは PROJECT.md / REQUIREMENTS.md / ROADMAP.md および初期検討メモ（requirements.md, .planning/research）を統合したものです。各フェーズの遷移・マイルストーン境界で更新されます。*
