---
phase: 02-line-bot
reviewed: 2026-06-11T23:44:53Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - supabase/migrations/20260611171037_create_core_tables.sql
  - supabase/migrations/20260612120000_setup_cron_and_targets.sql
  - supabase/seed.sql
  - scripts/db/sql.ts
  - scripts/setup-dev.ts
  - scripts/verify-cron.ts
  - supabase/functions/_shared/confirm/state.ts
  - supabase/functions/_shared/confirm/postback.ts
  - supabase/functions/_shared/confirm/messages.ts
  - supabase/functions/_shared/line/events.ts
  - supabase/functions/_shared/line/client.ts
  - supabase/functions/_shared/providers/twipla.ts
  - supabase/functions/message-sender/index.ts
  - supabase/functions/webhook/index.ts
  - supabase/functions/tests/confirm_state_test.ts
  - supabase/functions/tests/confirm_messages_test.ts
  - supabase/functions/tests/postback_data_test.ts
  - supabase/functions/tests/line_events_test.ts
  - supabase/functions/tests/line_client_test.ts
  - supabase/functions/tests/e2e_targets_test.ts
  - supabase/functions/tests/e2e_confirm_flow_test.ts
findings:
  critical: 2
  warning: 7
  info: 8
  total: 17
fixes:
  fixed_at: 2026-06-12T15:30:00Z
  fixed: 13
  deferred: 4
  fixed_ids: [CR-01, CR-02, WR-01, WR-02, WR-03, WR-04, WR-05, WR-06, WR-07, IN-02, IN-03, IN-04, IN-08]
  deferred_ids: [IN-01, IN-05, IN-06, IN-07]
status: fixed
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-11T23:44:53Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** fixed（Critical/Warning 全9件 + Info 4件を修正済み。Info 4件は理由付きで保留 — 下記 Fix Status 参照）

## Summary

Phase 2（LINE bot: cron配信 + 1問1答ステートマシン + webhook）の全21ファイルをレビューした。セキュリティ面の主要関門（署名検証順序、なりすまし照合、Vault参照型cron、シークレット非コミット、prodref非混入、T-02-08ログ方針）は実装どおり守られており、ステートマシン純関数とpostbackコーデックは堅牢。grepによる確認でも、レビュー対象ファイルにシークレット値・prod ref（hgojtooexbknqotzkkja）の混入はない。env.dev / env.prod は .gitignore 済みで未追跡。

一方で、ユーザー向けメッセージに集合時刻がUTC生ISO文字列のまま表示される問題（時刻誤読の実害リスク）と、followイベントの再フォローで既存 display_name が無条件に null 上書きされるデータ消失バグの2件をCriticalと判定した。Warningとして、anonキーのみで message-sender を起動できる認可面、answers UPSERT失敗時にもindexが前進して回答が恒久消失する順序問題、isRedelivery未使用による再配達時の再回答巻き戻し、非テキストメッセージの無反応、なりすましガードの participant→event 側OA境界未照合、LINE_CHANNEL_ID未設定の silent 200、line_channel_id の unique 制約欠如を挙げる。

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: 集合時刻（meeting_at）がUTCの生ISO文字列のままユーザー向けLINEメッセージに表示される

**File:** `supabase/functions/message-sender/index.ts:188-195`（表示生成は `supabase/functions/_shared/confirm/messages.ts:84-86`）
**Issue:** `get_confirm_targets()` RPC の `meeting_at`（timestamptz）は PostgREST 経由で UTC の ISO 8601 文字列（例: `2026-06-15T09:00:00+00:00`）として返る。message-sender はこれを `EventInfo.meetingAt` にそのまま渡し、`buildInitialMessages` が `集合時間: 2026-06-15T09:00:00+00:00` という行を生成して実ユーザーに push する。JST利用者が「09:00」を午前9時集合と誤読する余地が大きく（実際は18:00 JST）、本機能の主目的である「最終確認」の中核情報が誤解を招く形で配信される。`event_date` も `2026-06-15` の生文字列で、日本語文面と不釣り合い。ユニットテストは整形済み文字列（`"18:00"`）をフィクスチャで渡しているため、この経路の欠陥を検出できていない。
**Fix:** message-sender 側で Asia/Tokyo に変換・整形してから `EventInfo` に詰める。
```ts
function formatMeetingAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d); // 例: "6/15 18:00"
}
// EventInfo 構築時:
meetingAt: formatMeetingAt(target.meeting_at),
```
あわせて `event_date` も `YYYY年M月D日` 等に整形し、整形済み値を使うE2E/ユニットアサーションを追加する。

