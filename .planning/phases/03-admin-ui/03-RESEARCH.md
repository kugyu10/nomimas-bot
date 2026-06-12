# Phase 3: 管理画面 - Research

**Researched:** 2026-06-12
**Domain:** Next.js 16 App Router + shadcn/ui (CLI 4.x) + @supabase/ssr 認証/RLS + Supabase Auth X(OAuth 2.0) プロバイダー
**Confidence:** HIGH（X プロバイダー有効化・モック認証・RLS スコープ・Edge Function ゲートウェイ通過・pooler JWT 切替ハーネス・create-next-app/shadcn 非対話スキャフォールドを本セッションで dev 実機検証済み。Next.js 16 / @supabase/ssr は公式ドキュメント確認）

## Summary

本フェーズ最大の不確実性 3 点を本リサーチですべて実機解決した。**(1) X OAuth プロバイダー**: Supabase は現在 OAuth 1.0a の `twitter` と OAuth 2.0 の `x` の 2 プロバイダーを持ち、公式は `x` を推奨（twitter は将来廃止）。env.dev の X_OAUTH_CLIENT_ID/SECRET は OAuth 2.0 形式なので `x` が正しい。Management API（PATCH /v1/projects/{ref}/config/auth）で dev プロジェクトの `external_x_enabled=true` を**本セッションで設定完了**（HTTP 200 確認、`uri_allow_list=http://localhost:3000/**` も設定済み）。`signInWithOAuth({provider:'x'})` は supabase-js 2.108.1 の型に存在することを確認。実ブラウザ往復は HUMAN-UAT へ。**(2) モック認証 + RLS**: email プロバイダーは dev で既に有効。admin.createUser(email_confirm:true) → signInWithPassword → PostgREST を user JWT で叩く全チェーンを実行し、oa_members 行なし=[] / owner 行追加後=dev-oa 可視 / UPDATE ポリシーなし=0行(エラーなし) を確認。**(3) ユーザー JWT は Edge Function ゲートウェイ(verify_jwt)を通過する**（scraper に user token で 400 "unsupported url" = 関数本体到達を確認）— サーバーアクションからの scraper 起動はユーザーセッショントークンで成立する。

ツールチェーン側の重要発見: **shadcn CLI 4.x は UI-SPEC 記載の `--style new-york --base-color neutral` フラグを廃止**している。現行は preset 方式で、`npx shadcn@latest init -y -b radix -p nova` が非対話で UI-SPEC 同等（baseColor: neutral / lucide / CSS variables / Radix）の components.json を生成することを /tmp の Next 16.2.9 実アプリで検証済み（`add sidebar table tabs dialog badge command` → `next build` green まで確認）。また **`form` コンポーネントは registry から実質消滅**しており `field`（field.tsx + label.tsx）が後継。Next.js 16 は middleware→proxy.ts 改名・async request APIs 完全必須化・Turbopack デフォルト化が主要変更で、公式 with-supabase example は既に proxy.ts + `getClaims()` + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 形に更新済み（コード全文取得済み — Code Examples 参照）。

セキュリティ上の最重要設計点: 初回ログイン時の owner 自動登録で **`user_metadata` を信用してはならない**（updateUser で本人が書き換え可能 = screen_name 偽装で他人の OA を乗っ取れる）。X の screen_name は `auth.identities.identity_data`（プロバイダー由来・ユーザー書換不可）から SECURITY DEFINER 関数で読む。service role をアプリで使わない Locked 制約とも整合する（DB 側関数であり service role ではない）。

**Primary recommendation:** admin/ に create-next-app 16.2.9（npm・非対話フラグ検証済み）+ shadcn `init -y -b radix -p nova`。認証は @supabase/ssr の公式 3 点セット（client/server/proxy.ts）+ `getClaims()`。RLS は既存 2 本目マイグレーション in-place 拡張（owner/co-owner の SELECT/INSERT/UPDATE + with check）+ SECURITY DEFINER 自動登録 RPC。テストは「`next build` 構造ゲート + vitest unit（node env）+ RLS 統合テスト（pooler JWT 切替 — 実証済みハーネス）」の 3 層で Playwright 不使用。

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### 認証・権限
- Supabase Auth の Twitter プロバイダー有効化を Management API で試行（X creds は env.dev に格納済み: X_OAUTH_CLIENT_ID/SECRET。コールバック https://cmsxvxtcdniqgvhxjqri.supabase.co/auth/v1/callback）。成功してもブラウザ往復が必要な実OAuth E2EはHUMAN-UATへ。API有効化が失敗してもブロッカーにせずモックで続行 → **本リサーチで有効化完了（external_x_enabled=true）**
- モック認証: 環境フラグ（例 NEXT_PUBLIC_AUTH_MOCK=1）で email+password テストユーザーログインにフォールバック。どちらも auth.uid() ベースで RLS は同一に機能 — プロバイダー差し替えのみで本番化できる構造（成功条件1）
- 初回ログイン時、X の screen_name（モック時はテスト用識別子）を oa_configs.admin_twitter_ids と照合して oa_members に自動登録（owner）。未登録ユーザーは「権限がありません」画面
- ルート保護: Next.js middleware + @supabase/ssr のサーバー側セッション検証

#### 画面構成
- アプリはモノリポ内 `admin/` ディレクトリ（Next.js 16 App Router + shadcn/ui + Tailwind CSS v4 + TypeScript 5.x + zod 4.x — Lockedスタック）
- ナビ: shadcn sidebar。ヘッダにOAセレクタ（切替で全画面のスコープが変わる）。ページ: イベント一覧 / イベント詳細（参加者・回答状況・紐付けのタブ）/ OA設定
- 紐付けUI: イベント詳細内で未紐付け参加者リスト × LINE友だち（line_users）コンボボックスの1対1割当・解除
- UI文言は日本語

#### データアクセス・RLS
- DBアクセスはユーザーJWTの supabase クライアント（@supabase/ssr）— RLSが実効。service role はサーバーアクションでも使わない（成功条件6の検証可能性のため）
- RLSポリシーを本実装に置き換え: oa_members(auth_user_id, oa_config_id, role) 経由で owner/co-owner が自OAの行のみ SELECT/INSERT/UPDATE。既存マイグレーション（20260611171038_enable_rls.sql）を in-place 拡張 + `db reset --linked --yes` 再適用（確立パターン）
- RLS自動テスト: pooler経由でJWTロールを切り替え、他者OAのデータが見えない・書けないことを検証（成功条件6）
- 参加者取得トリガー: サーバーアクションから scraper Edge Function を呼ぶ（ユーザーセッション必須化）

#### 検証範囲
- 機械検証: `next build` 成功 + ユニット/統合テスト + RLSテスト + モック認証での主要フロー（route handler / server action レベル）テスト。Playwrightフルブラウザは使わない（夜間安定性優先）
- 実X OAuthログイン体験・実ブラウザ操作感はHUMAN-UAT
- VercelデプロイはPhase 4（統合仕上げ）へ

### Claude's Discretion
コンポーネント分割、フォームバリデーション構成（zod）、テストランナー選択（Next.js側: vitest推奨だが裁量）、shadcnコンポーネント選定、サーバーアクション vs route handler の使い分けは裁量。Phase 1-2の確立パターン（dev only / public repo / in-place migration + db reset --linked / --use-api deploy）に従う。

