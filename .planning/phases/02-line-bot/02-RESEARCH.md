# Phase 2: LINE Botコア機能 - Research

**Researched:** 2026-06-12
**Domain:** pg_cron/pg_net/Vaultによるスケジュール配信 + LINE Messaging API（push/reply/Quick Reply/postback）+ 1問1答ステートマシン
**Confidence:** HIGH（cron→Edge Functionの全チェーンとVaultのdb reset耐性を本セッションでdev実機検証済み。LINE API仕様は公式ドキュメントで確認）

## Summary

本フェーズ最大の不確実性だった「pg_cronからEdge Functionをシークレット非コミットで呼ぶ」経路は、**本リサーチ中にdev実機でエンドツーエンド検証済み**。pg_cron 1.6.4 / pg_net 0.20.3 は `create extension if not exists` で有効化でき、`cron.schedule` のジョブ本文から `vault.decrypted_secrets`（name='project_url' / 'cron_function_key'）を参照して `net.http_post` でmessage-senderを呼び出し、HTTP 200（tokenIssued:true）を確認した。さらに `supabase db reset --linked --yes` を実際に実行して検証した結果、**Vaultのシークレットはdb resetを生き残るが、pg_cron拡張とcronジョブは消える**。したがって「extension作成 + cron.schedule はマイグレーションに置き、Vaultシークレット投入は冪等なセットアップスクリプト（値はenv.devから読む・コミットしない）」が正しい分担になる。

LINE側はクォータ戦略が要点。無料プラン（コミュニケーションプラン）は月200通だが、**カウントは「送信対象人数」単位でバブル数は無関係**、かつ**応答メッセージ（reply）はカウント対象外**であることを公式料金ドキュメントで確認した。よって初回配信（イベント情報＋案内文＋Q1を1回のpushに最大5バブル同梱）= 参加者1人あたり1通のみ消費し、以降の質問送信・再誘導・完了メッセージはすべてwebhookイベントのreplyToken（postbackイベントにも付与される）で無料送信できる。replyTokenは1回限り・約1分有効のため、「DB更新→reply送信」の順序と、1回のreply呼び出しに必要バブルをまとめる設計が必須。

psqlは未インストールだが、Deno + `npm:postgres@3.4.9` でセッションプーラー（aws-1-ap-northeast-1.pooler.supabase.com:5432、直接接続はIPv6限定DNSのため不可）経由のSQL実行が機能することを本セッションで繰り返し実証した。cronジョブ登録確認・抽出ロジック検証・Vaultセットアップはすべてこのパターンで機械検証できる。

**Primary recommendation:** cron登録とextensionは新規マイグレーション、Vault投入は冪等セットアップスクリプト（Deno+pooler）、配信対象抽出はSQL関数 `get_confirm_targets()`（RPC経由でテスト可能）、ステートマシンは `_shared/confirm/` の純関数 + LINE送信は `LINE_DRY_RUN` フラグでモック可能な薄いクライアントに分離する。

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### 配信メッセージ・質問定義
- 質問定義は `oa_configs.questions` JSONB配列（各要素: id / text / options[]）。Phase 2ではseedで定型3問（年齢確認・飲酒有無・遅刻早退予定）を投入。Phase 3のOA-01 UI編集・Phase 4のOA-03テンプレートがこの構造に載る
- 初回配信 = イベント情報（日時・集合場所・参加費・店情報）＋案内文＋Q1を続けて送信（push message、複数message同梱可）
- 回答UIはQuick Reply（選択肢ボタン）。Flexメッセージは使わない（スコープ外決定済み）
- 全問回答で完了メッセージ送信＋確認ステータスを完了状態に更新

#### ステートマシン設計
- 状態は `participants` テーブルに保持: `confirm_status`（pending → sent → in_progress → completed）+ `current_question_index int`。別テーブルは作らない
- Quick Reply の postback data に participant_id / question_id を埋め込み、回答とイベント・質問の対応を厳密化（同一memberの複数イベント並行に自然対応）
- 想定外入力（postback以外のテキスト等）: 進行中の質問をQuick Reply付きで再送（誘導文を添える）。進行中でないユーザーのメッセージには応答しない（自動応答はLINE OA Manager側の領分）
- 回答修正はv1非対応。完了メッセージに「修正があれば主催者へ連絡」を含める

#### スケジュール配信
- N日前のNは `events.confirm_days_before int default 7`（イベント単位設定）
- pg_cron 日次ジョブ（01:00 UTC = 10:00 JST）→ pg_net または supabase cron 機構で message-sender Edge Function を呼び出し
- 配信対象: line_user_id 紐付け済み かつ confirm_status='pending' かつ status='attending' かつ イベント開催日まで confirm_days_before 日以内。未紐付け参加者はスキップ（件数のみログ）
- 重複防止: 送信成功で即 confirm_status='sent' に更新。配信ログテーブルは作らない

#### 回答保存
- answers: participant_id + question_id + question_text スナップショット + answer + answered_at。`unique(participant_id, question_id)` でUPSERT（再回答は上書き）
- 質問テキストのスナップショットを保存（後でOA設定が変わっても回答時点の質問が分かる）

#### 検証方針
- 全状態遷移は webhook への署名付きcurl（Quick Reply postbackシミュレーション）で機械検証。実LINEアカウントでの受信確認はHUMAN-UATへ
- cronジョブは登録の存在 + 抽出ロジックのSQL/関数テストで機械検証（実時刻待ちはしない）

### Claude's Discretion
上記以外の実装詳細（関数分割、メッセージ文面の文言、テスト構成、マイグレーション分割）はClaudeの裁量。Phase 1の確立パターン（_shared モジュール、Web Crypto署名検証、ステートレストークンv3、--use-api + --import-map デプロイ、db reset --linked）に従う。