### CR-02: 再フォロー時の upsert が既存 display_name を無条件に null で上書きする（データ消失）

**File:** `supabase/functions/webhook/index.ts:198-208`
**Issue:** followイベント処理で `line_users` に `display_name: null` を含めて upsert している。`onConflict: "oa_config_id,line_user_id"` の衝突時、supabase-js の upsert は渡した全カラムを UPDATE するため、既存行の `display_name`（seed の `dev-tester` や、Phase 3 で予定されるプロフィール取得・手動設定値）がフォロー/ブロック解除のたびに null に消去される。`followed_at` の更新は意図どおりだが、`display_name` の消去は意図しないデータ消失であり、ユーザー側の操作（再フォロー）だけで発生する。
**Fix:** upsert ペイロードから `display_name` を外す（未指定カラムは ON CONFLICT DO UPDATE の SET 対象にならない）。
```ts
const { error } = await supabase
  .from("line_users")
  .upsert(
    {
      oa_config_id: oaConfig.id,
      line_user_id: event.userId,
      followed_at: new Date().toISOString(),
    },
    { onConflict: "oa_config_id,line_user_id" },
  );
```

## Warnings

### WR-01: message-sender が anon キーの所持のみで起動可能（配信トリガーの認可不足）

**File:** `supabase/functions/message-sender/index.ts:57-99`、`scripts/setup-dev.ts:42`
**Issue:** message-sender はゲートウェイJWT検証のみに依存し、Vault の `cron_function_key` は anon キーそのもの（setup-dev.ts:42）。anon キーは publishable クラスの鍵であり、Phase 3 以降の管理画面でクライアントに配布された時点で、第三者が任意のタイミングで配信をトリガーできるようになる（pending対象への早期送出・LINEクォータ消費・push費用の発生）。pending→sent 遷移により重複送信自体は抑止されるが、「いつ配信されるか」を攻撃者が制御できるのは認可面の欠陥。T-02-07 で設計受容済みの点は理解するが、関数側の追加チェックは1行で済む。
**Fix:** 専用シークレット（例: `CRON_FUNCTION_SECRET`）を Edge Function の env と Vault の両方に置き、リクエストヘッダ（例: `x-cron-key`）との一致を関数冒頭で照合する。最低でも Phase 3（anonキーがクライアント配布される前）までに導入すること。

### WR-02: answers UPSERT 失敗時も index が前進し、回答が恒久的に失われる

**File:** `supabase/functions/webhook/index.ts:297-339`
**Issue:** postback処理は (a) answers upsert → (b) participants の index/status 更新の順だが、(a) が失敗してもログのみで (b) に進む。結果、`current_question_index` は前進し、ユーザーは次の質問に誘導される。失われた回答を再収集する経路はなく（過去質問の再タップはユーザーが自発的に行わない限り発生しない）、`completed` まで到達すると answers に欠落行を持つ「完了」参加者が生まれる。コメントは「部分成功を許容」とするが、回答収集が本システムの目的である以上、欠落許容は逆方向。
**Fix:** upsert 失敗時は (b) をスキップして reprompt 扱いにし、ユーザーに同一質問を再提示して次の postback でリトライさせる。
```ts
if (upsertError) {
  console.error(`webhook: answers upsert failed participant_id=${participantId}: ${upsertError.message}`);
  // index/status を前進させず、現在質問の reprompt にフォールバック
  result = { ...result, nextStatus: current.status, nextIndex: current.index, reply: "reprompt" };
}
```

### WR-03: isRedelivery がパース後に未使用 — 再配達された旧postbackが新しい再回答を巻き戻す

**File:** `supabase/functions/webhook/index.ts:218-318`（`supabase/functions/_shared/line/events.ts:81` で抽出済み）
**Issue:** `parseWebhookEvent` は `deliveryContext.isRedelivery` を抽出して返すが、webhook はこのフラグを一切参照しない。現在質問の遷移は index ガードで冪等だが、ステートマシンのルール4（過去質問の再タップによる answers 上書き）は冪等ではない: ユーザーが Q1 を a=0 → a=1 と再回答した後、最初の Q1(a=0) postback が LINE から再配達されると、新しい回答 a=1 が古い a=0 で上書きされ `answered_at` も更新される。せっかく抽出したフラグが dead value になっている。
**Fix:** `event.isRedelivery === true` の postback では answers upsert（少なくともルール4の過去質問上書き）をスキップする。最小対応として:
```ts
if (result.answer && !(event.isRedelivery && result.reply === "reprompt")) { /* upsert */ }
```

