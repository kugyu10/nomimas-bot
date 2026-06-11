---
phase: 01-foundation-and-scraping
reviewed: 2026-06-11T17:36:05Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - supabase/config.toml
  - supabase/functions/_shared/line/signature.ts
  - supabase/functions/_shared/line/token.ts
  - supabase/functions/_shared/providers/registry.ts
  - supabase/functions/_shared/providers/twipla.ts
  - supabase/functions/_shared/providers/types.ts
  - supabase/functions/_shared/supabase.ts
  - supabase/functions/deno.json
  - supabase/functions/message-sender/index.ts
  - supabase/functions/scraper/index.ts
  - supabase/functions/tests/fixtures/twipla_event.html
  - supabase/functions/tests/line_signature_test.ts
  - supabase/functions/tests/twipla_live_test.ts
  - supabase/functions/tests/twipla_parser_test.ts
  - supabase/functions/webhook/index.ts
  - supabase/migrations/20260611171037_create_core_tables.sql
  - supabase/migrations/20260611171038_enable_rls.sql
  - supabase/seed.sql
findings:
  critical: 1
  warning: 8
  info: 9
  total: 18
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-11T17:36:05Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the Phase 1 foundation: Postgres schema + RLS migrations, Twipla scraper with provider abstraction, LINE webhook signature validation, message-sender scaffold, and tests. Secret-leakage scan of the reviewed tree found no Supabase project refs (dev `cmsxvxtcdniqgvhxjqri` or prod `hgojtooexbknqotzkkja`), no hardcoded credentials (the LINE secret in tests is the official published test vector), and the fixture HTML is correctly anonymized (testuser*, example.com avatars). Webhook ordering (raw body → signature → parse) is correct, and RLS policies are deny-by-default with sound join chains and no policy recursion.

However, the review found one critical data-model defect and several confirmed-by-experiment robustness gaps:

1. **Critical:** the `participants` upsert conflict key is `(event_platform_url_id, display_name)`, but Twipla display names are user-chosen and not unique. Two participants with the same display name in one scrape abort the entire upsert batch (Postgres "ON CONFLICT DO UPDATE command cannot affect row a second time"); across scrapes, distinct users silently merge into one row.
2. `canHandle`'s claim of rejecting port-bearing URLs is false — `URL.hostname` strips the port (verified: `https://twipla.jp:8080/...` passes).
3. `validateLineSignature` throws `DataError` on an empty channel secret (verified in Deno), contradicting its "never throws" contract, so a missing `LINE_CHANNEL_SECRET` env yields an unhandled 500 in the webhook.

## Critical Issues

### CR-01: participants の upsert 衝突キーに非ユニークな display_name を使用 — 同名参加者でバッチ全滅・別人のサイレント統合

**File:** `supabase/migrations/20260611171037_create_core_tables.sql:83`, `supabase/functions/scraper/index.ts:74-86`, `supabase/functions/_shared/providers/twipla.ts:53`
**Issue:** `unique(event_platform_url_id, display_name)` を upsert の `onConflict` ターゲットにしているが、Twipla の表示名（`n` 属性）はユーザーが自由に設定でき一意性がない。実害は2系統:
1. **同一スクレイプ内に同名参加者が2人いる場合**、upsert の rows 配列に同一キーが重複し、Postgres が `ON CONFLICT DO UPDATE command cannot affect row a second time` でバッチ全体を reject する。エラーはログされるだけで HTTP 200 (`saved: false`) が返り、参加者データは1件も保存されない。
2. **別バッチで同名の別人が現れた場合**、upsert が既存行を上書きし、別人のデータがサイレントに統合・消失する（screen_name/profile_url が別人の値で置き換わる）。

Twipla には一意な `s` 属性（X screen name）と `href`（`/users/<screenName>`）があり、これを識別子に使わない理由がない。
**Fix:**
```sql
-- screen_name ベースの一意キーに変更（screen_name が null の場合は display_name にフォールバック）
alter table public.participants
  drop constraint participants_event_platform_url_id_display_name_key;
alter table public.participants
  add column identity_key text generated always as (coalesce(screen_name, display_name)) stored;
alter table public.participants
  add constraint participants_epu_identity_key unique (event_platform_url_id, identity_key);
```
```typescript
// scraper/index.ts: onConflict を identity キーに合わせ、さらに防御としてバッチ内重複を除去
const seen = new Set<string>();
const rows = result.participants
  .filter((p) => {
    const key = p.screenName ?? p.displayName;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .map((p) => ({ /* ... */ }));
const { error: upsertError } = await supabase
  .from("participants")
  .upsert(rows, { onConflict: "event_platform_url_id,identity_key" });
```