### Deferred Ideas (OUT OF SCOPE)
- NOTIF-01（更新通知）/ OA-03（テンプレート）/ root横断閲覧 / Vercelデプロイ → Phase 4
- IN-05（oa_members.auth_user_id → auth.users FK）: 本フェーズのRLS実装で対応可能なら対応（裁量）
- DATA-01 / REMIND-01 / LINK-01 → v2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | 管理者はX(Twitter) OAuthで管理画面にログインできる | `external_x_enabled=true` を Management API で設定完了（実機）。`signInWithOAuth({provider:'x'})` の型確認済み。モック（email+password）の全チェーン（createUser→signInWithPassword→RLS実効）を実機検証。@supabase/ssr の client/server/proxy 3点セットの公式コード全文取得済み |
| EVENT-01 | 管理者はイベントを作成できる（複数URL・集合時刻/場所/参加費/店情報） | 既存 events/event_platform_urls スキーマ実読。INSERT/UPDATE RLSポリシー設計と with check パターン提示。shadcn field+react-hook-form+zod のフォーム構成。URL は zod regex `https://twipla.jp/events/[0-9]+` で正規形を強制（scraper の完全一致照合と整合 — canHandle が query/hash/port 拒否済みを実読確認） |
| ADMIN-01 | 回答状況（誰が回答済み・未回答）を一覧確認できる | PostgREST ネスト埋め込み 1 クエリ（participants × answers × line_users × event filter）+ oa_configs.questions JSONB を TS で合成する形を Code Examples に提示。RLS 下で user JWT のまま動作 |
| ADMIN-02 | LINEユーザーと参加者名を手動紐付けできる | participants.line_user_id (uuid FK→line_users.id) 既存列。UPDATE ポリシー + 紐付け整合性（同一OA内のみ）の with check 設計を提示。Phase 2 WR-05（webhook 側 OA 境界照合）は実装済みで、紐付け時の DB 側ガードを本フェーズで追加 |
| OA-01 | OAごとに定型文・質問内容・管理者Twitter IDを設定できる | oa_configs（greeting_message / questions JSONB / admin_twitter_id）既存列。questions の zod スキーマは Phase 2 の {id,text,options[]} 形と同一に固定。UPDATE ポリシー設計提示 |
| OA-02 | 複数OAを1管理画面で管理（owner/co-owner スコープ） | oa_members 経由 RLS の deny→allow を実機検証済み。OAセレクタは cookie ベース（server components から読める）を推奨。2つ目OA + 別 owner のテストフィクスチャ設計提示。root 横断は Phase 4 |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` は存在しない。Phase 1-2 から引き継ぐ確立規約:

- **prod接触禁止**: `hgojtooexbknqotzkkja` を一切使わない。dev = `cmsxvxtcdniqgvhxjqri` のみ。スクリプトは ref チェックで abort
- **publicリポジトリ**: シークレット非コミット。`admin/.env.local` は既存 .gitignore の `.env.*` パターンで被覆済み（実読確認）。クライアントに出るのは NEXT_PUBLIC_SUPABASE_URL と publishable/anon キーのみ
- **夜間無人実行**: 全コマンド非対話（create-next-app / shadcn の非対話フラグは本セッションで実証済み）
- **スキーマ変更**: 既存マイグレーション in-place 編集 + `supabase db reset --linked --yes` + setup-dev.ts + verify-cron.ts 再実行（cron は reset で消え migration が再作成、Vault は残存 — Phase 2 実証）

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| セッション維持・トークンリフレッシュ | Frontend Server (proxy.ts + @supabase/ssr) | Browser (cookie) | 公式パターン。getClaims() はサーバー側でのみ信用 |
| ログイン（X OAuth / モック） | Browser (signInWithOAuth / signInWithPassword) | API (Supabase Auth) | OAuth リダイレクトはブラウザ必須。PKCE 交換は /auth/callback route handler |
| owner 自動登録 | Database (SECURITY DEFINER RPC) | Frontend Server (初回ログイン時に呼ぶ) | RLS の鶏卵問題（未登録ユーザーは oa_configs を読めない）+ user_metadata 偽装対策で auth.identities を DB 側で照合 |
| アクセス制御（OAスコープ） | Database (RLS: oa_members chain) | — | service role 不使用が Locked。全データアクセスが user JWT |
| イベント CRUD / OA設定 / 紐付け | Frontend Server (server actions) | Database (RLS with check) | mutation は server action に集約。zod で再検証 |
| 参加者取得トリガー | Frontend Server (server action) | API (scraper Edge Fn) | user access token を Bearer で渡す（ゲートウェイ通過を実証済み） |
| 回答状況の合成 | Frontend Server (RSC + PostgREST nested select) | Database (RLS) | 1クエリで participants×answers×line_users。questions JSONB と TS で突合 |
| OA セレクタ状態 | Browser (UI) + cookie | Frontend Server (cookie 読取) | localStorage だけでは server components がスコープを知れない（UI-SPEC への設計補正） |
| フォームバリデーション | Browser (react-hook-form + zod) | Frontend Server (server action で zod 再検証) | 多層防御。クライアント検証は UX、サーバー検証が境界 |

## Standard Stack

### Core（admin/ — Node 領域。バージョンは 2026-06-12 npm registry 実確認）
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.2.9 | App Router フレームワーク | Locked スタック。Node 20.9+ 必須（手元 22.12 ✓）。Turbopack デフォルト [VERIFIED: npm registry + 公式 upgrade guide + /tmp 実ビルド] |
| react / react-dom | 19.2.x | UI ランタイム | Next 16 同梱（create-next-app が 19.2.4 を固定） [VERIFIED: 実スキャフォールド] |
| @supabase/ssr | 0.12.0 | cookie ベースの Supabase クライアント（browser/server/proxy） | 公式推奨。getAll/setAll cookie API [VERIFIED: npm registry + 公式 example 実コード] |
| @supabase/supabase-js | 2.108.1 | DB/Auth/Functions クライアント | deno.json と同一バージョンに揃える。provider 'x' 型あり [VERIFIED: unpkg 型定義実読] |
| tailwindcss | 4.x | CSS | Locked。create-next-app --tailwind が v4 を生成 [VERIFIED: 実スキャフォールド] |
| zod | 4.4.3 | フォーム/サーバーアクション検証 | Locked（Deno 側と同一バージョンで questions スキーマを共有可能） [VERIFIED: npm registry] |
| shadcn (CLI) | 4.11.0 | UI コンポーネント生成 | Locked。**4.x で CLI フラグ体系が変わった**（後述） [VERIFIED: 実行検証] |
| react-hook-form | 7.78.0 | フォーム状態管理 | shadcn field と併用の定番 [VERIFIED: npm registry + slopcheck OK] |
| @hookform/resolvers | 5.4.0 | zodResolver（zod 4 対応） | v5 系は standard-schema 経由で zod 4 サポート [VERIFIED: npm registry] [ASSUMED: zod 4.4.3 との組合せ動作 — 実装時に最初のフォームで確認] |
| lucide-react | 1.17.0 | アイコン | shadcn nova preset 同梱方針 [VERIFIED: npm registry] |

### Supporting（devDependencies）
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.8 | admin/ のテストランナー | unit（zod スキーマ・純関数）+ RLS/データ層統合テスト。node 環境のみで運用（jsdom 不要 — 後述のテスト戦略） [VERIFIED: npm registry] |
| typescript | 5.x | 型 | create-next-app 同梱 |

**コンポーネントテスト用（@testing-library/react + jsdom + @vitejs/plugin-react）は入れない** — 公式ドキュメントが「async Server Components は Vitest 非サポート」と明言しており、本アプリの画面はほぼ async RSC。コンポーネント描画の検証は `next build`（型+コンパイル）と HUMAN-UAT に委ねるのが CONTEXT の検証方針（route handler / server action レベル）と整合する。

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vitest(node env)のみ | vitest + jsdom + @testing-library/react | async RSC が描画できず、テスト可能なのは末端 client component だけ。夜間実行の費用対効果が低い。`next build` が構造ゲートを担う |
| npm | pnpm | pnpm は手元に未インストール。夜間無人実行に新規ツール導入リスクを足さない。npm 10.9.2 実証済み |
| shadcn field + react-hook-form | 素の controlled form + server action zod 検証のみ | UI-SPEC が「リアルタイム zod 検証 on blur」を要求するため RHF を採用。ただし複雑化したら後者へ簡素化可（裁量） |
| cookie で OA スコープ | URL パラメータ (/oa/[id]/events) | URL 方式はスコープが明示的だが UI-SPEC のルーティング（/events, /oa/settings）と乖離。cookie + localStorage 併用が UI-SPEC 準拠 |
| publishable キー (sb_publishable_) | legacy anon キー (JWT) | どちらも動作する。公式 example は NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY に移行済み。env.dev には両方あるため publishable を推奨（ローテーション独立性） |

**Installation（実証済みコマンド列）:**
```bash
# 1. スキャフォールド（リポジトリルートで。全フラグ /tmp で検証済み）
npx -y create-next-app@latest admin --ts --app --tailwind --eslint \
  --no-src-dir --import-alias "@/*" --use-npm --no-react-compiler \
  --disable-git --yes
# 注: --disable-git 必須（モノリポ内に .git を作らせない）。AGENTS.md/CLAUDE.md が
# admin/ に生成される（--no-agents-md で抑止可。残す場合は内容が当プロジェクト規約と
# 矛盾しないか確認）

# 2. shadcn init（4.x 流儀 — 非対話で baseColor:neutral / lucide / radix になることを実証済み)
cd admin && npx -y shadcn@latest init -y -b radix -p nova

# 3. コンポーネント追加（依存コンポーネントは自動解決される — 実証済み）
npx -y shadcn@latest add -y sidebar button table tabs dialog field input \
  textarea select command badge card separator avatar dropdown-menu alert \
  skeleton tooltip

# 4. アプリ依存
npm i @supabase/ssr@0.12.0 @supabase/supabase-js@2.108.1 zod@4.4.3 \
  react-hook-form @hookform/resolvers