### Deferred Ideas (OUT OF SCOPE)
- リマインド配信（REMIND-01, v2）/ 回答CSVエクスポート（DATA-01, v2）/ 自動紐付け（LINK-01, v2）
- IN-05（auth.usersへのFK）: Phase 3の認証実装時に対応
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LINE-01 | システムはイベントN日前に未確認の参加者へLINEで最終確認メッセージを自動配信できる | pg_cron+pg_net+Vaultの全チェーンをdev実機で検証済み（cron tick→net.http_post→message-sender 200）。スケジュールSQL・Vault分担・抽出SQL関数案をCode Examples/Architecture Patternsに提示。push API仕様・X-Line-Retry-Key・クォータ計算を公式docで確認 |
| LINE-02 | 最終確認は1問1答形式で、ステートマシンで定型質問を順番に投げられる | Quick Reply（≤13項目・label≤20字・postback data≤300字）/ postbackイベント形状 / replyToken（1回限り・約1分）を公式docで確認。純関数ステートマシン + reply送信パターンをArchitecture Patternsに提示 |
| LINE-03 | 参加者の回答がSupabaseに保存される | 既存answersテーブル（unique(participant_id, question_key)）を確認済み — UPSERT上書き決定と整合。answered_at更新の罠と必要スキーマ変更を特定。署名付きcurl→DB検証の経路はPhase 1で確立済み |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` は存在しない。Phase 1から引き継ぐプロジェクト規約（PROJECT.md / NIGHT-RUN.md / 01-RESEARCH.md 由来）:

- **prod接触禁止**: `hgojtooexbknqotzkkja` を一切使わない。全コマンドで `--project-ref "$DEV_PROJECT_REF"` / linked先（supabase/.temp/linked-project.json = cmsxvxtcdniqgvhxjqri を本セッションで確認済み）を明示
- **publicリポジトリ**: シークレット（service roleキー・anonキー・channel secret・チャネルID含め）をマイグレーション/seed/コードにコミットしない。Vaultシークレットは**名前のみ**SQLに書く
- **夜間無人実行前提**: 全コマンド非対話。成功条件は機械検証可能であること

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 日次スケジュールトリガー | Database (pg_cron + pg_net) | — | DB内蔵cronが唯一の常駐実行環境。シークレットはVault参照 |
| 配信対象抽出 | Database (SQL関数 `get_confirm_targets()`) | API (message-senderがRPC呼び出し) | 日付演算・JOIN条件はSQLが自然で、RPC経由でテスト可能（CONTEXT検証方針に合致） |
| 初回確認push配信 | API/Backend (Edge Fn: message-sender) | — | トークンv3発行 + LINE push API + confirm_status更新をアトミックに近く実行 |
| 1問1答ステートマシン | API/Backend (_shared/confirm 純関数) | Database (participants状態列) | 遷移ロジックは純関数（unit test対象）、永続状態はparticipantsのみ |
| 回答保存（UPSERT） | API/Backend (Edge Fn: webhook) | Database (answers unique制約) | webhookがpostbackを検証して書き込み。冪等性はunique制約+UPSERT |
| reply/push送信 | API/Backend (_shared/line/client) | — | DRY_RUNフラグ・payload検証を一点に集約 |
| follow（友だち追加）記録 | API/Backend (Edge Fn: webhook) | Database (line_users) | IN-06修正後の `unique(oa_config_id, line_user_id)` へUPSERT |
| シークレット保管 | Database (Vault) + Supabase Secrets | — | cron用はVault（db reset耐性を実証済み）、Edge Fn用はsecrets set |

## Standard Stack

### Core（新規ランタイム依存なし — Phase 1スタックを継続）
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.4.3（deno.json固定済み） | webhookイベント（postback/follow/message）形状検証・postback dataパース検証 | Phase 1導入済み [VERIFIED: deno.json実読] |
| @supabase/supabase-js | 2.108.1（固定済み） | DB読み書き・RPC呼び出し（service role） | Phase 1導入済み [VERIFIED: deno.json実読] |
| Web Crypto / fetch（Deno同梱） | Deno 2.8.2 | LINE署名検証（既存）・push/reply API呼び出し・`crypto.randomUUID()`でretry key | Phase 1確立パターン。@line/bot-sdkは使わない（Locked constraint: Denoでの動作未検証のため raw fetch継続） |
| pg_cron | 1.6.4 | 日次配信トリガー | devで`create extension`成功・ジョブ実行成功を実機確認 [VERIFIED: 本セッションで実行] |
| pg_net | 0.20.3 | cronからのEdge Function HTTP呼び出し（非同期） | `net.http_post`→message-sender 200を実機確認 [VERIFIED: 本セッションで実行] |
| supabase_vault | 0.3.1（インストール済み） | cron SQL内のURL/認可キーの秘匿 | `vault.create_secret`/`decrypted_secrets`動作確認・**db reset耐性を実証** [VERIFIED: 本セッションで実行] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| postgres (porsager) | 3.4.9 | スクリプト/テストからのdev DB SQL実行（プーラー経由） | psql不在の代替。`npm:postgres@3.4.9` 指定子でDenoから直接利用（npm installは不要）。本セッションで pooler接続・DDL・cron操作すべて成功 [VERIFIED: npm registry + slopcheck OK + 実機動作] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pg_cron+pg_net+Vault（SQL管理） | Supabase Dashboard「Cron」統合UI | UIは再現性がない（db resetで消えた時に手動再設定）。マイグレーション+Vaultならreset後も自動復元（実証済み） |
| Vaultにanonキー格納 | service roleキー格納 / verify_jwt=false+独自ヘッダ | message-senderのゲートウェイJWT検証はanonキーで通過する（200確認済み）。最小権限の原則でanonキーを使う（関数内部はservice role） |
| raw fetch + zod | @line/bot-sdk v11 | SDKはNode向けでEdge Functions動作未検証（Locked: 検証なしでは使用不可）。必要APIは push/reply の2エンドポイントのみで、raw fetchが確実 |
| 抽出ロジックをSQL関数 | supabase-jsクエリをTSで組む | SQL関数はRPC単体テスト可能・cron/管理画面から再利用可能・日付演算が明確。TS側はフィルタ済み結果を受け取るだけにする |

**Installation:**
```bash
# 新規インストールなし。Deno の npm: 指定子で解決:
#   scripts/tests: import postgres from "npm:postgres@3.4.9";
# deno.json imports に "postgres": "npm:postgres@3.4.9" を追加推奨
```

**Version verification:** 実施済み（2026-06-12）: `npm view postgres version` → 3.4.9（repository: github.com/porsager/postgres、最終更新2026-04-05、postinstallなし）。zod/supabase-jsはPhase 1検証済みバージョンをdeno.jsonで固定済み。

## Package Legitimacy Audit

slopcheck（pipx経由でインストール）を npm エコシステム指定で実行。

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| postgres | npm | 7年超 | 数十万/wk級 | github.com/porsager/postgres | [OK] | Approved（scripts/テスト専用。Edge Functionランタイムには載せない） |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**postinstallスクリプト:** なし [VERIFIED: npm view scripts.postinstall 空]

その他の使用パッケージ（zod / @supabase/supabase-js）はPhase 1で監査済み[OK]・バージョン固定済みのため再監査不要。

## Architecture Patterns

### System Architecture Diagram

```
[pg_cron job 'confirm-broadcast-daily' @ '0 1 * * *' UTC(=10:00 JST)]
    |  select net.http_post(
    |    url  := vault('project_url') || '/functions/v1/message-sender',
    |    headers := 'Authorization: Bearer ' || vault('cron_function_key'))   ← シークレットはVault名参照のみ
    v
[Edge Fn: message-sender (verify_jwt=true, anonキーで通過)]
    |-- supabase.rpc('get_confirm_targets')  → 配信対象（attending ∧ pending ∧ 紐付け済み ∧ N日以内）
    |-- 未紐付け件数をカウントしてログ（スキップ）
    |-- issueStatelessToken(v3, 15分)  … 1バッチ1回
    |-- 対象ごと: push(to=line_user_id, messages=[イベント情報, 案内文, Q1+QuickReply] ≤5バブル,
    |             X-Line-Retry-Key=crypto.randomUUID())   ← 1人=1通カウント
    '-- 送信成功ごとに confirm_status='sent', current_question_index=0 を即更新