## Warnings

### WR-01: validateLineSignature は空シークレットで例外を投げ、webhook が未処理 500 になる

**File:** `supabase/functions/_shared/line/signature.ts:24-30`, `supabase/functions/webhook/index.ts:34-35`
**Issue:** docコメントは「例外を投げない」と主張するが、`channelSecret` が空文字のとき `crypto.subtle.importKey` は `DataError: Key length is zero` を投げる（Deno で実証済み）。webhook 側は `Deno.env.get("LINE_CHANNEL_SECRET") ?? ""` で空文字を渡すため、env 未設定時に try/catch なしの例外 → 500 となり、設定ミスがシグネチャ不正(401)と区別できないクラッシュとして現れる。テスト（`line_signature_test.ts:55-61`）は空 body/署名のみ検証し、空シークレットのケースを欠いている。
**Fix:**
```typescript
// signature.ts 冒頭でガード（契約どおり例外を投げず false を返す）
if (!channelSecret) return false;
```
加えて webhook 側で env 未設定を起動時に検知し、明示的に 500 + 設定エラーログを出すのが望ましい。空シークレットのユニットテストも追加すること。

### WR-02: canHandle はポート付き URL を拒否しない（コメントの主張と実装が乖離）

**File:** `supabase/functions/_shared/providers/twipla.ts:96-99`
**Issue:** コメントは「hostnameは厳密に twipla.jp（サブドメイン・ポート付きも拒否）」と主張するが、`URL.hostname` はポートを含まない（`URL.host` がポート込み）。実証: `new URL("https://twipla.jp:8080/events/123").hostname === "twipla.jp"` でチェックを通過し、`fetchParticipants` が twipla.jp の任意ポートへ接続する。SSRF 影響は twipla.jp ホストに限定されるが、この関数経由で twipla.jp のポートスキャンが可能になり、許可リストの意図（標準ポートの Web ページのみ）を破る。テスト（`twipla_parser_test.ts:75-88`）にもポート付き URL のケースがない。
**Fix:**
```typescript
// ポート明示の URL を拒否
if (parsed.port !== "") {
  return false;
}
```
テストに `assertEquals(twiplaProvider.canHandle("https://twipla.jp:8080/events/123"), false)` を追加。

### WR-03: scraper が .single() のエラーを破棄し、DB 障害を「URL 未登録」と誤判定 / upsert 失敗でも 200 を返す

**File:** `supabase/functions/scraper/index.ts:67-71, 88-90, 100-110`
**Issue:** `const { data: epu } = await supabase.from("event_platform_urls")...single()` で `error` を分割代入から落としている。`.single()` は「0行」(PGRST116) でも「DB接続障害」でもエラーを返すため、本物の DB 障害が `url not registered` ログと同じ経路に落ち、運用上区別不能。さらに upsert 失敗時（CR-01 のバッチ全滅を含む）もレスポンスは HTTP 200 で `saved: false` のみ — 呼び出し側（将来の cron/管理画面）がリトライ判断できない。
**Fix:**
```typescript
const { data: epu, error: epuError } = await supabase
  .from("event_platform_urls")
  .select("id")
  .eq("url", body.url)
  .maybeSingle(); // 0行はdata:nullで返りerrorにならない
if (epuError) {
  console.error(`[scraper] epu lookup error: ${epuError.message}`);
  return new Response(JSON.stringify({ error: "db error" }), { status: 500, ... });
}
// upsertError 時も 500 を返す
```

### WR-04: fetchParticipants にタイムアウトがなく、twipla.jp のハングで関数が滞留する

**File:** `supabase/functions/_shared/providers/twipla.ts:111-113`
**Issue:** `fetch(url, { redirect: "error" })` に AbortSignal がない。twipla.jp が応答を保留すると Edge Function はランタイムの wall-clock 上限まで滞留し、呼び出し側にエラーも返らない。外部サイト依存のスクレイパーでは明示タイムアウトが必須。
**Fix:**
```typescript
const response = await fetch(url, {
  redirect: "error",
  signal: AbortSignal.timeout(10_000), // 10秒
});
```

### WR-05: updated_at がどの経路でも更新されない（トリガー欠如 + upsert に未含有）

