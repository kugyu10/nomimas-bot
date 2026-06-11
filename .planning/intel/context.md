# Context Intel

Background, terminology, roadmap, and process-flow notes mined from the
consolidated PRD. All entries: source: /Users/kugyu10/work/nomimas-bot/docs.md

---

## Topic: プロダクト概要 / Core Value
- source: /Users/kugyu10/work/nomimas-bot/docs.md §1
- nomimas: Twiplaで参加表明した人に対し、LINEで最終確認メッセージ（イベント情報＋定型質問）を自動配信し、回答を収集するツール
- Core Value: Twiplaの参加者リスト取得から最終確認の配信・回答収集まで、主催者の手作業がゼロであること

## Topic: 背景・解決したい課題
- source: /Users/kugyu10/work/nomimas-bot/docs.md §1
- 現在はTwiplaで参加表明を受け、TwitterのDMで一人ずつ手作業で最終確認を送っている
- DMの送信漏れ・忘れ、相互フォローでないと送れない問題がある
- 月に数回、参加者10〜30人規模のオフ会を主催
- 現状はアイマス好きのオフ会だが、将来的にRoselia、Vtuberなど別コミュニティのオフ会も主催予定
- LINE公式アカウントをコミュニティごとに作り、それぞれ独立した設定を持たせる
- 最終確認の質問はほぼ毎回同じ（年齢確認、飲酒有無、遅刻早退予定など）

## Topic: 用語定義
- source: /Users/kugyu10/work/nomimas-bot/docs.md §2
- root: 特権管理者。システムの全OA・全イベント・全データを閲覧・管理できる
- line-oa: LINE公式アカウント。本システムでは1つのオフ会（定期開催ならN回分）と紐づく
- owner: オフ会のオーナー（主催者）
- co-owner: 副オーナー、オフ会の共同主催者（いれば）
- member: LINE公式アカウントの友だち。オフ会に興味がある／1回でも参加したことがある全員。LineUserIdと紐づく

## Topic: ロードマップ（フェーズ構成）
- source: /Users/kugyu10/work/nomimas-bot/docs.md §8
- モード: MVP / 粒度: coarse / v1要件: 12個（全件マッピング済み、未マッピング0）
- Phase 1: 基盤構築 + スクレイピング検証 — 対象: EVENT-02。最大リスク（Twiplaスクレイピング）を最初に潰す。プラン3本（モノリポ初期化＋DBスキーマ / 共有モジュール＋scraper / webhook＋message-sender雛形）
- Phase 2: LINE Botコア機能 — 対象: LINE-01, LINE-02, LINE-03。依存: Phase 1
- Phase 3: 管理画面 — 対象: AUTH-01, EVENT-01, ADMIN-01, ADMIN-02, OA-01, OA-02。依存: Phase 1
- Phase 4: 通知 + 統合仕上げ — 対象: NOTIF-01, OA-03, OA-02（root権限部分）。依存: Phase 2, Phase 3。実Twipla URLでのE2E通し動作が成功条件に含まれる

## Topic: 要件 → フェーズ対応表
- source: /Users/kugyu10/work/nomimas-bot/docs.md §8
- AUTH-01 → Phase 3 / EVENT-01 → Phase 3 / EVENT-02 → Phase 1
- LINE-01/02/03 → Phase 2 / ADMIN-01/02 → Phase 3
- NOTIF-01 → Phase 4 / OA-01 → Phase 3 / OA-02 → Phase 3 + Phase 4（root権限）/ OA-03 → Phase 4

## Topic: 想定する処理の流れ
- source: /Users/kugyu10/work/nomimas-bot/docs.md §9
1. イベント作成: 管理画面からイベント作成 → DB登録（複数プラットフォームURL登録可）
2. 参加者取得: pg_cron or 手動トリガーで scraper Edge Function がTwiplaをスクレイピング → 参加者リストをDB保存
3. 紐付け: 管理者が管理画面でLINEユーザーとTwipla参加者名を手動紐付け（v1）
4. 最終確認配信: イベントN日前にpg_cronトリガー → 未確認参加者へLINE自動配信
5. 1問1答回答: Quick Replyで回答 → ステートマシン制御で次問送信 → 全問回答で完了表示
6. 回答保存: answersテーブルに participant_id 紐付けで保存
7. 管理者通知: 開催2日前以降の出欠・最終確認更新を owner/co-owner のLINEへ都度通知
8. 状況確認: 管理画面で回答状況を一覧確認

## Topic: 将来の拡張構想（v2より先）
- source: /Users/kugyu10/work/nomimas-bot/docs.md §6
- ユーザー個人の行動履歴トラッキング（ドタキャン有無、皆勤賞判定など）
- 全体のアナリティクス・統計可視化（参加率ランキングなど）
- SaaS化

## Topic: 出典・更新ポリシー
- source: /Users/kugyu10/work/nomimas-bot/docs.md（末尾注記）
- 本ドキュメントは PROJECT.md / REQUIREMENTS.md / ROADMAP.md および初期検討メモ（requirements.md, .planning/research）を統合した一次資料
- 最終更新: 2026-06-11。各フェーズの遷移・マイルストーン境界で更新される
