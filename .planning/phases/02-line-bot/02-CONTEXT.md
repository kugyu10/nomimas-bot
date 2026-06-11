# Phase 2: LINE Botコア機能 - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 推奨案を自動採用（夜間無人実行）

<domain>
## Phase Boundary

イベントN日前の自動配信から1問1答の回答収集・保存まで、参加者側のフローが手作業ゼロで完結する。具体的には:

- pg_cron日次トリガー → 配信対象抽出（未確認・N日前条件）→ message-senderによる最終確認メッセージ自動配信（LINE-01）
- 1問1答ステートマシン: Quick Reply回答ごとに次の質問へ遷移、全問回答で完了（LINE-02）
- 回答のanswersテーブル保存（participant_id紐付け、LINE-03）

管理画面（紐付けUI・回答状況一覧）はPhase 3、owner/co-ownerへの更新通知・テンプレートはPhase 4のスコープ。

</domain>

<decisions>
## Implementation Decisions

### 配信メッセージ・質問定義
- 質問定義は `oa_configs.questions` JSONB配列（各要素: id / text / options[]）。Phase 2ではseedで定型3問（年齢確認・飲酒有無・遅刻早退予定）を投入。Phase 3のOA-01 UI編集・Phase 4のOA-03テンプレートがこの構造に載る
- 初回配信 = イベント情報（日時・集合場所・参加費・店情報）＋案内文＋Q1を続けて送信（push message、複数message同梱可）
- 回答UIはQuick Reply（選択肢ボタン）。Flexメッセージは使わない（スコープ外決定済み）
- 全問回答で完了メッセージ送信＋確認ステータスを完了状態に更新

### ステートマシン設計
- 状態は `participants` テーブルに保持: `confirm_status`（pending → sent → in_progress → completed）+ `current_question_index int`。別テーブルは作らない
- Quick Reply の postback data に participant_id / question_id を埋め込み、回答とイベント・質問の対応を厳密化（同一memberの複数イベント並行に自然対応）
- 想定外入力（postback以外のテキスト等）: 進行中の質問をQuick Reply付きで再送（誘導文を添える）。進行中でないユーザーのメッセージには応答しない（自動応答はLINE OA Manager側の領分）
- 回答修正はv1非対応。完了メッセージに「修正があれば主催者へ連絡」を含める

### スケジュール配信
- N日前のNは `events.confirm_days_before int default 7`（イベント単位設定）
- pg_cron 日次ジョブ（01:00 UTC = 10:00 JST）→ pg_net または supabase cron 機構で message-sender Edge Function を呼び出し
- 配信対象: line_user_id 紐付け済み かつ confirm_status='pending' かつ status='attending' かつ イベント開催日まで confirm_days_before 日以内。未紐付け参加者はスキップ（件数のみログ）
- 重複防止: 送信成功で即 confirm_status='sent' に更新。配信ログテーブルは作らない

### 回答保存
- answers: participant_id + question_id + question_text スナップショット + answer + answered_at。`unique(participant_id, question_id)` でUPSERT（再回答は上書き）
- 質問テキストのスナップショットを保存（後でOA設定が変わっても回答時点の質問が分かる）

### 検証方針
- 全状態遷移は webhook への署名付きcurl（Quick Reply postbackシミュレーション）で機械検証。実LINEアカウントでの受信確認はHUMAN-UATへ
- cronジョブは登録の存在 + 抽出ロジックのSQL/関数テストで機械検証（実時刻待ちはしない）

### Claude's Discretion
上記以外の実装詳細（関数分割、メッセージ文面の文言、テスト構成、マイグレーション分割）はClaudeの裁量。Phase 1の確立パターン（_shared モジュール、Web Crypto署名検証、ステートレストークンv3、--use-api + --import-map デプロイ、db reset --linked）に従う。

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_shared/line/signature.ts`（検証済み署名バリデーション）/ `_shared/line/token.ts`（ステートレストークンv3発行）
- `_shared/supabase.ts`（service roleクライアント）/ `_shared/providers/*`（scraper系）
- `webhook/index.ts`（署名検証→200の雛形。ここにステートマシンを実装）
- `message-sender/index.ts`（トークン発行確認のみの雛形。ここに配信ロジックを実装）
- migrations 2本（7テーブル+RLS）。スキーマ変更は既存マイグレーション in-place 編集 + `db reset --linked --yes`（Phase 1で確立した方式、devは使い捨て）

### Established Patterns
- テスト: `supabase/functions/tests/`、`deno test --config supabase/functions/deno.json --allow-read`。ライブテストは `LIVE_TEST=1` ゲート
- デプロイ: `supabase functions deploy <fn> --project-ref "$DEV_PROJECT_REF" --use-api --import-map supabase/functions/deno.json`（webhookは `--no-verify-jwt`）
- DB接続: 直接接続はIPv6限定DNSで不可。`supabase db reset --linked --yes`（link先devをsupabase/.temp/linked-project.jsonで確認してから）
- TDD: RED→GREEN コミットパターン（Phase 1で実施）

### Integration Points / Phase 1繰越課題（01-REVIEW.md Deferred）
- IN-06: `line_users.line_user_id` のグローバルuniqueはマルチOA要件と矛盾 — Phase 2で `unique(oa_config_id, line_user_id)` へ修正（oa_config_id の nullable 設計も整理）
- IN-08: event_platform_urls.url の正規化（クエリ付きURLが保存とマッチしない）— scraperとの突き合わせ時に正規化関数を導入（軽量対応）
- IN-09: 再スクレイプ時のstale participants（参加取り消し）— 配信対象抽出が `status='attending'` を見ることで配信面は安全。行削除はPhase 4整理でも可

</code_context>

<specifics>
## Specific Ideas

- 定型3問のseed: ①年齢確認（20歳以上です/未成年です）②飲酒（飲む/飲まない）③遅刻早退（なし/遅刻予定/早退予定）
- E2Eテストシナリオ: seed投入 → message-sender呼び出し（cron相当）→ 配信対象抽出検証 → webhookへpostback curl×3問 → answers 3行 + confirm_status='completed' をDB検証
- LINE push送信は実チャネル（dev OA）に対して行われるため、テスト用line_user_idは実在しない値だとLINE API 400になる — 送信部はモック可能な構造（sender関数をDI/環境フラグでdry-run）にし、実配信はLIVE_TEST=1ゲートまたはHUMAN-UATで確認

</specifics>

<deferred>
## Deferred Ideas

- リマインド配信（REMIND-01, v2）/ 回答CSVエクスポート（DATA-01, v2）/ 自動紐付け（LINK-01, v2）
- IN-05（auth.usersへのFK）: Phase 3の認証実装時に対応

</deferred>