**File:** `supabase/migrations/20260611171037_create_core_tables.sql:13,41,81`, `supabase/functions/scraper/index.ts:74-82`
**Issue:** `oa_configs.updated_at` / `events.updated_at` / `participants.updated_at` は `default now()` のみで、UPDATE 時に更新するトリガーが存在しない。scraper の upsert rows にも `updated_at` が含まれないため、再スクレイプでステータスが変わっても `updated_at` は INSERT 時刻のまま固定される。「いつ更新されたか」を示すカラムとして機能しておらず、Phase 2 以降の確認配信判定がこのカラムに依存すると誤動作する。
**Fix:**
```sql
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger participants_set_updated_at before update on public.participants
  for each row execute function public.set_updated_at();
-- oa_configs / events にも同様に
```

### WR-06: displayName の `??` フォールバックは空文字の n 属性を素通しし、空 display_name 行を生成する

**File:** `supabase/functions/_shared/providers/twipla.ts:53`
**Issue:** `$(el).attr("n") ?? $(el).text().trim()` は `n=""`（属性は存在するが空）のとき `??` が発火せず `displayName = ""` になる。`screenName`/`profileUrl` は後段で `|| null` により空文字を正規化しているのに、displayName だけ正規化がない。空文字は `not null` 制約を通過して DB に入り、CR-01 の一意キー（display_name）にも空文字として参加するため、空 n 属性が2件あればバッチ全体が落ちる。
**Fix:**
```typescript
const displayName = ($(el).attr("n") || $(el).text().trim()) || "";
if (!displayName) return; // 名前が取れないエントリはスキップ（continue相当）
```

### WR-07: live テストがゲートされておらず、デフォルトのテスト実行が実ネットワークに依存する

**File:** `supabase/functions/tests/twipla_live_test.ts:9`
**Issue:** `deno test` でテストディレクトリ全体を走らせると、この実 URL fetch テストも常に実行対象になる。`--allow-net=twipla.jp` がなければ permission エラーで fail し、あれば twipla.jp の実イベント（参加者数・開催状態が変動）に結果が依存するフレーキーテストになる。CI 導入時にユニットテストまで巻き添えで赤くなる構造。
**Fix:**
```typescript
Deno.test({
  name: "live: twipla event 731057",
  ignore: Deno.env.get("LIVE_TEST") !== "1", // 明示オプトインのみ実行
  fn: async () => { /* ... */ },
});
```

### WR-08: issueStatelessToken がレスポンス形状を検証せず undefined を string として返しうる

**File:** `supabase/functions/_shared/line/token.ts:41-42`
**Issue:** `return json.access_token as string` は、LINE が 200 で想定外の形状を返した場合（または将来のレスポンス変更時）に `undefined` を `string` にキャストして返す。Phase 2 でこの戻り値が `Authorization: Bearer ${token}` に展開されると `Bearer undefined` という分かりにくい 401 として顕在化する。型キャストは検証の代替にならない。
**Fix:**
```typescript
const json = await res.json();
if (typeof json.access_token !== "string" || json.access_token === "") {
  throw new Error("token issue failed: malformed response"); // ボディはログしない方針を維持
}
return json.access_token;
```

## Info

### IN-01: registry.ts の冗長な URL パースと意味のない `void parsed`

**File:** `supabase/functions/_shared/providers/registry.ts:16-25`
**Issue:** `resolveProvider` 内で `new URL(url)` してから `void parsed;`（「providers が暗黙に使う」というコメントは事実と異なる — 各 provider の `canHandle` は自前で再パースする）。パース結果は一切使われない死にコード。早期 return の入力検証として残すなら `void parsed` とコメントを削除し、検証目的であることを明記する。
**Fix:** `void parsed;` 行と誤解を招くコメントを削除（try/catch の早期 return 自体は残してよい）。

### IN-02: twipla.ts のファイル全体 lint 無効化（`deno-lint-ignore-file`）

**File:** `supabase/functions/_shared/providers/twipla.ts:8`
**Issue:** 行8の `// deno-lint-ignore-file` はファイル全体の全 lint ルールを無効化する。行27・51の per-line ignore はこれにより冗長。将来このファイルに入るバグ的パターン（unused vars 等）が一切検出されなくなる。
**Fix:** 行8を削除し、必要箇所のみ `// deno-lint-ignore no-explicit-any` を残す。