### WR-04: 非テキストメッセージ（スタンプ・画像等）が無応答で破棄され、D-07 の再誘導が働かない

**File:** `supabase/functions/_shared/line/events.ts:29-33`、`supabase/functions/webhook/index.ts:390-452`
**Issue:** `MessageEventSchema` は `message.type: z.literal("text")` のため、進行中（sent/in_progress）の参加者がスタンプや画像を送ると `parseWebhookEvent` が null を返し、イベントは完全に無視される。テキストなら現在質問が再提示されるのに、スタンプだと無反応という非一貫な挙動であり、「想定外入力は再誘導」という D-07 の意図に対する取りこぼし。高齢・非IT層の参加者がスタンプで返す可能性は十分ある。
**Fix:** スキーマを `message: z.object({ type: z.string(), ... text: z.string().optional() })` に緩め、`kind: "message"` として text 有無に関わらず reprompt 経路に乗せる（webhook 側は text を使用していないため変更は events.ts のみで済む）。

### WR-05: なりすましガードが participant の所属イベント側 OA 境界を照合していない

**File:** `supabase/functions/webhook/index.ts:267-279`
**Issue:** T-02-11 の照合は (1) `line_users.line_user_id === source.userId`、(2) `line_users.oa_config_id === oaConfig.id` の2点のみ。participant 自身の所属（participants → event_platform_urls → events → oa_config_id）は確認しないため、OA-A の line_user に OA-B のイベント参加者行が紐付くデータ不整合（Phase 3 の手動紐付けミス等）があると、OA-A の questions に基づく回答が OA-B の参加者の answers に書き込まれる。攻撃者単独では悪用できないが（自分の line_user に紐付く participant にしか書けない）、OA境界の防御として不完全。
**Fix:** participants select に `event_platform_urls(events(oa_config_id))` を含め、`oaConfig.id` と一致しない場合は拒否する。あるいは紐付け時の整合性を保証する DB 制約/トリガーを Phase 3 で必須化し、それまでは webhook 側でチェックする。

### WR-06: LINE_CHANNEL_ID 未設定が「oa_configs not found」の200として黙殺される（WR-01ポリシーと非一貫）

**File:** `supabase/functions/webhook/index.ts:111-131`
**Issue:** `LINE_CHANNEL_SECRET` 未設定は設定エラーとして 500 を返す（Phase 1 WR-01 対応）のに対し、`LINE_CHANNEL_ID` 未設定は空文字のまま `.eq("line_channel_id", "")` の検索に進み、「oa_configs not found」というミスリーディングなログとともに 200 で全イベントが捨てられる。デプロイ時の env 設定漏れが「設定漏れ」と分かる形で表面化せず、bot が無言で全機能停止する。
**Fix:** channelSecret と同様に冒頭でガードする。
```ts
const channelId = Deno.env.get("LINE_CHANNEL_ID") ?? "";
if (!channelId) {
  console.error("webhook: LINE_CHANNEL_ID is not set");
  return new Response("server configuration error", { status: 500 });
}
```
（署名検証より後・JSON検証より前に移動して順序契約は維持する）

### WR-07: oa_configs.line_channel_id に unique 制約がなく、重複時に webhook 全イベントが silent drop する

**File:** `supabase/migrations/20260611171037_create_core_tables.sql:10`、`supabase/functions/webhook/index.ts:120-124`
**Issue:** `line_channel_id` に unique 制約がないため、同じ channel id を持つ oa_configs 行が2つできると webhook の `.single()` が PGRST116 で失敗し、「oa_configs not found」ログ + 200 で全イベントが破棄される。運用ミス1回（行の複製・コピー作成）で bot が無言停止する障害モードであり、検出も困難（HTTP的には正常応答）。
**Fix:** 部分 unique index を追加するマイグレーションを作成する。
```sql
create unique index oa_configs_line_channel_id_key
  on public.oa_configs (line_channel_id)
  where line_channel_id is not null;
```

## Info

### IN-01: X-Line-Retry-Key が呼び出しごとに新規生成され、冪等性の効果がない