npm i -D vitest
```

**Version verification:** 実施済み（2026-06-12）。`npm view <pkg> version` で全パッケージ確認。next/@supabase/ssr/shadcn/vitest は postinstall スクリプトなし・公式リポジトリ紐付きを確認。

## Package Legitimacy Audit

slopcheck 0.6.1 を `scan --pkg npm <name> --json`（check-only モード）で実行。

> ⚠️ **運用上の重大注意（次フェーズへの引き継ぎ）**: `slopcheck install <pkgs>` はエコシステム自動検出で **pip install を実行してしまう**（本セッションで誤って PyPI の同名パッケージ群がユーザー Python 3.9 環境にインストールされ、即時全アンインストール + numpy 2.0.2 復元で原状回復済み）。npm パッケージの監査は必ず `slopcheck scan <name> --pkg npm --json` を使うこと。これは奇しくも cross-ecosystem confusion（npm 名と同名の PyPI パッケージが実在する）の実証になった: PyPI には `next` 1.0.1 / `react` 4.3.0 / `tailwindcss` 0.0.1 / `zod` 0.8.0 という無関係パッケージが存在する。

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| next | npm | 2011〜 | 39.2M/wk | github.com/vercel/next.js | [OK] | Approved |
| react / react-dom | npm | — | 〜40M/wk級 | facebook/react | [OK] | Approved |
| @supabase/ssr | npm | 2023-09 | 4.6M/wk | github.com/supabase/ssr | [OK] | Approved |
| @supabase/supabase-js | npm | 2020-01 | 19.6M/wk | supabase/supabase-js | [OK] | Approved（Phase 1 監査済み） |
| shadcn | npm | 2024-07 | 5.3M/wk | github.com/shadcn-ui/ui | [OK] | Approved（npx 実行のみ・依存に入れない） |
| tailwindcss | npm | — | 大 | tailwindlabs/tailwindcss | [OK] | Approved |
| zod | npm | — | 大 | colinhacks/zod | [OK] | Approved（Phase 1 監査済み） |
| vitest | npm | 2021-12 | 64.6M/wk | github.com/vitest-dev/vitest | [SUS] | **Flagged**（後述） |
| react-hook-form | npm | 2019-03 | 51.7M/wk | react-hook-form/react-hook-form | [OK] | Approved |
| @hookform/resolvers | npm | 2020-05 | 43.1M/wk | 同上 | [OK] | Approved |
| lucide-react | npm | 2020-10 | 82.8M/wk | lucide-icons/lucide | [OK] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `vitest` [WARNING: slopcheck flagged as suspicious — verify before using.] — フラグ理由は「'vite' への TYPOSQUAT_RISK」ヒューリスティック。実態は vitest-dev/vitest 公式（2021-12 公開・64.6M DL/wk・postinstall なしを npm view で確認済み）であり既知の偽陽性と判断するが、プロトコルに従い planner は install タスクの直前に `npm view vitest repository.url` が `vitest-dev/vitest` であることを確認するステップを入れること。
**postinstall:** next / @supabase/ssr / shadcn / vitest すべて空 [VERIFIED: npm view scripts.postinstall]

## Architecture Patterns

### System Architecture Diagram

```
[Browser]
  │ ① 全リクエスト（cookie: sb-*-auth-token）
  ▼