### IN-03: message-sender が env 未設定を検知せず空クレデンシャルで LINE API を呼ぶ

**File:** `supabase/functions/message-sender/index.ts:21-22`
**Issue:** `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` 未設定時に空文字で LINE token API を呼び、LINE 側の 400 を 502（上流エラー）として返す。設定ミスが「LINE 障害」に見える誤分類。
**Fix:** `if (!channelId || !channelSecret)` で早期に 500 + `console.error("missing LINE env")` を返す。

### IN-04: supabase.ts の non-null assertion は env 欠落時に不明瞭なエラーになる

**File:** `supabase/functions/_shared/supabase.ts:13-14`
**Issue:** `Deno.env.get(...)!` は env 欠落時に `undefined` を `createClient` へ渡し、supabase-js 内部の分かりにくいエラーになる。Edge Functions では自動注入されるため通常は発生しないが、ローカル `deno test` 等で踏むと原因特定に時間がかかる。
**Fix:** 明示チェックして `throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")`。

### IN-05: oa_members.auth_user_id に auth.users への外部キーがない

**File:** `supabase/migrations/20260611171037_create_core_tables.sql:24`
**Issue:** `auth_user_id uuid not null` に `references auth.users(id) on delete cascade` がなく、存在しない/削除済みユーザー ID のメンバー行が残留しうる。RLS は `auth.uid()` 比較なので即座のセキュリティ問題ではないが、孤児行が権限管理画面（Phase 3）のノイズになる。
**Fix:** `auth_user_id uuid not null references auth.users(id) on delete cascade` に変更（Supabase 公式パターン）。

### IN-06: line_users.line_user_id のグローバル unique 制約はマルチ OA 要件と矛盾する

**File:** `supabase/migrations/20260611171037_create_core_tables.sql:60-61`
**Issue:** LINE の userId はプロバイダー単位で同一人物に同じ値が振られるため、同一ユーザーが2つの OA（チャネル）を友だち追加すると `unique(line_user_id)` に衝突し、2つ目の OA に紐付けられない。OA-02（複数 OA 管理）の前提と整合しない。Phase 1 では未使用テーブルだが、Phase 2 の webhook follow イベント処理で顕在化する。
**Fix:** `unique(oa_config_id, line_user_id)` に変更（その場合 `oa_config_id` の nullable 設計も再検討）。

### IN-07: フィクスチャパスに URL.pathname を使用 — 特殊文字を含むパスで壊れる

**File:** `supabase/functions/tests/twipla_parser_test.ts:10`
**Issue:** `new URL(..., import.meta.url).pathname` はパスにスペースや非 ASCII 文字が含まれるとパーセントエンコードされた文字列を返し、`Deno.readTextFileSync` が失敗する。`Deno.readTextFileSync` は URL オブジェクトを直接受け取れる。
**Fix:** `const FIXTURE_URL = new URL("./fixtures/twipla_event.html", import.meta.url);` として `Deno.readTextFileSync(FIXTURE_URL)` に変更。

### IN-08: URL 正規化なしの完全一致照合 — クエリ/フラグメント付き URL は登録 URL とマッチしない

**File:** `supabase/functions/scraper/index.ts:67-71`, `supabase/functions/_shared/providers/twipla.ts:102`
**Issue:** `canHandle` は pathname のみ検査するため `https://twipla.jp/events/731057?utm_source=x` は通過しスクレイプも成功するが、DB 照合は `eq("url", body.url)` の完全一致なので `saved: false` になる。同一イベントの表記ゆれ（trailing 文字・クエリ付き）で保存有無が変わる。
**Fix:** 照合前に `url.origin + url.pathname` へ正規化する（または canHandle で `parsed.search !== "" || parsed.hash !== ""` を拒否）。

### IN-09: 再スクレイプでリストから消えた参加者が attending のまま残留する

**File:** `supabase/functions/scraper/index.ts:74-94`
**Issue:** upsert のみで削除・無効化がないため、Twipla 上で参加を取り消してリストから消えたユーザーは DB 上で永遠に `attending` のまま残る。Phase 2 の最終確認配信がこの行を信頼すると、すでに不参加の人に配信される。Phase 1 スコープ外なら Phase 2 計画に明記すること。
**Fix:** スクレイプごとに `scraped_at` を比較し、今回のバッチに含まれない既存行を `status='unknown'` 等にマークする処理を Phase 2 で追加。

---

_Reviewed: 2026-06-11T17:36:05Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
