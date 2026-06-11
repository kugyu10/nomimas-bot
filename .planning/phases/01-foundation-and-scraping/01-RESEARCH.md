# Phase 1: 基盤構築 + スクレイピング検証 - Research

**Researched:** 2026-06-12
**Domain:** Supabase Edge Functions (Deno) / PostgreSQL+RLS / Twiplaスクレイピング / LINE Messaging API Webhook
**Confidence:** HIGH（主要リスク項目はすべて本セッションで実機検証済み）

## Summary

本フェーズの最大リスクであるTwiplaスクレイピングは、**本リサーチ中に実機で完全検証済み**。サンプルイベント（https://twipla.jp/events/731057）をUA指定なしのHTTP GETで取得でき（200, UTF-8, 静的HTML）、Deno 2.8.2 + `npm:cheerio@1.2.0` で `a.card.namelist` から参加者名（`n`属性）・Xスクリーンネーム（`s`属性）を正しく抽出できることを実コードで確認した。**重大な落とし穴を1件発見**: `a.card.namelist` セレクタ単体では「参加者」だけでなく「興味あり」「不参加」セクションの人も全員ヒットする（サンプルでは4件中2件が「興味あり」）。`div.member_list` セクション単位でスコープして抽出する必要がある。

LINE Webhook署名検証（`x-line-signature` / HMAC-SHA256 / channel secret / raw body / Base64）は、LINE公式ドキュメントのテストベクタに対しWeb Crypto API（`crypto.subtle`）実装で検証成功。Node専用SDKに依存せずDeno Edge Functionsでそのまま動く。Supabase CLI 2.101.0はインストール・ログイン済みで、dev（cmsxvxtcdniqgvhxjqri）・prod（hgojtooexbknqotzkkja）両プロジェクトを確認した（未リンク）。**Dockerデーモンは起動していない**が、`supabase functions deploy --use-api` でDockerなしデプロイ可能（CLIは自動フォールバックもする）、DBは `supabase db reset --db-url "$SUPABASE_DIRECT_CONNECTION_STRING"` でリモートdevに対し非対話で実行できるため、夜間無人実行のブロッカーにはならない。