[LINE Platform] --POST + x-line-signature--> [Edge Fn: webhook (verify_jwt=false)]
    |-- 署名検証（既存） → zodイベント検証 → イベント種別ルーティング
    |-- postback: data("p=<participant_id>&q=<question_id>&a=<option_index>")をパース
    |     |-- 検証: participant実在 ∧ source.userIdとparticipantのline_userが一致（なりすまし防止）
    |     |-- answers UPSERT（質問文スナップショット + answered_at更新）
    |     |-- transition()純関数 → 次質問 or 完了
    |     '-- reply(replyToken, [次のQ+QuickReply] or [完了メッセージ])  ← replyは無料・カウント外
    |-- message(進行中ユーザー): reply(replyToken, [誘導文＋現在のQ再送+QuickReply])
    |     （進行中でないユーザーには応答しない）
    '-- follow: line_users UPSERT（oa_config_id, line_user_id）

[supabase/migrations] --db reset --linked--> [Postgres]
    ├── 既存2本のin-place編集（questions列・state列・IN-06修正・check制約）
    └── 新規: create extension pg_cron/pg_net + cron.schedule + get_confirm_targets()
[scripts/setup-dev.ts (Deno+pooler, env.devから読む・冪等)]
    └── vault.create_secret('project_url'/'cron_function_key') + oa_configs.line_channel_id更新
        ※ Vaultシークレットはdb resetを生き残る（実証済み）→ 通常は再実行不要だが冪等に作る
```

### Recommended Project Structure（Phase 2追加分）
```
supabase/
├── migrations/
│   ├── 20260611171037_create_core_tables.sql   # in-place編集: questions/state列/IN-06/check制約
│   ├── 20260611171038_enable_rls.sql           # （必要なら）新列対応
│   └── <ts>_setup_cron_and_targets.sql         # 新規: extensions + get_confirm_targets() + cron.schedule
├── seed.sql                                     # 定型3問のquestions JSONBを追加投入
└── functions/
    ├── _shared/
    │   ├── confirm/
    │   │   ├── state.ts          # transition() 純関数（状態遷移の唯一の真実）
    │   │   ├── messages.ts       # 質問/完了/誘導メッセージのビルダー（QuickReply組み立て・文字数検証）
    │   │   └── postback.ts       # postback data の encode/decode + zod検証
    │   └── line/
    │       ├── client.ts         # pushMessage/replyMessage（LINE_DRY_RUNでモック・retry key付与）
    │       ├── events.ts         # webhookイベントのzodスキーマ（postback/follow/message）
    │       ├── signature.ts      # 既存
    │       └── token.ts          # 既存
    ├── webhook/index.ts          # ルーティング＋ステートマシン接続
    ├── message-sender/index.ts   # cron配信本体（rpc→push→状態更新）
    └── tests/
        ├── confirm_state_test.ts        # 全状態遷移 unit
        ├── postback_data_test.ts        # encode/decode・300字制限 unit
        ├── confirm_messages_test.ts     # QuickReply形状・label20字 unit
        ├── line_events_test.ts          # zodスキーマ unit
        └── e2e_confirm_flow_test.ts     # E2E_TEST=1ゲート: seed→sender→postback curl×3→DB検証
scripts/
    ├── db/sql.ts                 # pooler経由SQL実行ヘルパー（npm:postgres@3.4.9）
    ├── setup-dev.ts              # Vault投入 + oa_configs.line_channel_id更新（冪等・env.dev読み）
    └── verify-cron.ts            # cron.job登録確認 + 直近のjob_run_details/net._http_response確認
```

### Pattern 1: シークレット非コミットのcronスケジュール（Vault参照型 — 実機検証済み）
**What:** cron.schedule本文にはVaultシークレットの**名前だけ**を書き、値はDBのVaultに置く。マイグレーション（publicリポジトリにコミットされる）に秘密が一切載らない。
**When to use:** LINE-01のcron登録。Supabase公式の推奨パターンそのもの。
**Example:**
```sql
-- Source: supabase.com/docs/guides/functions/schedule-functions と同型。
-- 本セッションでdev実機において job_run_details 'succeeded' + net._http_response 200 を確認済み
create extension if not exists pg_cron;   -- pg_catalogに入る（実測）
create extension if not exists pg_net;

select cron.schedule(
  'confirm-broadcast-daily',
  '0 1 * * *',          -- 01:00 UTC = 10:00 JST（pg_cronはUTC動作）
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/message-sender',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'cron_function_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);
```
**重要な実測事実:**
- `cron.schedule` は同名ジョブを上書きする（冪等）。Vaultシークレットが未投入でも登録自体は成功する（本文はただのテキスト）— 実行時に初めて失敗するので、reset→setup-dev.tsの順序に強い依存はない
- Vaultシークレット `project_url` / `cron_function_key`（anonキー）は**本セッションで投入済み・db reset後も残存を確認済み**
- `net.http_post` は非同期（request_idを即返す）。HTTP結果は `net._http_response` テーブルで確認する（cronのstatus='succeeded'はHTTP成功を意味しない）

### Pattern 2: ステートマシンを純関数に分離
**What:** 遷移ロジック `transition(participant, questions, postbackPayload) → { nextStatus, nextIndex, answerRow, replyMessages }` をDB/ネットワーク非依存の純関数にする。webhookは「検証→transition→DB書き込み→reply送信」の薄いオーケストレータ。
**When to use:** LINE-02の全遷移をdeno test単体で網羅検証する（CONTEXT検証方針）。
**Example（推奨シグネチャ）:**
```typescript
// _shared/confirm/state.ts
export type ConfirmStatus = "pending" | "sent" | "in_progress" | "completed";
export interface Question { id: string; text: string; options: string[]; }

export interface TransitionResult {
  nextStatus: ConfirmStatus;
  nextIndex: number;
  answer: { questionId: string; questionText: string; answer: string } | null;
  reply: "next_question" | "completion" | "reprompt" | "none";
}