[admin/proxy.ts (Next 16: 旧middleware。nodejs runtime)]
  │ updateSession(): @supabase/ssr でトークンリフレッシュ + getClaims()
  │ 未認証 → /login へ redirect（/login, /auth/* は除外）
  ▼
[App Router]
  ├─ /login (client) ── signInWithOAuth({provider:'x', redirectTo:/auth/callback})
  │                  └─ NEXT_PUBLIC_AUTH_MOCK=1 時: signInWithPassword フォーム
  ├─ /auth/callback (route handler) ── exchangeCodeForSession(code)
  │                  └─ 初回: rpc('register_owner_by_identity') → oa_members upsert
  │                     （SECURITY DEFINER が auth.identities の screen_name を照合）
  │                     0 OA なら /no-access へ
  ├─ /events, /events/[id], /oa/settings (async RSC)
  │     │ createServerClient(cookies) — user JWT → PostgREST（RLS 実効）
  │     │ OA スコープ: cookie 'nomimas_selected_oa_id' を読んで .eq('oa_config_id', …)
  │     ▼
  │  [Supabase PostgREST] ←─ RLS: oa_members(auth_user_id=auth.uid()) チェーン
  │
  └─ server actions ('use server')
        ├─ createEvent/updateEvent/saveOaSettings/linkParticipant/unlinkParticipant
        │     zod 再検証 → user JWT クライアントで insert/update → revalidatePath
        └─ triggerScrape(eventId)
              │ session.access_token を Bearer に
              ▼
        [Edge Fn: scraper (verify_jwt)] ← user JWT で通過することを実機確認済み
              └─ service role で participants upsert（既存実装のまま）

[supabase/migrations]
  ├─ 20260611171037_create_core_tables.sql … in-place: IN-05 FK 追加（裁量→推奨: 対応する）
  └─ 20260611171038_enable_rls.sql … in-place 拡張: INSERT/UPDATE ポリシー +
        register_owner_by_identity() SECURITY DEFINER RPC
[scripts/setup-dev.ts] … 拡張: モックユーザー2名 admin.createUser（冪等）+ oa_members 投入
[supabase/seed.sql] … 拡張: 2つ目の OA（oa-2）+ そのイベント/参加者（RLS テスト用）
```

### Recommended Project Structure（admin/ 新設分）
```
admin/
├── proxy.ts                      # Next 16 の middleware 後継（updateSession + ルート保護）
├── next.config.ts
├── vitest.config.mts             # node 環境のみ。projects で unit / integration 分離
├── .env.local                    # 非コミット（.gitignore の .env.* で被覆済み — 確認済）
│     NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY /
│     NEXT_PUBLIC_AUTH_MOCK
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # createBrowserClient（公式形そのまま）
│   │   ├── server.ts             # createServerClient + await cookies()
│   │   └── proxy.ts              # updateSession（公式形 + /login 分岐）
│   ├── schemas/                  # zod: eventForm / oaSettings / questions（Phase 2 と同形）
│   ├── data/                     # ★データ層関数（SupabaseClient を引数に取る純粋な関数群）
│   │   ├── events.ts             #   → vitest 統合テストの対象。server action から呼ぶ
│   │   ├── participants.ts       #   answerStatus 合成・紐付け
│   │   └── oa.ts
│   └── actions/                  # server actions（薄いオーケストレータ: 検証→data層→revalidate）
├── app/
│   ├── layout.tsx                # <html lang="ja">
│   ├── login/page.tsx
│   ├── auth/callback/route.ts    # exchangeCodeForSession + 初回登録 RPC
│   ├── no-access/page.tsx
│   ├── events/page.tsx
│   ├── events/[id]/page.tsx      # params は Promise（Next 16 — await 必須）
│   └── oa/settings/page.tsx
├── components/                   # ui/(shadcn生成) + 画面部品
└── tests/
    ├── unit/                     # zod スキーマ・純関数（ネット不要・決定的）
    └── integration/              # RLS / データ層（dev DB。RLS_TEST=1 ゲート）
```

### Pattern 1: @supabase/ssr 3点セット（公式 with-supabase example 実コード準拠）
**What:** browser client / server client / proxy(updateSession) の 3 ファイル。Next 16 では middleware.ts ではなく **proxy.ts**（export function proxy）。
**When to use:** 全ページ・全 server action のデータアクセス基盤。
**Example:** Code Examples 節に公式コード全文（取得済み・検証元: vercel/next.js canary examples/with-supabase）。
**重要規則（公式コメントより）:**
- `createServerClient` と `getClaims()` の間にコードを挟まない
- proxy は必ず supabaseResponse をそのまま返す（cookie 同期が壊れるとランダムログアウト）
- サーバーコードで `getSession()` を信用しない — `getClaims()` を使う（リフレッシュ保証）
- Fluid compute 対応: クライアントをグローバル変数に置かず毎リクエスト生成

### Pattern 2: X OAuth + モックの二経路ログイン（プロバイダー差し替えのみ）
**What:** `provider: 'x'`（OAuth 2.0 — dev で有効化済み）での signInWithOAuth と、NEXT_PUBLIC_AUTH_MOCK=1 での signInWithPassword。**どちらも結果は同じ Supabase セッション cookie** → 以降の RLS/サーバー処理は完全共通（実機で確認済み: password ログインの JWT で RLS が機能）。
```typescript
// /login（client component）
const supabase = createClient();
// X OAuth（本番経路）
await supabase.auth.signInWithOAuth({
  provider: "x",   // 'twitter' は OAuth 1.0a の旧プロバイダー — 使わない
  options: { redirectTo: `${location.origin}/auth/callback?next=${next}` },
});
// モック経路（NEXT_PUBLIC_AUTH_MOCK === "1" のときのみフォーム表示）
await supabase.auth.signInWithPassword({ email, password });
```
- OAuth コールバック: `/auth/callback/route.ts` で `supabase.auth.exchangeCodeForSession(code)`（@supabase/ssr の PKCE フロー）→ next へ redirect
- モックユーザーは scripts/setup-dev.ts が `auth.admin.createUser({email, password, email_confirm: true, user_metadata: {user_name: "dev_owner_x"}})` で冪等作成（admin API は service role — **スクリプト領域であり、アプリ不使用の Locked 制約とは別物**）
- dev の email プロバイダーは有効・signup 許可済みを Management API GET で確認済み。`uri_allow_list` に `http://localhost:3000/**` を設定済み（redirectTo 許可）

### Pattern 3: owner 自動登録は SECURITY DEFINER RPC + auth.identities（偽装不能な screen_name）
**What:** 初回ログイン時に oa_configs.admin_twitter_id と X screen_name を照合して oa_members(owner) を自動作成する処理は、**RLS の鶏卵問題**（未登録ユーザーは oa_configs を SELECT できない）と**なりすまし問題**を同時に解く必要がある。
**Why critical:** `user.user_metadata` は本人が `updateUser()` で自由に書き換えられる → user_metadata.user_name を信用すると「他人の screen_name を名乗って owner に自動登録」できてしまう（権限昇格）。一方 `auth.identities.identity_data` はプロバイダーが返した値で、ユーザーは書き換えられない。
```sql
-- 20260611171038_enable_rls.sql に in-place 追加
create or replace function public.register_owner_by_identity()
returns setof uuid  -- 登録された oa_config_id
language plpgsql security definer
set search_path = ''
as $$
declare v_screen_name text;
begin
  -- X (OAuth 2.0) provider の identity から screen_name を取得（ユーザー書換不可）
  select i.identity_data ->> 'user_name' into v_screen_name
  from auth.identities i
  where i.user_id = auth.uid() and i.provider in ('x', 'twitter')
  limit 1;
  -- モック経路: email provider のみのユーザーは user_metadata を使わず
  -- setup-dev.ts が事前に oa_members を投入する（この関数は 0 行を返すだけ）
  if v_screen_name is null then return; end if;

  return query
  insert into public.oa_members (oa_config_id, auth_user_id, role)
  select c.id, auth.uid(), 'owner'
  from public.oa_configs c
  where v_screen_name = any(string_to_array(coalesce(c.admin_twitter_id, ''), ','))
  on conflict (oa_config_id, auth_user_id) do nothing
  returning oa_config_id;
end $$;
revoke all on function public.register_owner_by_identity() from public, anon;
grant execute on function public.register_owner_by_identity() to authenticated;
```
[ASSUMED: provider 'x' の identity_data に screen_name が `user_name` キーで入る — HUMAN-UAT の実ログイン時に `select identity_data from auth.identities` で実形状を確認し、キー名（user_name / preferred_username）を補正するタスクを入れること。モック経路はこの仮定に依存しない]

### Pattern 4: RLS ポリシーの本実装（in-place 拡張）
**What:** 既存 7 テーブルの SELECT ポリシー（実読済み — join チェーンは正しい）を温存し、INSERT/UPDATE を追加。
**設計原則:**
- `using` には既存と同形の oa_members exists チェーン、`with check` も**同じ式**を使う（書込み先 OA の検証）
- `auth.uid()` は `(select auth.uid())` で包む（行ごと再評価を避ける initplan 最適化 — Supabase 公式 lint 推奨）。既存 SELECT ポリシーも同時に書き換えると一覧画面の性能が安定する
- DELETE ポリシーは作らない（Phase 3 の UI に削除操作なし — UI-SPEC 確認済み。deny-by-default 維持）
- 対象: oa_configs(UPDATE), events(INSERT/UPDATE), event_platform_urls(INSERT/UPDATE/DELETE※), participants(UPDATE — 紐付け), line_users(SELECT のみ既存) 。※イベント編集での URL 差し替えに DELETE が必要なら event_platform_urls だけ例外的に許可（裁量）
- **紐付け整合性ガード**: participants.line_user_id の UPDATE は「対象 line_users が同一 OA に属する」ことを with check で強制（Phase 2 WR-05 の根本対策）:
```sql
create policy participants_oa_member_update on public.participants
  for update to authenticated
  using (exists (select 1 from public.event_platform_urls epu
    join public.events e on e.id = epu.event_id
    join public.oa_members m on m.oa_config_id = e.oa_config_id
    where epu.id = participants.event_platform_url_id
      and m.auth_user_id = (select auth.uid())))
  with check (
    -- 行自体が自OAであること（using と同形）+ 紐付け先 line_user も同一OAであること
    exists (select 1 from public.event_platform_urls epu
      join public.events e on e.id = epu.event_id
      join public.oa_members m on m.oa_config_id = e.oa_config_id
      where epu.id = participants.event_platform_url_id
        and m.auth_user_id = (select auth.uid()))
    and (participants.line_user_id is null or exists (
      select 1 from public.line_users lu
      join public.event_platform_urls epu on epu.id = participants.event_platform_url_id
      join public.events e on e.id = epu.event_id
      where lu.id = participants.line_user_id and lu.oa_config_id = e.oa_config_id))
  );
```
**IN-05（FK）**: 対応を推奨。`oa_members.auth_user_id uuid not null references auth.users(id) on delete cascade` に in-place 変更。**ただし seed.sql に oa_members を入れてはならない**（seed 時点で auth.users が空の可能性）— oa_members 投入は setup-dev.ts（ユーザー作成後）に置く。

### Pattern 5: RLS テストハーネス（Locked: pooler 経由 JWT 切替 — 本セッション実証済み）
**What:** セッションプーラー接続でトランザクション内 `set local role authenticated` + `set_config('request.jwt.claims', …)` により任意ユーザーの RLS 文脈を再現する。
**実証結果（dev 実機）:** `auth.uid()` が偽 sub を返し、oa_configs が 0 行になることを確認（postgres ロールでは 1 行）。
```typescript
// admin/tests/integration/rls.helpers.ts（vitest, node env）— porsager postgres は
// Node でも同 API。Deno 実証コードと同一パターン
import postgres from "postgres";
export async function asUser<T>(sql: postgres.Sql, userId: string,
    fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return await sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claims',
      ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    return await fn(tx);
    // begin() が commit するが、テストでは末尾で raise / 専用 cleanup どちらでも可
  });
}
```
**補完（同じく実証済み）:** PostgREST + 実ユーザー JWT の経路も動作確認済み（signInWithPassword → Bearer → RLS 実効）。アプリが実際に通る経路はこちらなので、**スモーク 1 本**（user A で oa_configs が自 OA のみ、UPDATE が他 OA に効かない）を supabase-js でも置くとアプリ経路の退行検知になる。テスト本体（網羅マトリクス: A→OA2 の SELECT 0行 / INSERT 拒否 / UPDATE 0行）は pooler ハーネスで書く（Locked 決定準拠・ユーザー作成不要で速い）。
**実証済みの罠:** RLS で不可視の行への UPDATE は PostgREST では**エラーにならず 0 行**（`[]`）になる。「書けないこと」のアサーションは『例外が出る』ではなく『影響行数 0 / 対象行が変化していない』で書くこと（INSERT は 403 エラーになる — 非対称に注意）。

### Pattern 6: サーバーアクション → scraper Edge Function（user token — 実証済み）
**What:** `参加者を取得` ボタン → server action → scraper を **ユーザーのアクセストークン**で呼ぶ。ゲートウェイ verify_jwt はユーザー JWT を通すことを実機確認済み（400 "unsupported url" = 関数本体到達）。
```typescript
"use server";
export async function triggerScrape(eventId: string, url: string) {
  const supabase = await createClient();           // user セッションの server client
  const { data: { session } } = await supabase.auth.getSession(); // token 取り出しは getSession で可
  if (!session) return { error: "ログインが必要です" };
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/scraper`, {
    method: "POST",
    headers: { "Content-Type": "application/json",
               Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(30_000),
  });
  // scraper は WR-03 修正済み: 失敗時 500 を返す → そのままエラー表示に使える
  revalidatePath(`/events/${eventId}`);
  return await res.json();
}
```
注意: URL は登録済み event_platform_urls.url と**完全一致**で照合される（scraper 実装実読）。イベント作成フォームの zod regex（`^https://twipla\.jp/events/[0-9]+$`）が正規形を強制するので一致が保証される。canHandle は query/hash/port を拒否済み（twipla.ts 実読 — Phase 1 IN-08 は解消済みと判断）。

### Pattern 7: 回答状況の 1 クエリ合成（ADMIN-01）
**What:** PostgREST のネスト埋め込みで participants × answers × line_users をイベント単位に 1 往復で取得し、oa_configs.questions と TS で突合する。
```typescript
const { data: participants } = await supabase
  .from("participants")
  .select(`id, display_name, screen_name, status, confirm_status,
           line_user:line_users(display_name),
           answers(question_key, answer, answered_at),
           event_platform_urls!inner(event_id)`)
  .eq("event_platform_urls.event_id", eventId);
// oa_configs.questions（{id,text,options[]}[]）と question_key で突合して
// Q1..Qn 列 + 全体ステータス（UI-SPEC の badge contract）を合成
```
RLS 下で user JWT のまま動く（全テーブルに SELECT ポリシーあり）。回答済み判定は answers の行数 == questions.length、`—` は該当 question_key の行なし。

### Pattern 8: OA セレクタは cookie + localStorage の併用
**What:** UI-SPEC は localStorage `nomimas_selected_oa_id` を規定するが、**async RSC / server action はlocalStorage を読めない**。選択時に `document.cookie`（または server action 経由の `cookies().set`）にも書き、サーバー側は cookie → 自分の oa_members 一覧と突合（無効なら先頭 OA にフォールバック — UI-SPEC の規定どおり）→ 全クエリを `.eq("oa_config_id", selectedOa)` でスコープする。切替時は `router.refresh()`（UI-SPEC 準拠）。
**注意:** cookie の値はあくまで「ユーザーの希望」であり認可ではない — 認可は RLS が担うため、cookie を改竄しても他人の OA は見えない（多層防御として server 側で membership 突合もする）。

### Anti-Patterns to Avoid
- **`provider: 'twitter'` を使う**: OAuth 1.0a の旧プロバイダー。env.dev の creds は OAuth 2.0（Client ID/Secret）なので認証が成立しない。`'x'` 一択
- **`middleware.ts` で新規作成**: Next 16 では deprecated。proxy.ts + `export function proxy` で作る（@supabase/ssr 公式 example も proxy 形に更新済み）
- **server component / action で `getSession()` の user を信用**: 偽装可能。保護判定は `getClaims()`（access_token の取り出しだけは getSession で可）
- **user_metadata で owner 自動登録**: updateUser で偽装可能（Pattern 3）
- **service role キーを admin/ のどこかに置く**: Locked 違反 + NEXT_PUBLIC でなくてもバンドル/ログ混入リスク。admin/.env.local にも置かない（setup スクリプトはリポジトリルートの env.dev を読む）
- **「RLS で書けない」テストを例外前提で書く**: UPDATE は 0 行で静かに成功する（実証済み）。データ不変で検証する
- **seed.sql に oa_members / auth.users 依存行を入れる**: IN-05 FK 採用時に reset 順序で壊れる。ユーザー依存データは setup-dev.ts へ
- **admin/ で独自に git init / 別 lockfile 管理**: --disable-git で抑止。package-lock.json は admin/ 内で完結（ルート deno.json と干渉しない — 実構成確認済み）
- **next.config に webpack 設定を足す**: Turbopack デフォルトの Next 16 ではビルドが fail する

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| セッション cookie 管理・リフレッシュ | 自前 JWT cookie | @supabase/ssr (getAll/setAll + proxy updateSession) | 公式が「1行のミスでランダムログアウト」と警告する領域 |
| OAuth コード交換 | 自前 PKCE | supabase.auth.exchangeCodeForSession | @supabase/ssr が code_verifier cookie を管理 |
| 認可 | アプリ層 if 文 | RLS（oa_members チェーン） | Locked。テスト可能・経路漏れなし |
| UI コンポーネント | 自作 table/dialog/combobox | shadcn add（依存自動解決を実証済み） | UI-SPEC が shadcn 前提。a11y は Radix が担保 |
| フォーム検証 | 手書き validation | zod 4 + react-hook-form + zodResolver | Deno 側と同じ zod。questions スキーマ共有 |
| RLS テストの実行者切替 | テストごとにユーザー作成/ログイン | pooler `set local role` + `set_config(request.jwt.claims)` | 実証済み・高速・ユーザー管理不要（Locked ハーネス） |
| モックユーザー作成 | SQL で auth.users に直接 INSERT | auth.admin.createUser API | auth スキーマの内部整合（identities, encrypted_password）を GoTrue に任せる |

**Key insight:** このフェーズの価値は「RLS が唯一の認可境界」という構造そのもの。アプリ側に認可ロジックを書かないほど、成功条件 6 のテストがそのままセキュリティ証明になる。

## Common Pitfalls

### Pitfall 1: shadcn CLI 4.x のフラグ非互換（UI-SPEC のコマンドは失敗する）
**What goes wrong:** UI-SPEC 記載の `npx shadcn@latest init --style new-york --base-color neutral --css-variables yes` は 4.11.0 に存在しないフラグでエラー、または preset 対話プロンプトで夜間実行が永久ブロックする（実証: プロンプト「Which preset?」で停止）。
**How to avoid:** `npx -y shadcn@latest init -y -b radix -p nova`（実証済み — baseColor:neutral / lucide / cssVariables:true / style:"radix-nova" を生成）。`add` も `-y` 必須。`form` は registry に実体がなく **`field`** が後継（field.tsx + label.tsx 生成を実証）。
**Warning signs:** init が止まる / components.json が生成されない / `add form` が何も生成しない。

### Pitfall 2: Next 16 の async request APIs（params/searchParams/cookies は全部 Promise）
**What goes wrong:** Next 15 までの同期アクセス互換が完全削除。`params.id` は型エラー/実行時エラー。
**How to avoid:** `const { id } = await props.params;` / `const cookieStore = await cookies();`。`npx next typegen` の `PageProps<'/events/[id]'>` ヘルパーで型安全に。
**Warning signs:** ビルドエラー "params should be awaited"。

### Pitfall 3: proxy.ts の cookie 同期契約
**What goes wrong:** updateSession の supabaseResponse を作り直して cookie を引き継がない・getClaims() を呼ばない → ユーザーがランダムにログアウト（公式が明示警告）。
**How to avoid:** 公式コード（Code Examples）をそのまま使い、リダイレクト分岐だけ足す。matcher で静的アセットを除外。

### Pitfall 4: RLS の「書けない」が静かに成功する（実証済み）
**What goes wrong:** 他 OA の行への UPDATE は PostgREST 経由でエラーにならず 0 行更新・`[]` が返る。UI は「保存しました」を出してしまい、テストは「例外が出ない=書けた」と誤判定する。
**How to avoid:** server action は `.select()` 付き update で返却行を確認し、0 行なら「保存に失敗しました」を返す。RLS テストはデータ不変アサーション。INSERT は逆に 403 エラーになる（非対称）。

### Pitfall 5: 初回登録の鶏卵と権限昇格（Pattern 3 参照）
**What goes wrong:** (a) 未登録ユーザーは oa_configs を読めないので「クライアントで照合して自分で oa_members に INSERT」が構造的に不可能（INSERT ポリシーもない）。(b) 安易に user_metadata 照合の RPC を書くと screen_name 偽装で owner 乗っ取り。
**How to avoid:** SECURITY DEFINER RPC + auth.identities。oa_members への INSERT ポリシーは authenticated に**与えない**（登録経路は RPC のみ）。

### Pitfall 6: db reset --linked と auth.users / モックユーザー
**What goes wrong:** reset 後に auth.users が残るかは未検証 [ASSUMED: 消える前提で設計するのが安全]。モックユーザーや oa_members が消えるとログイン・RLS テストが全滅する。IN-05 FK があると oa_members は auth.users 消失と同時に消える（cascade）。
**How to avoid:** setup-dev.ts を「モックユーザー 2 名の冪等作成（getUserByEmail→なければ createUser）+ oa_members 投入」に拡張し、**reset 後に必ず実行**する手順を維持（Phase 2 の確立フローに 1 ステップ追加）。実行時に reset→setup→ログイン確認の順で検証するタスクを入れる。

### Pitfall 7: NEXT_PUBLIC_* はビルド時インライン
**What goes wrong:** `next build` 後に env を変えても反映されない。シークレットを NEXT_PUBLIC に入れるとバンドルに焼き込まれ public リポジトリ事故に直結。
**How to avoid:** NEXT_PUBLIC は URL + publishable キーの 2 つだけ（どちらも公開可能クラス）。NEXT_PUBLIC_AUTH_MOCK は dev ビルド専用フラグであることを README/SETUP に明記。git に admin/.env.local が入らないこと（既存 .gitignore で被覆確認済み）をフェーズ検証の grep に含める。

### Pitfall 8: vitest が async RSC を描画できない
**What goes wrong:** ページコンポーネントを @testing-library/react で render しようとして失敗、テストスイートが夜間に空転する。
**How to avoid:** 公式の明言（"Since async Server Components are new to the React ecosystem, Vitest currently does not support them"）に従い、コンポーネント描画テストを書かない。検証は lib/data + lib/schemas（node env）と `next build` に寄せる。

### Pitfall 9: OA セレクタを localStorage だけに置く（UI-SPEC の盲点）
**What goes wrong:** RSC/server action が選択 OA を知れず、スコープが常に先頭 OA に固定される or クライアントフェッチへの全面移行を強いられる。
**How to avoid:** Pattern 8（cookie 併用）。

### Pitfall 10: `slopcheck install` の pip フォールバック（本セッションで実害発生→復旧済み）
**What goes wrong:** プロジェクト検出に失敗すると pypi として同名パッケージを**実際にインストール**する。
**How to avoid:** 監査は `slopcheck scan <pkg> --pkg npm --json`。install サブコマンドは使わない。

### Pitfall 11: モック経路の screen_name 照合
**What goes wrong:** モックユーザーは auth.identities に email identity しか持たず、Pattern 3 の RPC では 0 件マッチ → 自動登録が機能せず /no-access に落ちる。
**How to avoid:** モック経路の oa_members 投入は setup-dev.ts が直接行う（owner: user1→oa-1, user2→oa-2）。「自動登録 RPC の単体検証」は RPC を直接 rpc() で呼び、identity がない場合に 0 行・冪等であることを確認する形にする（X identity の実形状確認は HUMAN-UAT）。

## Code Examples

### @supabase/ssr 3点セット（出典: vercel/next.js examples/with-supabase — 本セッションで実コード取得）
```typescript
// admin/lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

// admin/lib/supabase/server.ts — cookies() は await（Next 16）
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          } catch { /* Server Component から呼ばれた場合は proxy が同期するので無視可 */ }
        },
      },
    },
  );
}