**File:** `supabase/functions/_shared/line/client.ts:103`
**Issue:** retry key は「同一送信のリトライで同じ値を送る」ことで重複防止になるが、`crypto.randomUUID()` を pushMessage 呼び出しごとに生成しているため、cron の再実行・関数の途中終了後の再送はすべて別キーとなり LINE 側で重複排除されない。
**Fix:** 呼び出し側から決定的なキー（例: `participant_id + event_id + 配信日` の UUIDv5）を渡せるオプション引数にする。

### IN-02: verify-cron.ts の型注釈が実SELECT列と不一致 + セクション番号の重複

**File:** `scripts/verify-cron.ts:85-87, 83, 107`
**Issue:** `job_run_details` クエリの行型注釈に `job_pid` / `database` / `username` / `command` が含まれるが SELECT していない（型の嘘）。また「(3)」のセクション見出しが2回使われている。
**Fix:** 型注釈を SELECT 列（jobid, runid, status, return_message, start_time, end_time）に合わせ、2つ目のセクションを (4) に直す。

### IN-03: e2e_targets_test の FX.eventC が dead fixture（宣言のみで未使用・未INSERT）

**File:** `supabase/functions/tests/e2e_targets_test.ts:59`
**Issue:** `eventC` は宣言されているが INSERT もクリーンアップ対象（events 削除は A/B/F のみ）にも含まれず、(c) ケースは eventA を使っている。読み手が「eventC が消し忘れられている」と誤読する。
**Fix:** `eventC` 定数を削除しコメントを「(c) は eventA を共用」に統一する。

### IN-04: webhook handleEvent の supabase 引数が any 型

**File:** `supabase/functions/webhook/index.ts:184-186`
**Issue:** `// deno-lint-ignore no-explicit-any` で supabase クライアントを any にしており、`.from()` 以下のクエリビルダ呼び出しのタイポ・カラム名ミスがコンパイル時に検出されない（本レビューで指摘した CR-02 のようなペイロードミスも型では守れない）。
**Fix:** `SupabaseClient`（`@supabase/supabase-js` の型）か `ReturnType<typeof createServiceClient>` を使う。

### IN-05: message-sender の failed カウンタが「OA設定不備によるスキップ」と「push失敗」を混同する

**File:** `supabase/functions/message-sender/index.ts:179-235`
**Issue:** questions 未設定/不正の OA の対象も `failed++` で計上されるため、レスポンスの `failed` から障害種別（LINE障害か設定不備か）を判別できない。
**Fix:** `skippedNoQuestions` を別カウンタにしてレスポンスに含める。

### IN-06: 対象数が増えると同期処理が pg_net の 30 秒タイムアウトを超える

**File:** `supabase/functions/message-sender/index.ts:179-247`、`supabase/migrations/20260612120000_setup_cron_and_targets.sql:106`
**Issue:** 1対象あたり push（LINE API往復）+ UPDATE で数百msかかるため、対象が概ね50〜100件を超えると cron 側の `timeout_milliseconds := 30000` を超過し、job_run_details にタイムアウトエラーが残り続ける。push直後の per-row 更新のおかげで重複送信リスクは最小化されている（良い設計）が、cron の成否シグナルが常時 FAIL になると本物の障害が埋もれる。
**Fix:** v1規模では許容。将来はタイムアウト値の引き上げ＋早期202返却（バックグラウンド処理）か、1回のcronで処理する件数に上限を設ける。

### IN-07: Vault シークレットの delete→create が非トランザクションで、anon キーローテーションで cron が静かに壊れる

**File:** `scripts/setup-dev.ts:36-43`
**Issue:** delete と create の間に cron が発火するとその回は失敗する（低確率・自己回復）。より重要なのは、`cron_function_key` に anon キーを格納しているため、Supabase 側で anon キーをローテーションすると cron 配信が 401 で失敗し続け、setup-dev.ts の再実行まで誰も気づかない点。
**Fix:** SETUP.md / NIGHT-RUN.md にキーローテーション時の再実行手順を明記し、verify-cron.ts の参考情報（net._http_response の status_code 401 連続）を FAIL 条件に昇格させることを検討する。

### IN-08: sql.ts のプーラーホストがリージョン固定のマジック定数