export function transition(
  current: { status: ConfirmStatus; index: number },
  questions: Question[],
  input: { questionId: string; optionIndex: number },
): TransitionResult { /* 純関数: 期待question一致→保存+前進 / 過去questionの再タップ→保存のみ(上書き)+現在Q再送 / 完了済み→none */ }
```
**設計上の決定点（裁量内推奨）:** postbackのquestion_idが現在の質問と一致する場合のみindexを前進。過去質問のQuick Reply再タップ（古いボタンは画面に残る）は回答をUPSERT上書きしつつ現在の質問を再送する — これがwebhook再配達（`deliveryContext.isRedelivery`）への冪等性も同時に与える。

### Pattern 3: reply優先のクォータ戦略
**What:** カウント対象になるのは初回push（1人1通）のみ。以降は必ずwebhookイベントのreplyTokenで送る。
**Why:** 無料200通/月 = 月200参加者まで配信可能になる。pushで質問を送る設計だと参加者×4倍消費する。
**根拠（公式確認済み）:**
- カウントは「メッセージの送信対象となった人数」— **1リクエストのバブル数（最大5）は通数に影響しない** [CITED: developers.line.biz/ja/docs/messaging-api/pricing/]
- 応答メッセージはカウント対象外 [CITED: 同上]
- postbackイベントにもreplyTokenが付与される [CITED: developers.line.biz/en/reference/messaging-api/ postback event]
- replyTokenは1回限り・受信後約1分。「時間制限に依存した実装をするな・即時使え」が公式注意 [CITED: developers.line.biz Send messages]
**含意:** 1回のreply呼び出しに送りたいバブル（誘導文＋質問など）をすべて同梱する。同じtokenで2回呼ぶと2回目は失敗する。

### Pattern 4: LINE送信のDRY_RUN（モック）クライアント
**What:** `_shared/line/client.ts` の pushMessage/replyMessage が `Deno.env.get("LINE_DRY_RUN") === "1"` のとき、payloadのzod検証＋構造化ログ（宛先はハッシュ化 or 末尾のみ）だけ行い実fetchをスキップする。
**When to use:** E2Eテスト（署名付きcurlのreplyTokenは偽物 → 実replyは400になる）とcron相当のsender呼び出し検証。実配信はHUMAN-UATで `supabase secrets unset LINE_DRY_RUN` 後に確認。
```bash
supabase secrets set --project-ref "$DEV_PROJECT_REF" LINE_DRY_RUN=1   # テスト時
supabase secrets unset --project-ref "$DEV_PROJECT_REF" LINE_DRY_RUN   # HUMAN-UAT前
```
[ASSUMED: secrets変更は再デプロイ不要で関数再起動により反映される — 実行時にsecrets set直後のcurlで実挙動を確認するタスクを入れること]

### Pattern 5: postback dataのエンコード（300字制限内・検証可能）
**What:** `URLSearchParams` 形式 `p=<participant_uuid>&q=<question_id>&a=<option_index>` を採用。回答は選択肢indexで運び、answer文字列は受信時に `questions[].options[index]` から解決してスナップショット保存する。
**Why:** uuid36字+question_id+index で約60字 — 300字制限 [CITED: LINE postback action data max 300] に余裕。自由文字列を運ばないことでエンコード事故を防ぐ。
**Security:** postback dataは改変可能な入力として扱う（zodでuuid/枚挙検証 + `source.userId` がparticipant→line_usersのline_user_idと一致することを必ず照合 — 他人のparticipant_idを差し込んだ回答なりすましを拒否する）。

### Anti-Patterns to Avoid
- **cron SQLにanonキー/service roleキー/プロジェクトURLを直書き**: マイグレーションはpublicリポジトリにコミットされる。Vault名参照のみ許可
- **cronジョブを手動SQL（マイグレーション外）で登録**: `db reset --linked` でpg_cronごと消えることを実証済み。マイグレーションに置かないと再現しない
- **質問ごとにpushで送る**: クォータを4倍消費。reply一択（Pattern 3）
- **reply送信後にDB更新**: reply失敗時に状態が進んでしまう、ではなく逆 — **DB更新を先に**行い、reply失敗時は次のユーザーメッセージで再誘導フローが回復させる
- **`participants.line_user_id`（uuid FK）とLINEの `userId`（"U…"文字列）の混同**: participants.line_user_id は line_users.id へのFK。LINEのuserIdは line_users.line_user_id。webhookでは (oa_config_id, line_user_id="U…") → line_users.id → participants の2段引き
- **@line/bot-sdkの安易な導入**: Deno動作未検証（Locked constraint）。raw fetch + zodで十分
- **テストで実在しないline_user_idへ実push**: LINE APIが4xxを返す。DRY_RUNフラグで遮断（CONTEXT specifics）

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| スケジューラ | 外部cron/GitHub Actions定期実行 | pg_cron + pg_net + Vault | DB内で完結・マイグレーションで再現・実機検証済み |
| シークレット配布 | 暗号化ファイル/独自仕組み | Vault (`vault.create_secret`) + `supabase secrets set` | db reset耐性実証済み。公式機構 |
| リトライ冪等性 | 送信済みフラグ独自管理 | X-Line-Retry-Key (UUID) | 公式: push/multicast等対応・重複は409+accepted-request-id・24h有効 [CITED: developers.line.biz retrying-api-request] |
| 回答の重複防止 | アプリ側での存在チェック | `unique(participant_id, question_id)` + UPSERT | DB制約が再配達・再タップ・並行を一括で吸収 |
| webhookイベント検証 | 手書きif | zod 4.4.3 スキーマ | postback/follow/messageの判別と型導出 |
| SQL実行（psql不在） | 独自HTTPラッパ | Deno + npm:postgres@3.4.9 + セッションプーラー | 本セッションでDDL/cron/Vault操作すべて成功 |

**Key insight:** このフェーズは「秘密を持たない再現可能なスケジュール配信」と「冪等なステートマシン」が価値。冪等性はアプリロジックではなくDB制約とLINEのretry key・index一致ガードに寄せるほど、テストすべき分岐が減る。

## スキーマ変更ガイド（既存マイグレーション実読に基づく必須差分）

現行 `20260611171037_create_core_tables.sql` の実態と必要変更（in-place編集 + db reset --linked が確立パターン）:

| テーブル | 現状（実読） | 必要な変更 | 理由 |
|---------|------------|-----------|------|
| oa_configs | questions列なし | `questions jsonb not null default '[]'::jsonb` 追加 | Locked: 質問定義はJSONB配列 |
| events | `confirm_days_before integer not null default 3` / `event_date date`（nullable）あり | **default 3 → 7 に変更**（Locked決定との不一致を発見） | CONTEXT: `default 7` |
| participants | `confirm_status text not null default 'pending'`（check制約なし）、question index列なし | `check (confirm_status in ('pending','sent','in_progress','completed'))` 追加 + `current_question_index integer not null default 0` 追加 | Locked: ステートマシン状態 |
| line_users | `line_user_id text not null unique`（グローバルunique）、oa_config_id nullable | **IN-06修正**: `unique(oa_config_id, line_user_id)` へ変更。oa_config_idは `not null`（on delete cascade）推奨 — nullableのままだとPostgresのunique上NULL行が複数並存し制約が機能しない | 01-REVIEW.md IN-06（Phase 2対応と明記済み） |
| answers | `question_key text` + `unique(participant_id, question_key)` あり。updated_atトリガーなし | `question_key`をそのまま質問ID格納に使う（or `question_id`へrename — 裁量）。**UPSERT時に `answered_at` を明示的に上書きする**（answersにはset_updated_atトリガーがない） | Locked: 再回答は上書き・answered_at保持 |
| seed.sql | dev-oa / dev-event / twipla URLのみ | 定型3問のquestions JSONB追加: ①年齢確認（20歳以上です/未成年です）②飲酒（飲む/飲まない）③遅刻早退（なし/遅刻予定/早退予定）。`events.event_date` をE2Eで使える値に設定する行も検討 | CONTEXT specifics |

**OA解決（webhook→oa_config）:** Phase 2は単一OA。webhookは `oa_configs.line_channel_id = env(LINE_CHANNEL_ID)` で自OAを引く設計を推奨。チャネルIDはコミットしない方針のため、seedにはnullのまま入れ、`scripts/setup-dev.ts` が env.dev から `update oa_configs set line_channel_id=...` する（Vault投入と同じスクリプトに同居）。

**IN-08（軽量対応）:** scraperの `eq("url", body.url)` 照合前に `url.origin + url.pathname` へ正規化する関数を `_shared/providers/` に追加（canHandleでquery/hash拒否でも可）。
**IN-09:** 配信対象抽出が `status='attending'` を必須条件に含むため配信面は安全（行整理はPhase 4で可 — CONTEXT確認済み）。

### 配信対象抽出SQL（get_confirm_targets — 推奨形）
```sql
-- 新規マイグレーションに含める。RPC（service role）専用
create or replace function public.get_confirm_targets()
returns table (
  participant_id uuid, line_user_id text, event_id uuid,
  event_title text, event_date date, meeting_at timestamptz,
  meeting_place text, fee text, venue_info text, oa_config_id uuid
)
language sql stable
set search_path = ''
as $$
  select p.id, lu.line_user_id, e.id, e.title, e.event_date, e.meeting_at,
         e.meeting_place, e.fee, e.venue_info, e.oa_config_id
  from public.participants p
  join public.event_platform_urls epu on epu.id = p.event_platform_url_id
  join public.events e on e.id = epu.event_id
  join public.line_users lu on lu.id = p.line_user_id
  where p.status = 'attending'
    and p.confirm_status = 'pending'
    and p.line_user_id is not null
    and e.event_date is not null
    and e.event_date >= (now() at time zone 'Asia/Tokyo')::date
    and (e.event_date - (now() at time zone 'Asia/Tokyo')::date) <= e.confirm_days_before