// admin/proxy.ts（Next 16 — 旧 middleware.ts）
import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

// admin/lib/supabase/proxy.ts — updateSession（公式コメント含め原型維持 + /login 分岐）
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options));
        },
      },
    },
  );
  // この間にコードを挟まない（公式警告）
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  if (!user &&
      !request.nextUrl.pathname.startsWith("/login") &&
      !request.nextUrl.pathname.startsWith("/auth")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return supabaseResponse;  // 必ずこのオブジェクトを返す（cookie 同期契約）
}
```

### OAuth callback route handler
```typescript
// admin/app/auth/callback/route.ts
// Source: supabase.com/docs/guides/auth/server-side（PKCE フロー）
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/events";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await supabase.rpc("register_owner_by_identity"); // 初回 owner 自動登録（冪等）
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
```

### RLS テスト（pooler ハーネス — dev 実機で動作確認した形そのまま）
```typescript
// admin/tests/integration/rls.test.ts（vitest, environment: node, RLS_TEST=1 ゲート）
// 実証済み: set local role + set_config で auth.uid() が切り替わり RLS が実効する
import postgres from "postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const USER_A = "…setup-dev.ts が作る user1 の uuid を oa_members から引く…";
it("user A は OA-2 のイベントを SELECT できない", async () => {
  const rows = await sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claims',
      ${JSON.stringify({ sub: USER_A, role: "authenticated" })}, true)`;
    return await tx`select id from events where oa_config_id = ${OA2_ID}`;
  });
  expect(rows.length).toBe(0);
});
it("user A は OA-2 のイベントを UPDATE できない（0行 — エラーにはならない）", async () => {
  const updated = await sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claims',
      ${JSON.stringify({ sub: USER_A, role: "authenticated" })}, true)`;
    return await tx`update events set title = 'hacked'
      where oa_config_id = ${OA2_ID} returning id`;
  });
  expect(updated.length).toBe(0);  // 例外ではなく影響行数 0 で検証（実証済みの挙動）
});
```
接続: `aws-1-ap-northeast-1.pooler.supabase.com:5432` / `postgres.<ref>` / `prepare: false` / ref!==dev で abort（Phase 2 の sql.ts と同一規約。env.dev はリポジトリルートから読む）。

### vitest 設定（node env のみ・unit/integration 分離）
```typescript
// admin/vitest.config.mts
// Source: nextjs.org/docs/app/guides/testing/vitest を node-env 構成に単純化
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    environment: "node",
    include: process.env.RLS_TEST === "1"
      ? ["tests/**/*.test.ts"]          // full: unit + integration
      : ["tests/unit/**/*.test.ts"],    // quick: unit のみ（ネット不要・決定的）
    setupFiles: ["tests/setup.ts"],     // process.loadEnvFile('../env.dev') を RLS_TEST 時のみ
  },
});
```
Node 22.12 は `process.loadEnvFile` を持つため dotenv 不要。

### イベントフォームの zod スキーマ（EVENT-01）
```typescript
// admin/lib/schemas/event.ts — UI-SPEC のフィールド定義に準拠
import { z } from "zod";
export const platformUrlSchema = z.object({
  platform: z.literal("twipla"),     // v1 は twipla のみ（プロバイダー抽象は scraper 側）
  url: z.string().regex(/^https:\/\/twipla\.jp\/events\/[0-9]+$/,
    "Twipla のイベントURL（https://twipla.jp/events/数字）を入力してください"),
});
export const eventFormSchema = z.object({
  title: z.string().min(1, "イベント名は必須です"),
  event_date: z.string().min(1, "開催日は必須です"),   // Phase 2 RESEARCH: 必須化はPhase 3で
  meeting_at: z.string().optional(),                    // HH:mm — event_date と合成して timestamptz
  meeting_place: z.string().optional(),
  fee: z.string().optional(),
  venue_info: z.string().optional(),
  confirm_days_before: z.coerce.number().int().min(1).max(7).default(3),
  platform_urls: z.array(platformUrlSchema).min(1, "URLを1件以上登録してください"),
});
```
注: UI-SPEC の confirm_days_before select は「1/2/3/5/7日前, default 3」、DB default は 7（Locked D-09）。フォームは UI-SPEC に従い常に明示値を送る（DB default に依存しない）ので矛盾しない。

### seed.sql 拡張（RLS テスト用 2nd OA — CONTEXT specifics 採用）
```sql
-- 2つ目の OA + イベント + 参加者（固定UUID・冪等）。oa_members はここに入れない（IN-05 FK のため）
insert into public.oa_configs (id, name, questions) values
  ('00000000-0000-0000-0000-000000000011', 'dev-oa-2', '[…]'::jsonb)
  on conflict (id) do nothing;