**File:** `scripts/db/sql.ts:48`
**Issue:** `aws-1-ap-northeast-1.pooler.supabase.com` がハードコードされており、プロジェクトのリージョン移動や Supabase 側のプーラーホスト変更で全スクリプトが壊れる。dev 専用スクリプトのため実害は小さい。
**Fix:** 名前付き定数として切り出し（`SUPABASE_POOLER_HOST`）、env での上書きを許容する。

---

## Fix Status (2026-06-12 gsd-code-fixer)

修正スコープ: Critical + Warning 全件 + ゼロリスクの Info。各修正は1コミット=1指摘でアトミックにコミット。
検証: unit 82件 green / E2E（dev実機）87件 green / cron→message-sender 実機200確認（WR-01変更後）。

| ID | Status | Commit | 内容 |
|----|--------|--------|------|
| CR-01 | fixed | 40b2136 | `_shared/confirm/format.ts` 新設。meeting_at を Asia/Tokyo（例: "6/15 18:00"）、event_date を「YYYY年M月D日」に整形してから EventInfo に渡す。UTC ISO入力→JST出力のユニットテスト8件追加 |
| CR-02 | fixed | 50c4274 | follow upsert ペイロードから display_name を除外。再フォローで display_name が保持されるE2Eテスト追加（dev実機 pass） |
| WR-01 | fixed | 2e0346f | message-sender 冒頭で x-cron-key ヘッダ ↔ 関数シークレット CRON_FUNCTION_KEY を照合（未設定500 / 不一致401）。Vault 'cron_shared_secret' を setup-dev.ts が投入し cron ジョブヘッダに追加。anonキーのみ→401・cron経路→200 を実機確認 |
| WR-02 | fixed | c943da9 | answers UPSERT 失敗時は `answerPersistFailureResult()`（state.ts 純関数）で index/status を前進させず reprompt にフォールバック。ユニットテスト2件追加 |
| WR-03 | fixed | 369fba8 | `event.isRedelivery === true` の postback を処理前にスキップ（ログ+200）。再配達が再回答を巻き戻さないE2Eステップ(d2)追加 |
| WR-04 | fixed | 0a65caf | MessageEventSchema の `message.type` を text 限定から任意typeに緩和（text は optional → null）。スタンプ/画像のユニットテスト2件 + スタンプE2Eステップ(f2)追加 |
| WR-05 | fixed | dea8a83 | participants select に `event_platform_urls(events(oa_config_id))` をネストし、participant 所属イベント側 OA も oaConfig.id と照合。cross-OA 拒否E2Eテスト追加（dev実機 pass） |
| WR-06 | fixed | b166e80 | LINE_CHANNEL_ID 未設定を署名検証後・JSON検証前に 500（"server configuration error"）でガード。順序契約は維持 |
| WR-07 | fixed | a37c408 | `20260611171037` マイグレーションに部分unique index `oa_configs_line_channel_id_key` をin-place追加。`db reset --linked` 後、重複INSERTが実機で拒否されることを確認 |
| IN-01 | deferred | — | 決定的 retry key は呼び出し側API変更（participant_id+配信日ベースのキー設計）を伴うため自動修正対象外。Phase 3 で対応推奨 |
| IN-02 | fixed | a9cef96 | job_run_details の型注釈を SELECT 列（jobid/runid/status/return_message/start_time/end_time）に一致させ、2つ目のセクション番号を (4) に修正 |
| IN-03 | fixed | 2a42bf5 | 未使用フィクスチャ eventC を削除し「(c) は eventA を共用」コメントに統一 |
| IN-04 | fixed | 4ed5d16 | handleEvent の supabase 引数を `any` から `SupabaseClient` 型に変更（deno check / lint green） |
| IN-05 | deferred | — | failed と skippedNoQuestions の分離はレスポンス形状変更（E2Eアサーション影響）のためゼロリスク扱いせず保留。v1 運用上の実害は小 |
| IN-06 | deferred | — | レビュー自身が「v1規模では許容」と判定済み。対象50件超の規模になった時点でタイムアウト引き上げ/早期202化を検討 |
| IN-07 | deferred | — | ドキュメント整備（キーローテーション手順）+ verify-cron の FAIL 条件昇格は運用設計判断を伴うため保留。なお WR-01 で cron 認可は専用シークレット化済みで、anonキーローテーション単独で配信が壊れる経路は残るが setup-dev.ts 再実行で復旧する |

_Fixed: 2026-06-12 / Fixer: Claude (gsd-code-fixer)_

---

_Reviewed: 2026-06-11T23:44:53Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