$$;
revoke all on function public.get_confirm_targets() from public, anon, authenticated;
grant execute on function public.get_confirm_targets() to service_role;
```
日付は `Asia/Tokyo` 基準で明示（cronは01:00 UTC=10:00 JST実行なのでUTC dateと一致するが、依存しない）。未紐付けスキップ件数は同条件で `line_user_id is null` をカウントする軽量クエリをmessage-sender側で別途実行してログ。

## Common Pitfalls

### Pitfall 1: db reset --linked がpg_cronとcronジョブを消す（実証済み・最重要）
**What goes wrong:** スキーマ変更のたびに実行する `db reset --linked --yes` で、手動有効化したpg_cron拡張とcron.jobの全行が消える（本セッションで実測。pg_netとVaultシークレットは残った）。
**Why it happens:** resetはユーザー作成オブジェクトを落としてマイグレーションを再適用する。マイグレーションに書かれていないものは復元されない。
**How to avoid:** `create extension if not exists pg_cron/pg_net` と `cron.schedule(...)` を必ずマイグレーションに置く。検証は `select jobname from cron.job` で機械確認（scripts/verify-cron.ts）。
**Warning signs:** reset後に `relation "cron.job" does not exist`。

### Pitfall 2: cron成功 ≠ 配信成功（pg_netは非同期）
**What goes wrong:** `cron.job_run_details.status='succeeded'` は「net.http_postの登録成功」でしかない。Edge Functionが5xxでもcronは成功に見える。
**How to avoid:** 機械検証は `net._http_response.status_code` まで見る（本セッションで200を確認した方法）。レスポンス行は永続ではない（短期で削除される [ASSUMED: 約6時間]）ため、検証はジョブ実行直後に行う。
**Warning signs:** cronはsucceededなのにconfirm_statusが変わらない。

### Pitfall 3: replyTokenの使い回し・遅延使用
**What goes wrong:** 1トークン1回限り・受信後約1分（公式は「制限時間に依存するな」）。質問と誘導文を別々のreply呼び出しで送ると2回目が失敗する。webhook処理が遅いと期限切れ。
**How to avoid:** 1イベントへの返信は1回のreply呼び出しに全バブル（≤5）同梱。webhookは重い処理（不要な外部呼び出し）をしない。DB更新→reply送信の順とし、reply失敗はログして200を返す（ユーザーの次メッセージで再誘導が回復経路になる）。

### Pitfall 4: pushの通数を無駄遣いする設計
**What goes wrong:** 質問ごとにpushすると参加者×質問数で月200通を即消費。また同一ユーザーへ複数回のpushリクエストに分けると各回カウントされる。
**How to avoid:** 初回配信は1リクエストに最大5バブル同梱（イベント情報＋案内＋Q1で3バブル）。以降は全てreply。[CITED: pricing — カウントは送信対象人数単位、応答メッセージは対象外]
**Warning signs:** LINE Developersコンソールの当月通数が参加者数を超えて増える。

### Pitfall 5: webhook再配達・Quick Reply再タップでの二重遷移
**What goes wrong:** LINEはwebhookを再配達することがある（`deliveryContext.isRedelivery`）。また過去の質問のQuick Replyボタンはトーク画面に残り再タップできる。素朴に「postback受信=index++」とすると質問がスキップされる。
**How to avoid:** transition()で「postbackのquestion_id == questions[current_index].id のときだけ前進」をガード。answersはUPSERTで冪等。再タップは上書き保存＋現在質問の再送。
**Warning signs:** current_question_indexが質問数を超える、answersに歯抜け。

### Pitfall 6: participants.line_user_id（uuid FK）とLINE userId（"U…"）の混同
**What goes wrong:** pushの宛先にparticipants.line_user_id（uuid）を渡すとLINE APIが400。webhookでsource.userIdをparticipantsに直接JOINすると0件。
**How to avoid:** 型エイリアス（`LineUserId` vs `LineUserRowId`）とJOIN経路を_sharedに集約。get_confirm_targets()がJOIN済みの "U…" を返す設計で混同を構造的に防ぐ。

### Pitfall 7: 偽postbackによる回答なりすまし
**What goes wrong:** postback dataはクライアント改変可能な入力。participant_idだけ信用すると、別ユーザーが他人のparticipant_idで回答を上書きできる。
**How to avoid:** webhookで `source.userId` → line_users → participants.line_user_id の一致を必ず検証。oa_config境界も確認。零細だが署名検証だけでは防げない（正規のLINEユーザーからの正規署名イベントのため）。

### Pitfall 8: E2Eテストの偽replyToken/偽userIdで実LINE APIを叩く
**What goes wrong:** 署名付きcurlのpostbackイベントに入れるreplyToken/userIdは偽物 → 実reply/pushは400/404になりテストが不安定化（CONTEXT specifics記載のとおり）。
**How to avoid:** `LINE_DRY_RUN=1`（supabase secrets）でclient層をログのみに切替えてからE2E実行。DB副作用（answers 3行 + completed）で検証。実配信はHUMAN-UATへ。

### Pitfall 9: answers.answered_atが再回答で更新されない
**What goes wrong:** answersにはset_updated_atトリガーがなく、UPSERTのDO UPDATEにanswered_atを含めないとINSERT時刻のまま。
**How to avoid:** supabase-jsのupsert payloadに `answered_at: new Date().toISOString()` を常に含める（またはトリガー追加）。

### Pitfall 10: cron→message-senderのタイムアウトと関数中断
**What goes wrong:** net.http_postのtimeout（実測使用値8000ms）を超えるとpg_net側はタイムアウト記録。クライアント切断時にEdge Functionの処理が中断される可能性がある。
**How to avoid:** 参加者規模（10〜30人）なら逐次pushでも数秒で完了する見込みだが、安全策として (a) timeout_milliseconds を余裕値（例: 30000）に設定、(b) message-sender側で送信ループを `EdgeRuntime.waitUntil()` に載せて202即時応答にする、のどちらかを採用。[ASSUMED: 切断時挙動 — 実行時にE2Eで確認]

## Code Examples

### LINE push（raw fetch — エンドポイント/形状は公式リファレンス準拠）
```typescript
// Source: developers.line.biz/en/reference/messaging-api/ #send-push-message
// 1リクエスト最大5メッセージ。カウントは宛先人数単位（バブル数無関係）
const res = await fetch("https://api.line.me/v2/bot/message/push", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${statelessToken}`,
    "X-Line-Retry-Key": crypto.randomUUID(),  // 500/timeout時のみ同一キーで再送。409=送信済み
  },
  body: JSON.stringify({
    to: lineUserId,  // "U..."（line_users.line_user_id）
    messages: [
      { type: "text", text: eventInfoText },     // イベント情報
      { type: "text", text: guidanceText },      // 案内文
      buildQuestionMessage(questions[0], participantId),  // Q1 + Quick Reply
    ],
  }),
});
```

### Quick Reply付き質問メッセージ（postback action）
```typescript
// Source: developers.line.biz/en/docs/messaging-api/using-quick-reply/（items最大13）
// label最大20字・data最大300字 [複数ソースで確認 — ビルダーで実行時assertすること]
function buildQuestionMessage(q: Question, participantId: string) {
  return {
    type: "text",
    text: q.text,
    quickReply: {
      items: q.options.map((opt, i) => ({
        type: "action",
        action: {
          type: "postback",
          label: opt,                     // ≤20字（定型3問の選択肢は最長7字で適合）
          data: new URLSearchParams({ p: participantId, q: q.id, a: String(i) }).toString(),
          displayText: opt,               // タップ時にユーザーの発言として表示
        },
      })),
    },
  };
}
```

### webhookイベントのzodスキーマ（postback / follow）
```typescript
// Source: developers.line.biz/en/reference/messaging-api/ Webhook Event Objects
const PostbackEventSchema = z.object({
  type: z.literal("postback"),
  replyToken: z.string(),
  source: z.object({ type: z.string(), userId: z.string() }),
  postback: z.object({ data: z.string() }),
  deliveryContext: z.object({ isRedelivery: z.boolean() }).optional(),
  webhookEventId: z.string().optional(),
});
const FollowEventSchema = z.object({
  type: z.literal("follow"),
  replyToken: z.string(),
  source: z.object({ type: z.string(), userId: z.string() }),
  follow: z.object({ isUnblocked: z.boolean() }).optional(),
});
// reply: POST https://api.line.me/v2/bot/message/reply  body: { replyToken, messages: [...] }
```

### Vault投入スクリプトの核（scripts/setup-dev.ts — 本セッションで動作実証した形）
```typescript
// Source: 本リサーチで実行検証済み（pooler接続・vault.create_secret・冪等化）
import postgres from "npm:postgres@3.4.9";
// env.devからSUPABASE_DIRECT_CONNECTION_STRINGのパスワードとSUPABASE_ANON_KEY/DEV_PROJECT_REFを読む
// ref !== "cmsxvxtcdniqgvhxjqri" なら即abort（prod安全弁）
const sql = postgres({
  host: "aws-1-ap-northeast-1.pooler.supabase.com", port: 5432, database: "postgres",
  username: `postgres.${ref}`, password, ssl: "require", prepare: false,
});
// 冪等: 既存を消してから作る（vault.update_secretでも可）
await sql`delete from vault.secrets where name in ('project_url','cron_function_key')`;
await sql`select vault.create_secret(${`https://${ref}.supabase.co`}, 'project_url')`;
await sql`select vault.create_secret(${anonKey}, 'cron_function_key')`;
await sql`update oa_configs set line_channel_id = ${channelId} where name = 'dev-oa'`;
```
注意: 直接接続（db.\<ref\>.supabase.co）はIPv6限定DNSのため**不可**（Phase 1確認済み）。プーラー（aws-1-ap-northeast-1、IPv4可・ユーザー名 `postgres.<ref>`）を使う。`prepare: false` はトランザクションプーラー互換のため付与（セッションプーラー5432でも無害）。

### cron登録・実行結果の機械検証（scripts/verify-cron.ts の核）
```sql
-- 登録確認（CONTEXT検証方針: 実時刻待ちはしない）
select jobname, schedule, active from cron.job where jobname = 'confirm-broadcast-daily';
-- 手動トリガー相当の検証: 一時ジョブ '* * * * *' を schedule→75秒待ち→確認→unschedule
-- （本セッションでこの手順により succeeded + net._http_response 200 を確認済み）
select status, return_message from cron.job_run_details order by start_time desc limit 3;
select status_code, content::text, timed_out from net._http_response order by id desc limit 3;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| cron SQLにキー直書き | Vault (`vault.decrypted_secrets`) 参照 | Supabase公式パターン | publicリポジトリでもマイグレーションにcron登録を置ける |
| 長期チャネルアクセストークン | ステートレスv3（15分・都度発行） | Phase 1確立済み | message-senderは1バッチ1トークン発行 |
| push中心のbot設計 | replyToken活用（postbackにも付与・無料） | LINE料金改定後の定石 | 月200通でも参加者200人分の確認フローが回る |
| @line/bot-sdk（Node） | raw fetch + zod（Deno） | Phase 1決定の継続 | Deno Edge Functionsで検証不要のまま確実に動く |

**Deprecated/outdated:**
- LINEの旧フリープラン（1000通/月）: 2023年改定で200通/月に減。現行コミュニケーションプラン=200通で計画する
- `supabase_functions.http_request`: Database Webhooks（テーブルトリガー）用。cron用途は `net.http_post` + Vaultが公式推奨

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Quick Reply label≤20字 / postback data≤300字（複数の二次ソースで一致。公式リファレンスページは巨大で機械抽出不可だった） | Code Examples | 低 — 定型3問の選択肢は最長7字・dataは約60字で大幅に余裕。実装時にビルダーのassertで実測検知 |
| A2 | `supabase secrets set/unset` は再デプロイなしで関数envに反映される | Pattern 4 | 中 — 反映されない場合はLINE_DRY_RUN切替に再デプロイ追加。実行時にset直後curlで確認するタスクを入れる |
| A3 | `net._http_response` の行は短期（約6時間）で削除される | Pitfall 2 | 低 — 検証をジョブ実行直後に行う設計なら影響なし |
| A4 | pg_netタイムアウト/クライアント切断時のEdge Function中断挙動 | Pitfall 10 | 中 — waitUntil採用 or timeout余裕値で回避可能。E2Eで実測 |
| A5 | 同一ユーザーへの複数pushリクエストは各回カウントされる（pricingの「送信対象人数」解釈） | Pattern 3 | 低 — どちらにせよ1リクエスト同梱が最適で設計は変わらない |
| A6 | pg_cronのスケジュールタイムゾーンはUTC（Supabaseサーバーtimezone=UTC） | Pattern 1 | 低 — '0 1 * * *'が想定とずれてもJST午前中の実行であれば機能要件は満たす。verify-cronで初回実行時刻を確認 |

## Open Questions

1. **同一LINEユーザーが複数イベントで同時にin_progressの場合の想定外入力への再誘導**
   - What we know: postback dataにparticipant_idがあるので回答は厳密に紐づく（Locked設計）。曖昧なのは「テキスト等の想定外入力」時にどのparticipantの質問を再送するか
   - What's unclear: 複数in_progress時の再送対象
   - Recommendation: `updated_at` が最新のin_progress participant 1件のみ再送（シンプル・実害最小）。planner判断で可
2. **events.event_date が null のイベント**
   - What we know: 現スキーマでnullable。抽出SQLは `event_date is not null` でスキップする
   - Recommendation: Phase 2はスキップ+ログで十分。必須化はPhase 3のイベント作成UIで
3. **message-senderの応答方式（同期完了 vs waitUntil+202）**
   - What we know: 想定規模（10〜30人）なら同期でも数秒。pg_net timeoutは引数で延長可能
   - Recommendation: まず同期+timeout 30000msで実装し、E2Eでpg_net側のtimed_out=falseを確認。問題があればwaitUntilへ

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI（ログイン済み・dev linked確認済み） | deploy/secrets/db reset | ✓ | 2.101.0 | — |
| Deno | Edge Functions・テスト・DBスクリプト | ✓ | 2.8.2 | — |
| pg_cron | LINE-01 | ✓（available 1.6.4、現在は未install — マイグレーションで有効化） | 1.6.4 | なし不要（create extension成功を実証済み） |
| pg_net | cron→Edge Fn呼び出し | ✓（install済み・動作確認済み） | 0.20.3 | — |
| supabase_vault | シークレット秘匿 | ✓（install済み・secrets投入済み・reset耐性実証） | 0.3.1 | — |
| セッションプーラー接続 | SQL実行（psql代替） | ✓（本セッションで多数回成功） | aws-1-ap-northeast-1:5432 | — |
| psql | SQL実行 | ✗ | — | Deno + npm:postgres@3.4.9（実証済み） |
| Docker daemon | ローカルスタック | ✗ | — | deploy --use-api / db reset --linked（両方Phase 1+本セッションで実証） |
| LINE Messaging API | push/reply・トークン発行 | ✓（token発行200を本セッションでcron経由確認） | v2/v3 | DRY_RUNでオフライン検証可 |
| 直接DB接続（db.\<ref\>） | — | ✗（IPv6限定DNS） | — | プーラー経由（上記） |

**Missing dependencies with no fallback:** なし
**Missing dependencies with fallback:** psql・Docker（いずれも実証済みの代替あり）

**dev環境の現在状態（本セッション終了時点）:** pg_net=installed / pg_cron=未install（resetで消えた状態 — Phase 2マイグレーションが入れ直す）/ Vaultに `project_url`・`cron_function_key` 投入済み / cronジョブなし（probeジョブはunschedule済み）/ public 7テーブル+seed適用済み。

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Deno組み込みテストランナー（2.8.2、追加インストール不要） |
| Config file | supabase/functions/deno.json（既存。postgres importを追加） |
| Quick run command | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` |
| Full suite command | `E2E_TEST=1 deno test --config supabase/functions/deno.json --allow-read --allow-net --allow-env supabase/functions/tests/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LINE-01 | cronジョブ `confirm-broadcast-daily` が登録されている | smoke | `deno run --allow-net --allow-read --allow-env scripts/verify-cron.ts`（cron.job照会） | ❌ Wave 0 |
| LINE-01 | 抽出ロジック: attending∧pending∧紐付け済み∧N日以内のみ返す（N日超・未紐付け・interested・sent済みを除外） | integration | `E2E_TEST=1 deno test ... tests/e2e_targets_test.ts`（フィクスチャ行投入→rpc get_confirm_targets→件数/内容assert） | ❌ Wave 0 |
| LINE-01 | message-sender呼び出しで対象がsentに遷移（DRY_RUN下） | e2e | curl message-sender（anonキー）→ participants.confirm_status='sent' をSQL検証 | ❌ Wave 0 |
| LINE-02 | 全状態遷移（pending→sent→in_progress→completed、過去Q再タップ、想定外入力、完了後入力無視、再配達冪等） | unit | `deno test --allow-read supabase/functions/tests/confirm_state_test.ts` | ❌ Wave 0 |
| LINE-02 | Quick Reply形状（items≤13・label≤20字・data≤300字・postback action必須項目） | unit | `deno test ... tests/confirm_messages_test.ts` + `tests/postback_data_test.ts` | ❌ Wave 0 |
| LINE-02/03 | E2E: seed→sender→署名付きpostback curl×3→answers 3行＋question_textスナップショット＋confirm_status='completed' | e2e | `E2E_TEST=1 deno test ... tests/e2e_confirm_flow_test.ts`（LINE_DRY_RUN=1前提） | ❌ Wave 0 |
| LINE-03 | 再回答UPSERT上書き（同一participant×questionで answer/answered_at が更新され行数不変） | integration | e2e_confirm_flow_test.ts 内ケース | ❌ Wave 0 |
| LINE-03 | なりすまし拒否（source.userId不一致のpostbackは保存されない） | e2e | e2e_confirm_flow_test.ts 内ケース | ❌ Wave 0 |
| 横断 | シークレット非コミット | unit | `git ls-files \| grep -E '^env\.(dev\|prod)$'` 空 + マイグレーション/seedにキー文字列・prod refがないことをgrep | 即時実行可 |

### Sampling Rate
- **Per task commit:** `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/`（ネット不要unit: state/messages/postback/events。既存12件も含め決定的）
- **Per wave merge:** Full suite（E2E_TEST=1、dev DB+デプロイ済み関数+LINE_DRY_RUN=1）+ verify-cron.ts
- **Phase gate:** 成功条件1〜4の検証コマンドすべてgreen → `/gsd:verify-work`。HUMAN-UAT（実LINE受信確認）はDRY_RUN解除後に別途

### Wave 0 Gaps
- [ ] `supabase/functions/tests/confirm_state_test.ts` — LINE-02 unit（遷移網羅）
- [ ] `supabase/functions/tests/postback_data_test.ts` — encode/decode・桁数制限
- [ ] `supabase/functions/tests/confirm_messages_test.ts` — Quick Reply形状
- [ ] `supabase/functions/tests/line_events_test.ts` — zodスキーマ（postback/follow/message）
- [ ] `supabase/functions/tests/e2e_confirm_flow_test.ts` — E2E_TEST=1ゲート（Phase 1のLIVE_TEST=1パターン踏襲）
- [ ] `scripts/db/sql.ts` — pooler SQLヘルパー（npm:postgres@3.4.9、ref!==dev時abort）
- [ ] `scripts/setup-dev.ts` / `scripts/verify-cron.ts`
- [ ] deno.json に `"postgres": "npm:postgres@3.4.9"` 追加
- [ ] フレームワークインストール: 不要（Deno同梱）

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | webhook=LINE署名（既存・検証済み実装）。message-sender=ゲートウェイJWT（cronはVaultのanonキーで通過、内部はservice role） |
| V3 Session Management | no | ステートマシン状態はDB行であり認証セッションではない |
| V4 Access Control | yes | get_confirm_targets()はservice_roleのみexecute。postbackのparticipant_idは `source.userId` 照合必須（Pitfall 7）。RLSは既存deny-by-default維持 |
| V5 Input Validation | yes | zodでイベント形状・postback data（uuid/枚挙）検証。question_idはoa_configs.questionsに実在するもののみ受理 |
| V6 Cryptography | yes | 署名検証はWeb Crypto（既存・定数時間比較）。retry keyは `crypto.randomUUID()` |
| V14 Config / Secrets | yes（最重要） | publicリポジトリ。cron SQLはVault**名前**参照のみ。Vault値・チャネルIDはsetup-dev.tsがenv.devから投入（コミットしない）。LINE_DRY_RUNはsecrets set。コミット前grep（キー/prod ref）をタスク検証に含める |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 偽postbackで他人の回答を上書き | Spoofing/Tampering | source.userId ↔ participants.line_user→line_users.line_user_id の一致検証（署名検証では防げない） |
| webhook偽装 | Spoofing | x-line-signature検証（既存実装・公式テストベクタ済み） |
| cron SQL経由のシークレット漏洩 | Information Disclosure | マイグレーションにはVault名のみ。`git grep` でキー形文字列・refを機械検査 |
| webhook再配達による二重処理 | Tampering | answers UPSERT + index一致ガード（冪等設計） |
| LINEクォータ枯渇（DoS的失敗） | Denial of Service | push超過時はLINEがエラー応答（公式確認済み）→ confirm_statusをsentにしない（失敗参加者は翌日cronで再試行される）。reply中心設計で消費を最小化 |
| prod誤操作 | Elevation of Privilege | スクリプトは ref==='cmsxvxtcdniqgvhxjqri' チェックでabort（本セッションのprobeで採用した形）。linked-project.json確認をdb reset前タスクに含める |

## Sources

### Primary (HIGH confidence — 本セッションでdev実機検証)
- pg_cron 1.6.4 / pg_net 0.20.3 の `create extension` 成功、`cron.schedule`→`net.http_post`(Vault参照ヘッダ)→message-sender HTTP 200（tokenIssued:true）、`cron.job_run_details` succeeded、`cron.unschedule` — 全工程実行ログあり
- `supabase db reset --linked --yes` 実行 → Vaultシークレット残存・pg_net残存・**pg_cron/cronジョブ消失**を確認
- Deno + npm:postgres@3.4.9 によるセッションプーラー（aws-1-ap-northeast-1:5432、`postgres.<ref>`）接続・DDL・Vault操作
- supabase/migrations/・seed.sql・webhook/message-sender/token.ts 実読（スキーマ差分・既存資産の確定）
- npm view postgres（3.4.9, porsager/postgres, postinstallなし）+ slopcheck [OK]

### Secondary (HIGH-MEDIUM confidence — 公式ドキュメント)
- https://developers.line.biz/ja/docs/messaging-api/pricing/ — 通数カウント=送信対象人数（バブル数無関係）、応答メッセージはカウント外、無料200通/月、超過時はエラーで未送信
- https://developers.line.biz/en/docs/messaging-api/retrying-api-request/ — X-Line-Retry-Key（UUID・push等4 API・409+accepted-request-id・24h・500/timeoutのみ再送）
- https://developers.line.biz/en/docs/messaging-api/sending-messages/ — reply/push、1リクエスト最大5メッセージ、replyToken=1回限り・約1分・時間制限に依存するな
- https://developers.line.biz/en/docs/messaging-api/using-quick-reply/ — Quick Reply最大13項目・全メッセージ型対応
- https://developers.line.biz/en/reference/messaging-api/ — postbackイベント（replyToken/postback.data/deliveryContext）、followイベント（follow.isUnblocked）、404=Target user ID doesn't exist
- https://supabase.com/docs/guides/functions/schedule-functions — pg_cron+pg_net+Vaultパターン（本実装の出典。実機検証で裏付け）

### Tertiary (LOW confidence — 複数ソース一致だが公式表の直接抽出不可)
- Quick Reply label≤20字・postback data≤300字（WebSearch複数ソース一致。リファレンス本文の機械抽出は失敗 → Assumptions A1、実装時assert）
- net._http_response行の保持期間（約6h）— A3

## Metadata

**Confidence breakdown:**
- スケジュール配信（LINE-01経路）: HIGH — 全チェーンとreset耐性を実機検証
- LINE API仕様（push/reply/Quick Reply/postback）: HIGH-MEDIUM — エンドポイント・クォータ・retry keyは公式doc確認。文字数上限のみ二次ソース（実用上は大幅マージンあり）
- スキーマ変更: HIGH — 既存マイグレーション実読に基づく差分。confirm_days_before default不一致（3 vs Locked 7）を発見済み
- テスト戦略: HIGH — Phase 1確立パターンの拡張（deno test + E2Eゲート + pooler SQL検証）

**Research date:** 2026-06-12
**Valid until:** 2026-07-12（pg_cron/pg_net/Vaultは安定。LINE料金プランは改定があれば通数前提のみ見直し）