-- events / event_platform_urls / participants も oa-2 配下に最小1セット
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| provider 'twitter' (OAuth 1.0a) | provider **'x'** (OAuth 2.0) | Supabase 公式が x 推奨・twitter 廃止予告 | env.dev の OAuth 2.0 creds がそのまま使える。`external_x_*` を設定（実施済み） |
| middleware.ts | **proxy.ts**（nodejs runtime） | Next.js 16 | @supabase/ssr 公式 example も proxy 形へ移行済み |
| 同期 params/cookies | 全 async（Promise） | Next.js 16 で互換完全削除 | 全ページで await 必須。`next typegen` 活用 |
| anon キー (JWT) | publishable キー (sb_publishable_) | Supabase 新 API キー体系 | NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が公式 example の標準名 |
| getUser() | **getClaims()** | @supabase/ssr 現行ドキュメント | サーバー側検証の推奨 API が変わった |
| shadcn `--style new-york --base-color` | `-b radix -p <preset>`（preset: Nova/Vega/Maia/Lyra/Mira/Luma/Sera/Rhea） | shadcn CLI 4.x | UI-SPEC のコマンドは要差し替え。`-p nova` が neutral+lucide を生成（実証） |
| shadcn `form`（react-hook-form ラッパー） | **`field`** コンポーネント | shadcn 4.x registry | form.tsx は生成されない。field.tsx + label.tsx + RHF 手組み |
| webpack ビルド | Turbopack デフォルト（dev/build とも） | Next.js 16 | webpack config 残存はビルド失敗。`next lint` も削除（ESLint CLI 直接） |