**Primary recommendation:** モノリポは `supabase/` 標準レイアウト（`supabase/functions/<name>/index.ts` + `supabase/functions/_shared/`）で構成し、パーサ（純関数）とフェッチャを分離してDeno組み込みテストランナーでフィクスチャテストを書く。webhook関数のみ `config.toml` で `verify_jwt = false`。dev操作はすべて `--project-ref cmsxvxtcdniqgvhxjqri` または env.dev の `--db-url` を明示し、prod refをコードや計画に一切登場させない。

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- スタック: Supabase Edge Functions + pg_cron / PostgreSQL + RLS / cheerio / TypeScript 5.x + zod 4.x / @line/bot-sdk v11
- dev環境（cmsxvxtcdniqgvhxjqri）のみ使用。prod（hgojtooexbknqotzkkja）には一切触れない
- LINEアクセストークンは静的に持たず、実行時にステートレストークン(v3, POST https://api.line.me/oauth2/v3/token, 有効15分)を都度発行
- リポジトリはpublic — env.dev / env.prod / 全シークレットのコミット禁止（.gitignore整備済み）

### Claude's Discretion
純粋な基盤構築フェーズのため、上記Locked事項に反しない範囲で実装上の選択（モノリポのディレクトリ構成、テストランナー、マイグレーションファイル分割、プロバイダーインターフェースのシグネチャ等）はすべてClaudeの裁量とする。ROADMAPの成功条件・コードベース規約・docs.mdの仕様を判断基準にする。

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVENT-02 | 管理者はイベントプラットフォームURLから参加者リストを自動取得できる（v1はTwiplaスクレイピング。将来的なJimoty・Peatix等への拡張を考慮したプロバイダー抽象化で実装） | Twipla HTML構造を実機検証済み（後述のCode Examples）。`n`/`s`属性から名前・Xアカウントを取得。プロバイダー抽象化インターフェース案を「Architecture Patterns」に提示。cheerio 1.2.0 のDeno動作確認済み |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` は存在しない。代わりに以下がプロジェクト規約として効力を持つ（PROJECT.md / NIGHT-RUN.md / SETUP.md 由来）:

- **prod接触禁止**: あらゆるCLI/APIコマンドで対象refを明示。`hgojtooexbknqotzkkja` を一切使わない
- **publicリポジトリ**: env.dev / env.prod / シークレット類のコミット禁止（.gitignore検証済み — env.dev, env.prod, .env, .env.*, *.pem, *.key が除外、.env.exampleのみ許可）[VERIFIED: .gitignore実読]
- **夜間無人実行前提**: 全コマンドは非対話（パスワードプロンプト等を踏まない）であること。成功条件は機械検証可能であること

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Twipla HTML取得・パース | API/Backend (Edge Function: scraper) | — | サーバーサイドfetch。CORSや秘匿不要だがDBへの保存とアトミックに行う |
| 参加者データ永続化 | Database (Postgres) | API/Backend | participants テーブル。service roleで書き込み |
| LINE Webhook受信・署名検証 | API/Backend (Edge Function: webhook) | — | 署名検証はraw body必須のためエッジで実施。LINEはJWTを送れないので verify_jwt=false |
| LINEメッセージ送信（雛形） | API/Backend (Edge Function: message-sender) | — | ステートレストークン発行→Messaging API呼び出し。Phase 1は雛形のみ |
| ステートレストークン発行 | API/Backend (_shared module) | — | channel secretを扱うためEdge Function内のみ。クライアント側に出さない |
| スキーマ・RLS | Database | — | マイグレーションSQLで宣言的に管理 |
| シークレット管理 | Supabase Secrets + env.dev (local) | — | LINE_CHANNEL_ID/SECRET は `supabase secrets set`。SUPABASE_* は自動注入 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| cheerio | 1.2.0 | TwiplaのHTMLパース | Locked。`npm:cheerio@1.2.0` でDeno 2.8.2動作を実機確認済み [VERIFIED: 本セッションで実行] |
| zod | 4.4.3 | Webhookペイロード等のバリデーション | Locked（zod 4.x）。npm latest = 4.4.3 [VERIFIED: npm registry + slopcheck OK] |
| @supabase/supabase-js | 2.108.1 | Edge FunctionからのDBアクセス | Supabase公式クライアント。`npm:@supabase/supabase-js@2` [VERIFIED: npm registry + slopcheck OK] |
| Deno (runtime) | 2.8.2 (local) | Edge Functions実行・テスト | インストール済み確認。Edge FunctionsはDenoランタイムのみサポート [CITED: supabase.com/docs/guides/functions/quickstart] |
| Supabase CLI | 2.101.0 | init / migration / deploy / secrets | インストール・ログイン済み確認 [VERIFIED: ローカル実行] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Deno標準テストランナー | (Deno同梱) | フィクスチャテスト・署名検証テスト | 追加インストール不要。`deno test` |
| Web Crypto API (`crypto.subtle`) | (Deno同梱) | LINE署名検証 HMAC-SHA256 | Node専用SDK不要。公式テストベクタで検証済み |
| @line/bot-sdk | 11.0.1 | LINE Messaging API（Phase 2以降） | Locked。**Phase 1では使わない**（署名検証はWeb Cryptoで十分。SDKのvalidateSignatureはNode cryptoに依存し、Denoでは `node:crypto` 互換で動く可能性はあるが未検証） |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Web Crypto手書き署名検証 | @line/bot-sdk の validateSignature | SDKはNode向け。Denoのnode:互換で動く可能性はあるがEdge Functionsでの動作未検証。Web Crypto実装は10行程度でテストベクタ検証済みのため手書きが確実 |
| deno test | Vitest/Jest | Edge FunctionsはDenoネイティブ。Node系ランナーはnpm:解決の挙動が異なり二重管理になる |
| リモートdevへの db reset --db-url | ローカルスタック（supabase start, 要Docker） | Dockerデーモン未起動のため夜間実行ではリモートdev直結が確実。Dockerが起動できればローカル併用も可 |

**Installation:**
```bash
# npmインストールは不要 — Edge Functions/deno testはnpm:指定子で直接解決する
# 例: import * as cheerio from "npm:cheerio@1.2.0";
# 依存は supabase/functions/deno.json の "imports" に集約する
```

**Version verification:** 実施済み（2026-06-12）:
- `npm view cheerio version` → 1.2.0（最終更新 2026-02-21）
- `npm view zod version` → 4.4.3（latest）
- `npm view @line/bot-sdk version` → 11.0.1
- `npm view @supabase/supabase-js version` → 2.108.1

## Package Legitimacy Audit

slopcheck 0.6.1 を本セッションでインストールし、npmエコシステム指定でスキャン実施。

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| cheerio | npm | 10年超 | 数千万/wk級 | github.com/cheeriojs/cheerio | [OK] | Approved |
| zod | npm | 5年超 | 数千万/wk級 | github.com/colinhacks/zod | [OK] | Approved |
| @supabase/supabase-js | npm | 5年超 | 数百万/wk級 | github.com/supabase/supabase-js | [OK] | Approved |
| @line/bot-sdk | npm | 8年超 | 公式SDK | github.com/line/line-bot-sdk-nodejs | [OK]（info: "-sdk"命名パターン注記のみ、established判定） | Approved（Phase 1では未使用） |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**postinstallスクリプト:** cheerio / zod ともになし [VERIFIED: npm view scripts.postinstall 空]

⚠️ **クロスエコシステム注意（実害確認済み）**: PyPIにも `cheerio` / `zod` という**無関係の同名パッケージ**が存在する。誤って `pip install cheerio` / `pip install zod` を実行しないこと。本プロジェクトの依存はすべてnpm（`npm:` 指定子）。

## Architecture Patterns

### System Architecture Diagram

```
[LINE Platform] --POST + x-line-signature--> [Edge Fn: webhook (verify_jwt=false)]
                                                  |-- HMAC-SHA256検証 (channel secret, raw body)
                                                  |-- OK: 200 / NG: 401
                                                  '-- (Phase 2でstate machineに接続)

[手動curl / 将来pg_cron] --Authorization: Bearer ANON_KEY--> [Edge Fn: scraper]
                                                  |-- ProviderRegistry.resolve(url)
                                                  |-- TwiplaProvider.fetchParticipants(url)
                                                  |      |-- fetch(twipla.jp)  --GET--> [Twipla (静的HTML)]
                                                  |      '-- parseTwiplaHtml(html) … cheerio純関数
                                                  '-- supabase-js (service role) --upsert--> [Postgres: participants]

[手動curl / 将来pg_cron] --> [Edge Fn: message-sender (Phase 1は雛形)]
                                                  |-- POST api.line.me/oauth2/v3/token (15分トークン)
                                                  '-- (Phase 2でpush message実装)

[supabase/migrations/*.sql] --supabase db push/reset--> [Postgres: 6テーブル + RLS]
```

### Recommended Project Structure
```
supabase/
├── config.toml                  # supabase init生成。[functions.webhook] verify_jwt = false を追記
├── migrations/
│   ├── <ts>_create_core_tables.sql      # 6テーブル + oa_members（推奨追加）
│   └── <ts>_enable_rls.sql              # RLS有効化 + ポリシー
└── functions/
    ├── deno.json                # top-level imports（cheerio, zod, supabase-js のバージョン固定）
    ├── _shared/
    │   ├── line/
    │   │   ├── signature.ts     # validateSignature(rawBody, secret, sig) — Web Crypto
    │   │   └── token.ts         # issueStatelessToken(channelId, channelSecret)
    │   ├── providers/
    │   │   ├── types.ts         # ParticipantListProvider インターフェース
    │   │   ├── registry.ts      # URL→プロバイダー解決
    │   │   └── twipla.ts        # fetchTwipla + parseTwiplaHtml（純関数）
    │   └── supabase.ts          # service roleクライアント生成
    ├── webhook/index.ts
    ├── scraper/index.ts
    ├── message-sender/index.ts
    └── tests/                   # 関数フォルダ外に置く（デプロイバンドル対象外にする）
        ├── fixtures/twipla_event.html   # 匿名化フィクスチャ（後述）
        ├── twipla_parser_test.ts
        └── line_signature_test.ts
```

### Pattern 1: プロバイダー抽象化（EVENT-02の将来拡張要件）
**What:** 参加者リスト取得をプラットフォーム非依存のインターフェースに切る。パース（純関数）とフェッチを分離。
**When to use:** scraper関数からは必ずRegistry経由でアクセス。Twipla固有コードを関数本体に書かない。
**Example:**
```typescript
// _shared/providers/types.ts （Claudeの裁量範囲での推奨シグネチャ）
export type ParticipantStatus = "attending" | "interested" | "declined";

export interface ScrapedParticipant {
  displayName: string;        // Twipla: a.card.namelist の n属性
  screenName: string | null;  // Twipla: s属性（Xアカウント名）
  profileUrl: string | null;  // Twipla: href（/users/<screenName>）
  status: ParticipantStatus;
}

export interface ScrapeResult {
  platform: string;
  sourceUrl: string;
  participants: ScrapedParticipant[];
  capacity: number | null;     // "参加者 (2人／定員15人)" から抽出可
  fetchedAt: string;           // ISO8601
}

export interface ParticipantListProvider {
  readonly platform: string;          // "twipla"
  canHandle(url: string): boolean;    // hostnameがtwipla.jpか等 — SSRF対策を兼ねる
  fetchParticipants(url: string): Promise<ScrapeResult>;
}
```

### Pattern 2: パーサを純関数に分離してフィクスチャテスト
**What:** `parseTwiplaHtml(html: string): ScrapeResult部分` をネットワーク非依存の純関数にし、保存済みフィクスチャHTMLでdeno testする。実URL検証は同じfetch+parseを通すだけ。
**When to use:** 全プロバイダー実装で必須。

### Pattern 3: webhookのみ verify_jwt 無効化
**What:** LINEプラットフォームはSupabase JWTを送れないため、webhook関数だけ認証チェックを外し、代わりに署名検証をアプリ層で行う。scraper / message-sender はJWT検証を残す（呼び出しテストは `Authorization: Bearer $SUPABASE_ANON_KEY` で行う）。
```toml
# supabase/config.toml
[functions.webhook]
verify_jwt = false
```
[CITED: supabase.com/docs/guides/functions/function-configuration — "Stripe webhooks need to be publicly accessible" と同型のパターン。config.tomlはデプロイ時に尊重される]
**注意:** GitHub issue（supabase/cli#4059 等）でconfig.toml設定が無視されるケースが報告されているため、デプロイ後に「署名なしリクエストが401(gateway)でなく関数に到達すること」を実際にcurlで確認する検証ステップを入れること。確実を期すなら `supabase functions deploy webhook --no-verify-jwt --project-ref "$DEV_PROJECT_REF"` とフラグでも明示する（deployコマンドに `--no-verify-jwt` フラグ存在をCLIヘルプで確認済み）。

### Anti-Patterns to Avoid
- **`a.card.namelist` をページ全体に適用**: 「興味あり」「不参加」の人まで参加者として取り込む（実害をサンプルで確認 — 4件中2件が興味あり）。必ず `div.member_list` セクションでスコープし、先頭テキスト「参加者」で判別する
- **アンカーのテキストノードから名前を取る**: `n`属性が正規の名前。テキストはトリム等で揺れる可能性があるため属性優先（フォールバックでtext）
- **トークンのキャッシュ/永続化**: ステートレストークンは取り消し不可・無制限発行可・15分有効。都度発行が公式推奨設計 [CITED: developers.line.biz/en/docs/basics/channel-access-token/]
- **`supabase link` 前提の対話的フロー**: linkはDBパスワードを聞く場合がある。夜間実行は `--project-ref` / `--db-url` を毎回明示する非対話形に統一
- **テストファイルを関数フォルダ内に置く**: デプロイバンドルに混入しうる。`functions/tests/` に分離
- **実名入りフィクスチャのコミット**: リポジトリはpublic。取得した実HTMLは構造を保ったまま名前・アカウント名をダミーに置換して保存する

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTMLパース | 正規表現パーサ | cheerio (`npm:cheerio@1.2.0`) | 属性順・エンティティ・ネスト対応。Locked決定でもある |
| HMAC-SHA256 | 独自実装 | `crypto.subtle`（Web Crypto） | 標準API。公式テストベクタで検証済み |
| スキーマバリデーション | 手書きif分岐 | zod 4.4.3 | Webhookイベントの形状検証・型導出 |
| DBアクセス | 生のfetchでPostgREST | @supabase/supabase-js | service roleキー処理・エラー処理込み |
| マイグレーション管理 | 手動SQL適用 | supabase migration new + db push/reset | 履歴テーブルで冪等管理。成功条件2の検証手段そのもの |

**Key insight:** このフェーズは「土台の再現性」が価値。CLI標準ワークフロー（migration/deploy/secrets）から外れたカスタムスクリプトを作るほど、Phase 2-4と夜間実行の再現性が下がる。

## Common Pitfalls

### Pitfall 1: セレクタが「興味あり」を巻き込む（最重要・実証済み）
**What goes wrong:** `$("a.card.namelist")` はページ内の全名簿セクション（参加者/興味あり/不参加）にマッチする。サンプルイベントでは参加者2名に対し4件ヒット。
**Why it happens:** Twiplaは3つの `div.float_left.member_list.round_border` セクションすべてで同じアンカークラスを使う。
**How to avoid:** セクションの先頭テキスト（`参加者 (2人／定員15人)` / `興味あり (2人)` / `不参加 (0人)`）でステータス判別してから配下のアンカーを抽出（Code Examples参照）。
**Warning signs:** テストで participants数 > セクション表示人数。

### Pitfall 2: webhookがSupabaseゲートウェイで401になり関数に届かない
**What goes wrong:** Edge FunctionsはデフォルトでAuthorizationヘッダのJWT検証を行う。LINEのwebhook配信はJWTを持たないため、関数コードに到達する前に拒否される。
**How to avoid:** config.toml `[functions.webhook] verify_jwt = false` + deploy時 `--no-verify-jwt` の二重指定。デプロイ後にLINE Developersコンソールの「検証」ボタン相当（または署名付きcurl）で200を確認。
**Warning signs:** LINE側Webhook検証が失敗、関数ログに何も出ない（ゲートウェイで弾かれている）。

### Pitfall 3: 署名検証でraw bodyを使わない
**What goes wrong:** `await req.json()` してから再シリアライズしたものに署名検証すると、キー順・空白差で不一致になる。
**How to avoid:** `const rawBody = await req.text();` で先に生文字列を取り、検証後に `JSON.parse(rawBody)`。公式も「request body stringを改変するな」と明記 [CITED: developers.line.biz/en/docs/messaging-api/verify-webhook-signature/]。

### Pitfall 4: Docker前提のコマンドで夜間実行が止まる
**What goes wrong:** `supabase start` / `supabase db reset --local` / 既定のdeployバンドルはDockerを要する。本マシンはDockerクライアントのみでデーモン未起動 [VERIFIED: docker info失敗]。
**How to avoid:** deployは `--use-api`（CLIはDocker不在時に自動フォールバックもする [CITED: supabase.com/docs/guides/functions/quickstart]）。DBは `--db-url "$SUPABASE_DIRECT_CONNECTION_STRING"`（env.devに格納済み）でリモートdevへ直接 push/reset。
**Warning signs:** "Cannot connect to the Docker daemon" エラー。

### Pitfall 5: `supabase db reset` の対象取り違え
**What goes wrong:** 引数なしの `db reset` はローカル（Docker）対象。`--linked` はリンク済みプロジェクト＝**リモートDBを破壊的にリセット**する。リンク先を誤るとprod破壊につながる。
**How to avoid:** このリポジトリでは**linkを使わず** `--db-url`（env.devの接続文字列）で対象を毎回明示するのが最も安全。成功条件2の「`supabase db reset` が成功」は `supabase db reset --db-url "$SUPABASE_DIRECT_CONNECTION_STRING" --yes` で充足する（devは空なので破壊的でも問題なし）。prod refを含むコマンドはレビューで機械的に拒否（grepチェックをタスク化してもよい）。

### Pitfall 6: SUPABASE_ プレフィックスのシークレット
**What goes wrong:** Edge Functionsには SUPABASE_URL / SUPABASE_DB_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY が自動注入される [CITED: supabase.com/docs/guides/functions/secrets]。これらを `supabase secrets set` で上書きしようとすると失敗・混乱の元。
**How to avoid:** カスタムで設定するのは `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` のみ: `supabase secrets set --project-ref "$DEV_PROJECT_REF" LINE_CHANNEL_ID=... LINE_CHANNEL_SECRET=...`（値はenv.devから読み、コマンドラインに直書きした履歴を残さないようサブシェルで展開）。

### Pitfall 7: フィクスチャに実在ユーザーの実名・Xアカウントをコミット
**What goes wrong:** リポジトリはpublic。サンプルイベントHTMLには実在参加者の表示名とXアカウント名が含まれる。
**How to avoid:** フィクスチャ保存時に `n`/`s`/`href`/テキスト/画像URLをダミー値に置換（構造・属性順・セクション構成は完全保持）。実URL検証は実行時にfetchして件数・形状アサーションのみ行い、結果をコミットしない。

## Code Examples

### Twipla HTML実構造（2026-06-12に実URLから取得・検証済み）
```html
<!-- Source: https://twipla.jp/events/731057 (live fetch, UTF-8, UAなしでも200) -->
<div class='float_left member_list round_border'>参加者 (2人／定員15人) <br/>
  <ul>
    <li><img ... class="lazyload circle" ... />&nbsp;<a href="/users/kugyu10"
        class="card namelist" n="くぎゅう10@オタクなエンジニア" s="kugyu10"
        title="@kugyu10" target="_self">くぎゅう10@オタクなエンジニア</a></li>
    ...
  </ul>
</div>
<div class='float_left member_list round_border'>興味あり (2人) <br/><ul>...同構造...</ul></div>
<div class='float_left member_list round_border'>不参加 (0人) <br/><ul></ul></div>
```
- `n` 属性 = 表示名（X名）、`s` 属性 = Xスクリーンネーム、`href` = `/users/<s>`、`title` = `@<s>`
- 全角文字・記号入り名前（例: `小牙　凜（おがりん)`）も属性から正しく取得できることを確認済み

### Twiplaパーサ（Deno 2.8.2 + npm:cheerio@1.2.0 で実行・出力確認済み）
```typescript
// Source: 本リサーチで実行検証（deno run）。そのまま _shared/providers/twipla.ts の核にできる
import * as cheerio from "npm:cheerio@1.2.0";

export function parseTwiplaHtml(html: string) {
  const $ = cheerio.load(html);
  const participants: { displayName: string; screenName: string | null; status: string }[] = [];
  $("div.member_list").each((_, section) => {
    const label = $(section).contents().first().text().trim();
    const status = label.startsWith("参加者") ? "attending"
      : label.startsWith("興味あり") ? "interested"
      : label.startsWith("不参加") ? "declined" : "unknown";
    $(section).find("a.card.namelist").each((_, el) => {
      participants.push({
        displayName: $(el).attr("n") ?? $(el).text().trim(),
        screenName: $(el).attr("s") ?? null,
        status,
      });
    });
  });
  return participants;
}
// 実行結果（実URL）: attending 2名 / interested 2名 を正しく分類
```

### LINE署名検証（公式テストベクタでパス確認済み・Deno/Edge Functions互換）
```typescript
// Source: developers.line.biz/en/docs/messaging-api/verify-webhook-signature/ のテストベクタで検証済み
export async function validateLineSignature(
  rawBody: string, channelSecret: string, signature: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// webhook/index.ts の骨格
Deno.serve(async (req) => {
  const rawBody = await req.text();                       // 必ずraw bodyを先に取る
  const sig = req.headers.get("x-line-signature") ?? "";
  const ok = await validateLineSignature(rawBody, Deno.env.get("LINE_CHANNEL_SECRET")!, sig);
  if (!ok) return new Response("invalid signature", { status: 401 });
  // JSON.parse(rawBody) → zodで形状検証 → Phase 1はログ出力のみ
  return new Response("ok", { status: 200 });
});
```
公式テストベクタ: body `{"destination":"U8e742f61d673b39c7fff3cecb7536ef0","events":[]}` + secret `8c570fa6dd201bb328f1c1eac23a96d8` → `GhRKmvmHys4Pi8DxkF4+EayaH0OqtJtaZxgTD9fMDLs=`（本セッションで一致を確認）。このベクタをそのまま自動テストに使える。

### ステートレストークン発行（message-sender雛形用）
```typescript
// Source: developers.line.biz/en/docs/basics/channel-access-token/（有効15分・発行無制限・取り消し不可）
// エンドポイント・パラメータはPROJECT.md記載どおり（ユーザーがdev/prod両チャネルで発行テスト成功済み）
export async function issueStatelessToken(channelId: string, channelSecret: string): Promise<string> {
  const res = await fetch("https://api.line.me/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: channelId,
      client_secret: channelSecret,
    }),
  });
  if (!res.ok) throw new Error(`token issue failed: ${res.status}`);
  const json = await res.json();
  return json.access_token as string;  // expires_in: 900
}
```

### dev環境への非対話デプロイ・DB操作（CLI 2.101.0でフラグ存在確認済み）
```bash
# Source: supabase CLI --help 実出力で全フラグ確認済み
set -a; source env.dev; set +a    # DEV_PROJECT_REF / SUPABASE_DIRECT_CONNECTION_STRING 等

supabase init                                              # supabase/config.toml 生成（初回のみ）
supabase migration new create_core_tables                  # migrations/<ts>_*.sql 生成
supabase db push  --db-url "$SUPABASE_DIRECT_CONNECTION_STRING"          # devへ適用
supabase db reset --db-url "$SUPABASE_DIRECT_CONNECTION_STRING" --yes    # ゼロから再現（成功条件2）

supabase secrets set --project-ref "$DEV_PROJECT_REF" \
  LINE_CHANNEL_ID="$LINE_CHANNEL_ID" LINE_CHANNEL_SECRET="$LINE_CHANNEL_SECRET"

supabase functions deploy webhook scraper message-sender \
  --project-ref "$DEV_PROJECT_REF" --use-api               # Docker不要デプロイ
supabase functions deploy webhook --project-ref "$DEV_PROJECT_REF" --use-api --no-verify-jwt

supabase functions list --project-ref "$DEV_PROJECT_REF"   # デプロイ確認（成功条件4の機械検証）
```

### 成功条件4「呼び出しログ確認」の機械検証
```bash
# 関数の実呼び出し（= 呼び出しログが生成される）+ HTTPレスポンス検証
BASE="https://${DEV_PROJECT_REF}.supabase.co/functions/v1"

# webhook: 正署名→200 / 不正署名→401（成功条件3も同時に検証）
BODY='{"destination":"test","events":[]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$LINE_CHANNEL_SECRET" -binary | openssl base64)
curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/webhook" \
  -H "Content-Type: application/json" -H "x-line-signature: $SIG" -d "$BODY"    # => 200
curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/webhook" \
  -H "Content-Type: application/json" -H "x-line-signature: bad=" -d "$BODY"    # => 401

# scraper / message-sender: JWT検証ありの関数はanon keyで呼ぶ
curl -s -X POST "$BASE/scraper" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" -d '{"url":"https://twipla.jp/events/731057"}'
```
ダッシュボードのログUIは手動確認用。機械検証は「functions listに3本存在 + 各関数への実呼び出しが期待ステータスを返す」で充足させる（呼び出し自体がログを生成する）。

### DBスキーマ・RLS存在の機械検証（成功条件2）
```sql
-- psql "$SUPABASE_DIRECT_CONNECTION_STRING" -c で実行
select count(*) from information_schema.tables
 where table_schema='public'
   and table_name in ('events','event_platform_urls','participants','line_users','oa_configs','answers');
-- => 6

select tablename, count(*) from pg_policies where schemaname='public' group by tablename;
-- 全6テーブルにポリシーが1件以上存在すること
select tablename from pg_tables t where schemaname='public'
  and not exists (select 1 from pg_class c where c.relname=t.tablename and c.relrowsecurity);
-- => 0行（RLS未有効テーブルなし）
```

## DBスキーマ設計ガイド（Claudeの裁量範囲の推奨）

必須6テーブル: `events` / `event_platform_urls` / `participants` / `line_users` / `oa_configs` / `answers`。

推奨リレーション（docs.md §9のフローから導出）:
- `oa_configs` 1—N `events`（OAごとにイベント）
- `events` 1—N `event_platform_urls`（URL複数登録、`platform` 列: 'twipla'等 + `url`）
- `event_platform_urls`（または `events`）1—N `participants`（`display_name`, `screen_name`, `status`, `source_platform`, スクレイプ由来メタ）
- `participants` N—1 `line_users`（**nullable FK** — ADMIN-02の手動紐付けはPhase 3。v1は自動紐付けなし）
- `answers`: `participant_id` FK + 質問キー + 回答（Phase 2で書き込み。スキーマだけ先行）
- **追加推奨**: `oa_members`（`oa_config_id`, `auth_user_id`, `role: 'owner'|'co-owner'`）— root/owner/co-ownerモデルのRLSがこのテーブルなしでは書けない。rootは `auth.users` のapp_metadata or 専用フラグで表現（Phase 3/4で本格運用）。成功条件は6テーブルの存在を要求しており追加テーブルは妨げない

RLS方針（Phase 1は「存在」が要件、実運用テストはPhase 3）:
- 全テーブル `enable row level security`
- deny-by-default + 最小ポリシー: 例 `oa_member_can_select`（`oa_members` 経由で `auth.uid()` が紐づく行のみSELECT可）を各テーブルに定義。Edge Functionsはservice roleで動くためRLSをバイパスし、Phase 1の動作には影響しない [ASSUMED: ポリシー詳細設計は裁量 — Phase 3で実認証と突き合わせて拡張する前提の骨格]

## Runtime State Inventory

> 本フェーズはグリーンフィールド（rename/refactorではない）のため本来は省略対象だが、外部サービスに既存状態があるため要点のみ記載。

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | dev DBは空（プロジェクト作成のみ） | なし — マイグレーションで新規作成 |
| Live service config | LINE devチャネル（Webhook URL未設定）。Supabase dev/prodプロジェクト存在 | webhookデプロイ後にWebhook URLをLINEコンソールへ設定（手動 or Phase 2） |
| OS-registered state | なし — 確認済み（cron/launchd等への登録なし） | なし |
| Secrets/env vars | env.dev に10変数格納済み（実名確認済み・値は未閲覧）: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_DIRECT_CONNECTION_STRING / DEV_PROJECT_REF / LINE_CHANNEL_ID / LINE_CHANNEL_SECRET / X_OAUTH_CLIENT_ID / X_OAUTH_CLIENT_SECRET | LINE_CHANNEL_ID/SECRET を `supabase secrets set` でdevへ投入 |
| Build artifacts | supabase/.temp/ のみ（gitignore済み） | なし |

## Common Pitfalls（補足: 計画段階の注意）

- ROADMAPのプラン分割（①モノリポ初期化＋DBスキーマ ②共有モジュール＋scraper ③webhook＋message-sender雛形）はCONTEXT.mdで指定済み。②と③は①完了後なら並行可能だが、`supabase/config.toml` と `functions/deno.json` は①で先に作っておくと衝突しない
- `supabase init` は対話プロンプト（VS Code settings生成など）を出すことがある → `--yes` グローバルフラグ併用

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 長期チャネルアクセストークン | ステートレストークン v3（15分・無制限・取り消し不可） | LINE推奨設計 | OAM経由チャネルには長期トークンUIがなく、本プロジェクトはv3一択（検証済み） |
| import_map.json | 関数ごと/トップレベル deno.json の "imports" | Supabase現行推奨 | config.tomlの import_map 指定はレガシー互換。新規は deno.json |
| Dockerバンドルデプロイ | `--use-api`（サーバーサイドバンドル）+ Docker不在時自動フォールバック | CLI近年版 | Dockerデーモンなしの本環境でもデプロイ可 |
| serve() from std/http | `Deno.serve()` | Deno 1.35+/2.x | 雛形は Deno.serve を使う |

**Deprecated/outdated:**
- `@line/bot-sdk` の旧Client API（v11でmessagingApiクライアントに刷新）— Phase 2で使う際はv11の `messagingApi.MessagingApiClient` 系を使用

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ステートレストークンAPIの厳密なレスポンス形状（access_token/expires_in=900/token_type） | Code Examples | 低 — ユーザーがdev/prodで発行テスト成功済み。実装時に実レスポンスで確認 |
| A2 | RLSポリシーの具体設計（oa_members経由のSELECTポリシー骨格） | DBスキーマ設計ガイド | 低 — Phase 1は存在のみが要件。Phase 3で実認証と突き合わせて改訂可能 |
| A3 | Twiplaの大規模イベント（100人超等）でのページング有無 | Open Questions | 低 — 想定規模10〜30人はサンプルと同様1ページ表示。printlistページ（/events/printlist/<id>）が代替手段として存在 |
| A4 | Management APIによるログ取得エンドポイント（logs.all） | 成功条件4検証 | 低 — 採用しない。functions list + 実呼び出しで機械検証する方針のため影響なし |

## Open Questions (RESOLVED)

1. **Twiplaのレート制限・アクセスポリシー** — RESOLVED: scraperは手動/低頻度トリガー前提（月数回・1イベント数回）。1リクエスト/イベント/実行で十分。リトライは指数バックオフ1回まで（Plan 01-02 critical_constraintsに採用済み）
   - What we know: UAなしcurlで200。robots/利用規約の機械可読な制限は未調査
   - What's unclear: 高頻度アクセス時の挙動
2. **LINE Developersコンソール側のWebhook URL設定** — RESOLVED: Phase 1成功条件3は署名付きcurlで機械検証可能なので、コンソール設定は人間向けTODOとしてSUMMARYに残す（夜間ブロッカーにしない。Plan 01-03 Task 3に反映済み）
   - What we know: デプロイ後 `https://cmsxvxtcdniqgvhxjqri.supabase.co/functions/v1/webhook` を設定する必要がある（手動）

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | migration/deploy/secrets | ✓ | 2.101.0（ログイン済み・dev/prod両ref確認済み） | — |
| Deno | Edge Functions開発・テスト | ✓ | 2.8.2 | — |
| Node.js / npm | npm view等の補助 | ✓ | v22.12.0 / 10.9.2 | — |
| Docker daemon | ローカルSupabaseスタック・既定deploy | ✗（クライアントのみ、デーモン未起動） | — | deploy: `--use-api` / DB: `--db-url` でリモートdev直結（両方検証済み） |
| psql | スキーマ検証SQL | 未確認 | — | `supabase db`系 or Deno+postgresドライバで代替可。計画では `command -v psql` を最初に確認 |
| git | コミット | ✓ | 2.38.0 | — |
| Twipla（外部サイト） | 実URL検証 | ✓ | 200応答・UTF-8・UAなし可（2026-06-12確認） | フィクスチャテストのみでも成功条件1の前半は満たせる |
| LINE API | 署名検証テスト・トークン発行 | ✓（ユーザーが発行テスト成功済み） | v3 | 署名検証は公式テストベクタでオフライン検証可能 |

**Missing dependencies with no fallback:** なし
**Missing dependencies with fallback:** Docker daemon（--use-api / --db-urlで完全回避可）、psql（supabase cli / Denoドライバで代替）

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Deno組み込みテストランナー（Deno 2.8.2、追加インストール不要） |
| Config file | supabase/functions/deno.json（Wave 0で作成） |
| Quick run command | `deno test --allow-read supabase/functions/tests/twipla_parser_test.ts` |
| Full suite command | `deno test --allow-read --allow-net supabase/functions/tests/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVENT-02 | フィクスチャHTMLから参加者名・Xアカウント抽出（参加者のみ、興味あり除外） | unit | `deno test --allow-read supabase/functions/tests/twipla_parser_test.ts` | ❌ Wave 0 |
| EVENT-02 | 実Twipla URLからの取得（fetch+parse、件数>0・形状検証） | integration | `deno test --allow-net=twipla.jp supabase/functions/tests/twipla_live_test.ts`（または scraper関数のcurl呼び出し） | ❌ Wave 0 |
| 成功条件2 | スキーマ再現 | smoke | `supabase db reset --db-url "$SUPABASE_DIRECT_CONNECTION_STRING" --yes` + pg_policies/information_schema検証SQL | ❌ Wave 0 |
| 成功条件3 | 正署名200・不正署名401 | unit + e2e | `deno test supabase/functions/tests/line_signature_test.ts`（公式テストベクタ） + デプロイ後curl | ❌ Wave 0 |
| 成功条件4 | 3関数デプロイ・呼び出し | smoke | `supabase functions list --project-ref "$DEV_PROJECT_REF"` + 各関数curl | ❌ Wave 0 |
| 成功条件5 | シークレット非コミット | unit | `git check-ignore env.dev env.prod`（両方ignoreされること）+ `git ls-files \| grep -E '^env\.(dev\|prod)$'` が空 | 即時実行可（.gitignore整備済み） |

### Sampling Rate
- **Per task commit:** `deno test --allow-read supabase/functions/tests/`（ネット不要のunitのみ）
- **Per wave merge:** full suite（--allow-net含む）+ デプロイ系smoke
- **Phase gate:** 成功条件1〜5の検証コマンドすべてgreen → `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `supabase/functions/deno.json` — imports固定（cheerio@1.2.0, zod@4.4.3, @supabase/supabase-js@2）
- [ ] `supabase/functions/tests/fixtures/twipla_event.html` — 実URLから取得し**匿名化**したフィクスチャ
- [ ] `supabase/functions/tests/twipla_parser_test.ts` — EVENT-02 unit
- [ ] `supabase/functions/tests/line_signature_test.ts` — 公式テストベクタ
- [ ] フレームワークインストール: 不要（Deno同梱）

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no（Phase 3でX OAuth） | — Phase 1はservice role/anon keyのみ |
| V3 Session Management | no | — |
| V4 Access Control | yes | RLS deny-by-default + service roleはEdge Functions内のみ。webhook以外はゲートウェイJWT検証維持 |
| V5 Input Validation | yes | zod 4.4.3でwebhookペイロード・scraperリクエストボディを検証。プロバイダーの `canHandle()` でURL hostname許可リスト（twipla.jpのみ）→ SSRF防止 |
| V6 Cryptography | yes | Web Crypto（crypto.subtle）でHMAC-SHA256。独自実装禁止。署名比較は定数時間比較 |
| V14 Config / Secrets | yes（最重要） | publicリポジトリ。env.dev/env.prodはgitignore済み（検証済み）。シークレットは `supabase secrets set` のみ。マイグレーションSQL・コード・コミットメッセージに鍵やprod refを書かない |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook偽装（なりすましLINEイベント） | Spoofing | x-line-signature HMAC-SHA256検証（raw body・定数時間比較）。検証前にビジネスロジックを実行しない |
| シークレット漏洩（public repo） | Information Disclosure | gitignore + コミット前 `git ls-files` 検査をタスクの検証ステップに含める。`secrets set` はenv変数展開で実行（シェル履歴に値を残さない） |
| SSRF（scraperに任意URL） | Tampering | プロバイダーごとのhostname許可リスト（canHandle）。リダイレクト追跡は同一ホストのみ or 無効化 |
| SQL injection | Tampering | supabase-jsのパラメタライズドAPIのみ使用。動的SQL組み立て禁止 |
| prod誤操作 | Elevation of Privilege | 全コマンドで `--project-ref "$DEV_PROJECT_REF"` / `--db-url`（env.dev）を明示。`hgojtooexbknqotzkkja` がリポジトリ内コード・スクリプトに現れないことをgrepで検証 |

## Sources

### Primary (HIGH confidence — 本セッションで実機検証)
- https://twipla.jp/events/731057 — 実HTML取得・構造解析（member_listセクション、n/s属性、UTF-8、UAなし200）
- Deno 2.8.2 + npm:cheerio@1.2.0 — パーサ実行・出力検証（attending/interested分類成功）
- LINE公式テストベクタによるWeb Crypto署名検証コードの実行検証
- Supabase CLI 2.101.0 `--help` 実出力 — functions deploy（--project-ref/--no-verify-jwt/--use-api/--prune）、db reset（--db-url/--linked/--local/--yes）、db push、migration new、secrets set、projects list（dev/prod ref実在確認）
- npm registry（npm view）+ slopcheck 0.6.1（npmエコシステム指定）— 4パッケージすべて[OK]、postinstallなし
- ローカル環境プローブ — deno/node/supabase/vercel/git有、Dockerデーモン無
- /Users/kugyu10/work/nomimas-bot/.gitignore, env.dev（変数名のみ）, .env.example 実読

### Secondary (HIGH-MEDIUM confidence — 公式ドキュメント)
- https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/ — 署名検証仕様・テストベクタ
- https://developers.line.biz/en/docs/basics/channel-access-token/ — ステートレストークン（15分・無制限・取り消し不可）
- https://supabase.com/docs/guides/functions/quickstart — 関数レイアウト・deploy・Docker不在時APIフォールバック
- https://supabase.com/docs/guides/functions/development-environment — _shared規約・deno.json
- https://supabase.com/docs/guides/functions/dependencies — npm:/jsr:/node: 指定子
- https://supabase.com/docs/guides/functions/function-configuration — [functions.<name>] verify_jwt/import_map/entrypoint
- https://supabase.com/docs/guides/functions/secrets — 自動注入env・secrets set --env-file

### Tertiary (LOW confidence)
- GitHub issues（supabase/cli#4059等）— config.tomlのverify_jwtが無視される報告 → デプロイ後curl検証＋`--no-verify-jwt`併用で対処

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 全パッケージをレジストリ＋slopcheckで検証、cheerioはDenoで実行確認
- Architecture: HIGH — Supabase公式ドキュメント＋CLI実出力に基づく。RLSポリシー詳細のみ裁量設計（[ASSUMED] A2）
- Pitfalls: HIGH — 最重要のセレクタ問題・Docker不在・verify_jwtはすべて実機/公式で確認済み

**Research date:** 2026-06-12
**Valid until:** 2026-07-12（安定領域。ただしTwiplaのHTML構造は外部要因で変わりうる — フィクスチャテストが構造変化の検知器になる）