**Deprecated/outdated:**
- `next lint`: 削除済み。lint は `eslint .`（create-next-app が flat config を生成）
- `serverRuntimeConfig/publicRuntimeConfig`: 削除。env 直読みで代替
- UI-SPEC の shadcn init コマンドと `form` コンポーネント行: 本リサーチの実証結果で上書き

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | provider 'x' の auth.identities.identity_data に screen_name が `user_name` キーで入る | Pattern 3 | 中 — 自動登録が 0 件マッチ。HUMAN-UAT で実形状確認 → キー名修正のみ（モック経路は無影響）。RPC を `coalesce(identity_data->>'user_name', identity_data->>'preferred_username')` にしておけば更に低減 |
| A2 | `db reset --linked` で auth.users が消える（安全側仮定） | Pitfall 6 | 低 — setup-dev.ts を冪等にすれば残存/消失どちらでも成立。実行時 reset 直後に確認 |
| A3 | @hookform/resolvers 5.4 + zod 4.4.3 の zodResolver が動作 | Standard Stack | 低 — v5 系は zod 4 対応を明記。最初のフォーム実装タスクで即検知。不可なら RHF を外し controlled+zod parse に切替（UI-SPEC のリアルタイム検証は手動 onBlur で代替可） |
| A4 | X アプリ側のコールバック URL（https://cmsxvxtcdniqgvhxjqri.supabase.co/auth/v1/callback）が X developer portal に登録済み | AUTH-01 | 中 — 未登録だと実 OAuth が失敗するが、これは元々 HUMAN-UAT 領域（CONTEXT specifics に未確認と明記済み）。モック経路は無影響 |
| A5 | server action からの fetch で session.access_token が常に有効（proxy がリフレッシュ済み） | Pattern 6 | 低 — proxy.ts が全リクエストで updateSession するため action 到達時点で新鮮。万一 401 なら refreshSession() リトライを追加 |

## Open Questions

1. **X identity の screen_name キー名**（A1） — HUMAN-UAT の初回実ログイン後に `select provider, identity_data from auth.identities` で確認するタスクを Phase 末尾に置く。実装は両キー対応の coalesce で吸収しておく。
2. **イベント編集時の platform URL 削除**（event_platform_urls の DELETE） — 参加者が紐付いた URL の削除は cascade で participants ごと消える。v1 では「URL の追加のみ・削除は不可」とするのが安全（planner 判断。UI-SPEC は追加ボタンのみ規定しており削除 UI の記載なし → 追加のみで UI-SPEC 違反にならない）。
3. **meeting_at の入力形式** — DB は timestamptz、UI は「集合時刻 (time input)」。event_date + time を JST として合成（`new Date(\`${date}T${time}:00+09:00\`)`）。Phase 2 CR-01 で表示側は JST 整形済みなので、入力側も JST 固定で一貫させる（推奨、planner 確定でよい）。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | admin/ ビルド・テスト | ✓ | 22.12.0（Next 16 要件 20.9+ 充足） | — |
| npm | パッケージ管理 | ✓ | 10.9.2 | — |
| pnpm | — | ✗ | — | npm を使う（採用判断済み） |
| Deno | 既存テスト・スクリプト | ✓ | 2.8.2 | — |
| Supabase CLI（dev linked・keychain にアクセストークン） | db reset / Management API | ✓ | 2.101.0 | Management API は keychain の PAT（`security find-generic-password -s "Supabase CLI" -a access-token -w` → `go-keyring-base64:` を base64 デコード — 本セッション実証） |
| Supabase Management API | X プロバイダー設定 | ✓（PATCH 200 実証） | v1 | 設定は完了済みのため実行時の依存はなし |
| Supabase Auth email プロバイダー（dev） | モック認証 | ✓（有効を GET で確認） | — | — |
| Supabase Auth X プロバイダー（dev） | AUTH-01 | ✓ **本リサーチで有効化済み**（external_x_enabled=true, email_optional=true, uri_allow_list=localhost:3000/**） | — | モック認証（実証済み） |
| セッションプーラー | RLS テスト・SQL 実行 | ✓（本セッションでも成功） | aws-1-ap-northeast-1:5432 | — |
| slopcheck | パッケージ監査 | ✓（scan モードのみ使用） | 0.6.1 | npm view + レジストリメタデータ |
| Docker / psql | — | ✗ | — | 既存代替（--use-api / pooler）確立済み |

**Missing dependencies with no fallback:** なし
**Missing dependencies with fallback:** pnpm・Docker・psql（すべて代替確立済み）

**本リサーチが dev 環境に加えた変更（永続）:**
1. Auth config: `external_x_enabled=true` / `external_x_client_id・secret`（env.dev の値）/ `external_x_email_optional=true` / `uri_allow_list="http://localhost:3000/**"` — **プロジェクトレベル設定なので db reset の影響を受けない**
2. プローブ用ユーザー・oa_members 行は作成後に削除済み（残存なし）。oa_configs.greeting_message への UPDATE 試行は RLS により 0 行（変更なし）

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.8（admin/ — node 環境のみ）+ Deno 組込みランナー（supabase/ — 既存 82+ 件） |
| Config file | admin/vitest.config.mts（新規 — Wave 0）/ supabase/functions/deno.json（既存） |
| Quick run command | `cd admin && npx vitest run`（unit のみ — ネット不要・決定的） |
| Full suite command | `cd admin && RLS_TEST=1 npx vitest run && npm run build` + 既存 `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | モックログイン: signInWithPassword → JWT で PostgREST が RLS スコープを返す | integration | `RLS_TEST=1 npx vitest run tests/integration/auth.test.ts`（supabase-js で user1 ログイン→oa_configs=自OAのみ。リサーチで手動実証済みの自動化） | ❌ Wave 0 |
| AUTH-01 | 未認証アクセスが /login へリダイレクト | integration | `next build` 後 `next start` + curl -I /events → 307 Location:/login（route レベル検証）。または proxy の updateSession を NextRequest モックで unit | ❌ Wave 0 |
| AUTH-01 | register_owner_by_identity が冪等・identity なしで 0 行 | integration | rls.test.ts 内（rpc 直叩き） | ❌ Wave 0 |
| EVENT-01 | eventFormSchema: 必須/URL regex/不正値拒否 | unit | `npx vitest run tests/unit/schemas.test.ts` | ❌ Wave 0 |
| EVENT-01 | createEvent データ層: owner で INSERT 成功・他OAへの INSERT 拒否(403) | integration | rls.test.ts（pooler ハーネス + with check 検証） | ❌ Wave 0 |
| ADMIN-01 | 回答状況合成: answers×questions から Q列+全体ステータスを正しく合成 | unit | `npx vitest run tests/unit/answer-status.test.ts`（純関数 — フィクスチャ駆動） | ❌ Wave 0 |
| ADMIN-01 | ネストクエリが participants+answers+line_users を返す | integration | tests/integration/data.test.ts（user JWT supabase-js / seed フィクスチャ） | ❌ Wave 0 |
| ADMIN-02 | 紐付け UPDATE: 自OA内成功・他OA line_user への紐付けは with check で拒否 | integration | rls.test.ts | ❌ Wave 0 |
| OA-01 | oa_configs UPDATE: owner 成功・questions JSONB スキーマ検証 | unit+integration | schemas.test.ts + rls.test.ts | ❌ Wave 0 |
| OA-02 | user A(OA-1 owner) が OA-2 の全テーブル行を SELECT 0行 / INSERT 拒否 / UPDATE 0行（成功条件6マトリクス） | integration | `RLS_TEST=1 npx vitest run tests/integration/rls.test.ts` | ❌ Wave 0 |
| 成功条件2 | scraper トリガー: user token で 2xx/4xx（ゲートウェイ非401） | integration | tests/integration/scraper-trigger.test.ts（リサーチで手動実証済みの自動化。実スクレイプ回避は無効 URL の 400 で判定） | ❌ Wave 0 |
| 横断 | `next build` 成功（型 + 全ルートコンパイル） | smoke | `cd admin && npm run build` | ✓（スキャフォールド後すぐ実行可能） |
| 横断 | シークレット非コミット | smoke | `git ls-files admin \| grep -E '\.env'` 空 + `git grep -l service_role -- admin/` 空 | 即時実行可 |
| 既存回帰 | Phase 1-2 の Deno テスト green | regression | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` | ✓ 既存 |

### Sampling Rate
- **Per task commit:** `cd admin && npx vitest run`（unit）+ 型チェック相当は build を待たず `npx tsc --noEmit` でも可
- **Per wave merge:** `RLS_TEST=1 npx vitest run` + `npm run build` + Deno 既存スイート（スキーマ変更 wave では db reset → setup-dev.ts → 全テストの順）
- **Phase gate:** 成功条件 1-6 の全コマンド green → `/gsd:verify-work`。実 X OAuth・実ブラウザ操作は HUMAN-UAT

### Wave 0 Gaps
- [ ] `admin/` スキャフォールド一式（create-next-app + shadcn init/add — 検証済みコマンド使用）
- [ ] `admin/vitest.config.mts` + `admin/tests/setup.ts`（RLS_TEST 時のみ env.dev ロード + ref!==dev abort）
- [ ] `admin/tests/unit/schemas.test.ts` / `answer-status.test.ts`
- [ ] `admin/tests/integration/rls.test.ts` + `rls.helpers.ts`（pooler ハーネス — 実証済みコード流用）
- [ ] `admin/tests/integration/auth.test.ts` / `data.test.ts` / `scraper-trigger.test.ts`
- [ ] `scripts/setup-dev.ts` 拡張: モックユーザー2名（user_metadata.user_name 付き）+ oa_members 投入（冪等）
- [ ] `supabase/seed.sql` 拡張: dev-oa-2 + 配下フィクスチャ
- [ ] マイグレーション in-place: RLS INSERT/UPDATE ポリシー + register_owner_by_identity + IN-05 FK
- [ ] フレームワークインストール: `npm i -D vitest`（admin/ 内）

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth（X OAuth 2.0 + email/password モック）。パスワードはモック専用・setup スクリプト生成のランダム値を env 管理。getClaims() でサーバー側検証 |
| V3 Session Management | yes | @supabase/ssr の httpOnly cookie + proxy.ts リフレッシュ（自前実装禁止 — Don't Hand-Roll） |
| V4 Access Control | yes（中核） | RLS（oa_members チェーン）が唯一の認可境界。with check で書込み先 OA 検証 + 紐付け整合性。oa_members への直接 INSERT 経路を authenticated に与えない（登録は SECURITY DEFINER RPC のみ）。OA セレクタ cookie は希望値であり認可に使わない |
| V5 Input Validation | yes | zod 4 をクライアント（RHF）とサーバーアクションの両方で実行。Twipla URL は regex で正規形強制（SSRF 面も scraper の canHandle 許可リストと二重） |
| V6 Cryptography | no（直接の暗号実装なし） | PKCE/JWT は Supabase Auth に委譲 |
| V14 Config / Secrets | yes（最重要） | public リポジトリ。NEXT_PUBLIC は URL + publishable キーのみ。service role キーは admin/ ツリーに一切置かない（git grep を検証ゲート化）。X creds は Management API 設定済みで以後コードに不要。admin/.env.local は .gitignore 被覆確認済み |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| user_metadata 偽装による owner 自動登録の乗っ取り | Elevation of Privilege | auth.identities（プロバイダー由来・書換不可）を SECURITY DEFINER で照合（Pattern 3）。user_metadata を認可判定に使わない |
| OA セレクタ cookie 改竄での他 OA アクセス | Tampering | RLS が最終境界（cookie は表示スコープのみ）。実証: membership なしの JWT では SELECT 0 行 |
| 他 OA の line_user への紐付け（データ汚染） | Tampering | participants UPDATE の with check で line_users.oa_config_id 一致を強制（WR-05 の DB 側恒久対策） |
| server action の CSRF | Spoofing | Next.js server actions は同一オリジン検証内蔵 + Supabase cookie は SameSite=Lax [CITED: Next.js server actions security] |
| RLS 0行更新を「成功」と誤表示（だまし討ち UI） | Repudiation | update().select() の返却行数チェックを data 層の規約にする（Pitfall 4） |
| シークレットのバンドル混入 | Information Disclosure | NEXT_PUBLIC 2 変数限定 + ビルド成果物/コミットの grep ゲート |
| scraper の第三者起動 | DoS | ゲートウェイ verify_jwt は anon キーでも通る既知事項（Phase 2 WR-01 で message-sender は専用キー化済み）。scraper は読取り系で実害小だが、registered URL 完全一致 + canHandle 許可リストで影響限定。必要なら Phase 4 で x-cron-key 同等の対策（planner 判断） |
| prod 誤操作 | Elevation of Privilege | 全スクリプト/テストに ref==='cmsxvxtcdniqgvhxjqri' ガード（確立パターン） |

## Sources

### Primary (HIGH confidence — 本セッションで dev 実機検証)
- Management API: GET/PATCH /v1/projects/cmsxvxtcdniqgvhxjqri/config/auth — `external_x_*` キー存在確認・有効化 PATCH 200・GET で反映確認。PAT は macOS keychain（go-keyring-base64）から取得
- モック認証フルチェーン: admin createUser → signInWithPassword（token 815 bytes）→ PostgREST: membership 前 `[]` / owner 行後 `[{"name":"dev-oa"}]` / UPDATE ポリシーなし `[]`（0行・非エラー）→ プローブデータ削除
- Edge Function ゲートウェイ: scraper へ user JWT で POST → HTTP 400 `{"error":"unsupported url"}`（= verify_jwt 通過）
- pooler RLS ハーネス: `set local role authenticated` + `set_config('request.jwt.claims',…)` → auth.uid()=偽sub・oa_configs 0 行（postgres ロールでは 1 行）
- create-next-app 16.2.9 非対話スキャフォールド（/tmp）→ Next 16.2.9 / React 19.2.4 / Tailwind v4 生成確認
- shadcn 4.11.0: フラグなし init は preset プロンプトでブロック（実証）/ `init -y -b radix -p nova` で components.json（baseColor neutral・lucide）生成 / `add sidebar table tabs dialog badge command field` 成功・依存自動解決 / `add form` は何も生成しない / その後 `next build` green
- 既存コード実読: migrations 2本・seed.sql・scraper/index.ts（eq("url") 完全一致）・twipla.ts（port/query/hash 拒否）・.gitignore（.env.* / node_modules/ / .next/ 被覆）
- npm registry: 全パッケージの version / time.created / downloads / postinstall 空 / repository を実確認。slopcheck scan --pkg npm 全件（vitest のみ SUS 偽陽性）
- supabase-js 2.108.1 → @supabase/auth-js 2.108.1 型定義実読: `Provider = … | 'twitter' /** OAuth 1.0a */ | 'x' /** OAuth 2.0 */ | …`
- vercel/next.js canary examples/with-supabase: lib/supabase/{client,server,proxy}.ts + proxy.ts 実コード全文取得（NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / getClaims 形）

### Secondary (HIGH-MEDIUM confidence — 公式ドキュメント)
- https://nextjs.org/docs/app/guides/upgrading/version-16 — async APIs 完全必須化 / middleware→proxy（edge 非対応・nodejs runtime）/ Turbopack デフォルト / next lint 削除 / Node 20.9+ / revalidateTag 第2引数・updateTag/refresh 新 API / 画像系デフォルト変更
- https://nextjs.org/docs/app/api-reference/cli/create-next-app — 全フラグ（--yes/--disable-git/--no-react-compiler/--agents-md 等）
- https://nextjs.org/docs/app/guides/testing/vitest — セットアップ手順と「async Server Components は Vitest 非サポート」の明言
- https://supabase.com/docs/guides/auth/social-login/auth-twitter — 「X / Twitter (OAuth 2.0) プロバイダー推奨・OAuth 1.0a は将来廃止」「signInWithOAuth に provider 'x'」「Request email from users を ON」
- https://supabase.com/docs/guides/auth/server-side/nextjs — getClaims 推奨・getSession 不信用の警告・NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
- https://ui.shadcn.com/docs/cli, /docs/installation/next — CLI 4.x の init/add 体系（実行検証で補完）

### Tertiary (LOW confidence — 要実行時確認)
- provider 'x' の identity_data キー名（A1）/ db reset --linked の auth.users 残存性（A2）/ resolvers 5.4 × zod 4.4.3（A3）

## Metadata

**Confidence breakdown:**
- 認証（AUTH-01 経路）: HIGH — プロバイダー有効化・モックチェーン・RLS 実効を実機検証。実 X ブラウザ往復のみ HUMAN-UAT
- スキャフォールド/ツールチェーン: HIGH — /tmp で create-next-app→shadcn→build まで通した
- RLS 設計・テストハーネス: HIGH — deny/allow 両方向 + pooler 切替を実機検証。ポリシー SQL 案は既存ポリシー実読に基づく
- Next 16 / @supabase/ssr パターン: HIGH-MEDIUM — 公式ドキュメント + 公式 example 実コード。自プロジェクトでの結線は実装時検証
- フォーム（RHF+resolvers+zod4）: MEDIUM — バージョン互換は registry 確認のみ（A3）

**Research date:** 2026-06-12
**Valid until:** 2026-07-12（Next 16.x / shadcn 4.x は活発に更新中 — 特に shadcn CLI はマイナーでフラグが動く可能性があるため、実行時に `init --help` での再確認を推奨）
