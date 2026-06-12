# Phase 4: 通知 + 統合仕上げ - Research

**Researched:** 2026-06-12
**Domain:** イベント駆動LINE通知（Edge Functions 共有モジュール）+ RLS root権限拡張 + 質問テンプレート + 実Twipla E2E通し + Phase 3 UI修正
**Confidence:** HIGH（root_users + is_root() + OR拡張ポリシーを dev 実機でロールバック付きトランザクション検証済み。webhook/scraper/notifier 挿入点・RLSテストハーネス・E2Eパターンはすべて既存コード実読。新規パッケージなし）

## Summary

本フェーズの中核 3 機構をすべて検証・設計確定した。**(1) root権限**: `root_users` テーブル + `is_root()` SECURITY DEFINER + 既存 SELECT ポリシーへの `or (select public.is_root())` 追加を **dev 実機のトランザクション内で実行し（最後にロールバック・痕跡なし）**、root が全OA（dev-oa, dev-oa-2）を SELECT でき、非rootユーザーは従来どおり 0 行、root の UPDATE は 0 行（書込ポリシー不変＝閲覧専用）、root_users 自体は authenticated から不可視、をすべて確認した。重要な簡素化発見: **`listMyOas` のコード変更は不要** — RLS 拡張だけで root には全OAが返り、既存のOAセレクタ/全画面が自動的に横断管理UIになる（レイアウトの /no-access 判定も `myOas.length > 0` で自然に通過する）。**(2) 通知**: scraper の変化検出は「upsert 前に既存行を select して natural_key→status の Map を作り、upsert 後に差分計算」が唯一の現実解（supabase-js の upsert returning は新値のみで旧値が取れず、xmax は PostgREST から参照不可）。通知発火の機械検証は **`notification_logs` テーブル**を推奨 — 成功条件1「2日前以降→通知 / それより前→非通知」が既存E2Eと同じ SQL アサーションで書け、DRY_RUN stdout（関数ログ）の取得は Management API 経由で遅延・不安定なため夜間実行に不向き。**(3) E2E通し**: 既存 e2e_confirm_flow_test.ts のパターン（署名付き postback・SQL assert・teardown 復元）をそのまま拡張できるが、**seed イベントは current_date+3 で通知窓（2日）の外** — E2E セットアップで event_date を current_date+1 に変更し teardown で復元する必要がある（最重要 Pitfall）。

Phase 3 UI top-3 修正のファイル/行ターゲットは全件実コードで照合済み（events-page-client.tsx:38/41、event-form-dialog.tsx:337/374、linking-tab.tsx:283、app-sidebar.tsx:37、login/page.tsx:30/43、events-table.tsx のステータス列、oa-selector.tsx:33 の router.refresh）。1点だけ UI-SPEC に意味論上の注意: login/page.tsx:30 は **OAuth 起動失敗**であり「メールアドレスまたはパスワードが正しくありません」は誤文言になる（line 43 のパスワード失敗のみ locked 文言を適用、line 30 は汎用失敗文言を推奨）。

**Primary recommendation:** `_shared/notify/` に純関数（窓判定・差分計算）+ notifier（受信者解決→push→notification_logs 記録）を分離して置き、webhook（回答保存/完了後・reply 送信より後・try/catch で握る）と scraper（upsert 前 select 差分→1スクレイプ1サマリ通知）から呼ぶ。スキーマ変更は確立パターン（in-place migration 2本編集 + `db reset --linked --yes` + setup-dev.ts 拡張）。新規 npm/deno パッケージはゼロ。

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### 更新通知（NOTIF-01）
- イベント駆動: 更新の発生箇所から共有 notifier モジュール（`_shared/notify/` 等）を直接呼ぶ。新規 cron は作らない
  - webhook: 回答保存・全問完了時
  - scraper: 再スクレイプで既存参加者の status が変化した時（新規参加者の出現も通知対象）
- 2日前判定は送信時: `event_date - interval '2 days' <= 今日` かつイベント未終了。範囲外は送信せず件数ログ — 「2日前より前では通知されない」を機械検証
- 通知先: `oa_members.line_user_id text nullable` 列を追加（マイグレーション in-place）。未設定の owner/co-owner はスキップ+ログ。dev では seed/setup-dev で E2E 用の値を投入
- 送信は既存 `_shared/line/client.ts` の pushMessage（LINE_DRY_RUN 対応）。テキストのみ（参加者名・更新種別・イベント名）

#### 質問テンプレート（OA-03）
- `question_templates(id uuid, oa_config_id uuid fk, name text, questions jsonb, created_at)` — RLS は他テーブル同パターン（oa_members スコープ + root SELECT）
- UI: OA設定の質問エディタに「テンプレートとして保存」（名前入力Dialog）と「テンプレートを適用」（Select→確認→questionsへコピー）。自分がアクセスできる全OAのテンプレートが適用候補（「別イベント・別OAで再利用」の充足）
- 保存スキーマは oaSettingsSchema.questions と同一バリデーション

#### root権限（OA-02完成）
- `root_users(auth_user_id uuid pk references auth.users)` テーブル + `is_root()` SECURITY DEFINER 関数（search_path=''）
- 全テーブルの SELECT ポリシーに `or is_root()` を追加。書込ポリシーは変更しない（root は閲覧専用 — 安全側）
- `listMyOas` が root なら全OA返却 → 既存のOAセレクタ/全画面がそのまま横断管理UIになる
- RLSマトリクステストに root 軸を追加: root が全OAを SELECT でき、owner が他OAを見られない権限差を同一テストで対比検証。dev に root テストユーザーを setup-dev で投入

#### E2E通し（成功条件4）
- E2E_TEST=1 ゲートの自動テストで全鎖を通す: 実Twipla URL https://twipla.jp/events/731057 スクレイプ → 手動紐付け相当（管理画面のデータ層 or SQL）→ message-sender 配信（LINE_DRY_RUN=1）→ webhook へ署名付き postback×3 → answers 保存確認 → 通知発火確認（DRY_RUNログ or 関数戻り値）→ admin データ層（getParticipantsWithAnswers）で回答状況が見えることを確認
- 実LINE配信・実ブラウザはHUMAN-UAT（Phase 2/3 と同じ分離）

#### 統合仕上げ（Phase 3 UIレビュー優先対応）
- 03-UI-REVIEW.md の top-3 を修正: ①CTAの二重プラス除去 ②app/(app)/loading.tsx + Skeleton + OAセレクタ切替フィードバック ③ハードコード bg-zinc-900 → Button デフォルト/bg-primary 統一
- 軽微: ゴミ箱ボタンの aria-label、ログイン失敗文言（「ログインが必要です」→「メールアドレスまたはパスワードが正しくありません」）、イベント一覧の死にステータス列（回答状況サマリ表示 or 列削除 — 裁量）
- 残り11件の警告/軽微項目は対応しない（v2/任意）

### Claude's Discretion
通知文面、notifier の関数分割、テンプレートUIの細部、root テストユーザーの作り方、E2Eテストの配置（deno側/vitest側の分担）は裁量。確立パターン（dev only / in-place migration + db reset --linked / --use-api deploy / DRY_RUN / RLS_TEST・E2E_TEST ゲート）に従う。

### Deferred Ideas (OUT OF SCOPE)
- Vercel デプロイ: Vercel アカウント認証が必要なため夜間スコープ外 — 朝のTODO（HUMAN-UAT に記録）
- 03-UI-REVIEW の残り警告11件（タッチターゲット44px、スペーシング微調整等）— 任意/v2
- IN-08(prod email provider無効化)等の prod 系作業 — prod 禁止のため人間作業
- DATA-01 / REMIND-01 / LINK-01 — v2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NOTIF-01 | 開催2日前以降、メンバーの出欠・最終確認に更新があった際、owner/co-ownerにLINEで都度通知する | webhook 挿入点（result.answer 保存成功後 / reply 送信後）と scraper 挿入点（select-before-upsert 差分）を実コードで特定。窓判定は JST 純関数（get_confirm_targets と同じ `Asia/Tokyo` 流儀）。通知先は oa_members.line_user_id 列 + 既存 pushMessage（DRY_RUN対応）。機械検証は notification_logs テーブル（Pattern 4） |
| OA-03 | 定型質問のテンプレートを保存・再利用できる | question_templates テーブル + 同型 RLS。questions バリデーションは既存 `lib/schemas/oa.ts` の配列スキーマを export して再利用（superRefine の id 一意性込み）。UI 挿入点 question-list-editor.tsx を実読（controlled component — テンプレ一覧は RSC から prop 渡し）。クロスOA適用は RLS の oa_members チェーンが自動でスコープする（追加コード不要） |
| OA-02（root完成・成功条件3） | root の全OA・全データ横断閲覧 + owner/co-owner との権限差 | root_users + is_root() + 全 SELECT ポリシー OR 拡張を **dev 実機プローブで検証済み**（root=全OA可視 / 非root=0行不変 / root UPDATE=0行 / root_users 不可視）。listMyOas は無変更で root 対応。RLSマトリクスへの root 軸追加方法を提示 |
| 成功条件4（E2E通し） | 実Twipla URL での全鎖 E2E | e2e_confirm_flow_test.ts の実証済みパターン（署名生成・SQL assert・teardown）を拡張する e2e_full_chain_test.ts の設計を提示。seed event_date の窓外問題と対策、通知発火/非発火の対比検証設計を含む |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` は存在しない。Phase 1-3 から引き継ぐ確立規約（03-RESEARCH より、本フェーズも全適用）:

- **prod接触禁止**: `hgojtooexbknqotzkkja` を一切使わない。dev = `cmsxvxtcdniqgvhxjqri` のみ。スクリプト/テストは ref チェックで abort（connectDev / rls.helpers の二重ガード既存）
- **publicリポジトリ**: シークレット非コミット。env は `/Users/kugyu10/work/nomimas-bot/env.dev`（.gitignore 被覆済み）
- **夜間無人実行**: 全コマンド非対話
- **スキーマ変更**: 既存マイグレーション in-place 編集 + `supabase db reset --linked --yes` + setup-dev.ts + verify-cron.ts 再実行
- **デプロイ**: `supabase functions deploy <fn> --project-ref "$DEV_PROJECT_REF" --use-api --import-map supabase/functions/deno.json`（webhook のみ `--no-verify-jwt` 追加 — CLI 既知バグ対策の二重指定）
- **ログ規約**: トークン値・フル userId・参加者生データをログしない（T-01-08 / T-02-08 / T-02-14）

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 通知トリガー検出（回答/完了） | API (webhook Edge Fn) | — | 回答保存箇所が唯一の発生点。DB トリガーにしない（イベント駆動 Locked・LINE push は DB から打てない設計方針維持） |
| 通知トリガー検出（出欠変化/新規参加者） | API (scraper Edge Fn) | Database (既存行 select) | upsert 前後比較は scraper だけが両方の状態を知る。PostgREST に旧値返却機能がない |
| 窓判定（2日前以降・未終了） | API (_shared/notify 純関数) | — | 送信時判定が Locked。JST 日付計算は get_confirm_targets と同じ Asia/Tokyo 流儀を TS 側に写像 |
| 通知送信 | API (_shared/line/client.ts pushMessage) | — | 既存実装再利用（DRY_RUN・retry key・1..5件 assert 込み） |
| 通知の機械検証 | Database (notification_logs) | API (notifier が service role で INSERT) | E2E が SQL でアサート（既存 E2E と同一手法）。管理画面の将来可視化にも使える |
| root 認可 | Database (RLS: or (select is_root())) | — | アプリ層に root 分岐ゼロ。listMyOas 含め admin/ のコード変更不要（実機検証済み） |
| root 登録 | Database (root_users — 書込ポリシーなし) | scripts/setup-dev.ts (service role) | authenticated に INSERT 経路を与えない（権限昇格防止）。dev 投入は setup-dev |
| テンプレート CRUD | Frontend Server (server action + data層) | Database (RLS with check) | 既存 saveOaSettings と同型（zod 再検証→data層→revalidatePath） |
| テンプレート適用 | Browser (client-side state置換) | — | UI-SPEC Locked: 適用はクライアント置換のみ、永続化は既存「設定を保存」 |
| UI 修正（top-3 + 軽微） | Browser / Frontend Server | — | 該当ファイル・行は全件照合済み（Pattern 9） |

## Standard Stack

### Core — **新規パッケージなし**

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| （既存）zod | 4.4.3 | notifier 入力・テンプレートスキーマ検証 | deno.json / admin 両方に既存 [VERIFIED: deno.json 実読] |
| （既存）@supabase/supabase-js | 2.108.1 | Edge Fn / admin の DB アクセス | 既存 [VERIFIED: deno.json 実読] |
| （既存）postgres (porsager) | 3.4.9 | E2E / RLS テストの SQL assert | 既存 [VERIFIED: deno.json 実読] |
| （既存）shadcn コンポーネント | Phase 3 導入済み | Dialog/Select/AlertDialog/Skeleton/Tooltip | UI-SPEC: 「No new `npx shadcn add` commands required」を確認済み |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| notification_logs テーブル | DRY_RUN stdout（関数ログ）を Management API で取得 | ログ取得は反映遅延あり・API 形式が安定保証外・夜間 flaky。テーブルなら既存 E2E と同じ SQL assert で決定的 |
| notification_logs テーブル | webhook/scraper レスポンスに notified 件数を含める | scraper は可能だが webhook のレスポンスは LINE プラットフォーム向け契約（常に 200 "ok"）— テスト都合で内部状態を露出させる結合は避ける。ログテーブルは両入口を一元検証できる |
| select-before-upsert 差分 | upsert().select() の returning 比較 | PostgREST の returning は**新値のみ**。旧 status が取れず変化検出不能。xmax 等のシステム列も select 不可 [VERIFIED: scraper 実装 + PostgREST 仕様] |
| select-before-upsert 差分 | participants に DB トリガー + キューテーブル | 新規 cron/ポーリング禁止（Locked: イベント駆動）。push 送信は Edge Fn からしか打てない |

**Installation:** 不要（`npm install` / deno 依存追加ゼロ）。

## Package Legitimacy Audit

本フェーズで新規インストールするパッケージは **なし**。既存依存（zod 4.4.3 / supabase-js 2.108.1 / postgres 3.4.9 / shadcn 生成物）は Phase 1-3 で監査済み。

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none（新規パッケージなし）

## Architecture Patterns

### System Architecture Diagram

```
[LINE platform]──postback──▶[webhook Edge Fn]
                              │ ①署名検証→②answers upsert→③participants update
                              │ ④reply送信（ユーザー向け遅延を優先）
                              │ ⑤notifyConfirmUpdate() ← try/catchで握る（200契約不変）
                              ▼
                    [_shared/notify/notifier.ts]
                      │ a. participant→epu→event(title,event_date,oa_config_id) を1クエリ解決
                      │ b. isWithinNotifyWindow(event_date, todayJst()) — 範囲外: 件数ログのみ・return
                      │ c. oa_configs.line_channel_id === env LINE_CHANNEL_ID ガード（不一致OAはスキップ+ログ）
                      │ d. oa_members(oa_config_id) から line_user_id 非null の owner/co-owner を取得
                      │ e. pushMessage（LINE_DRY_RUN対応・宛先ごと）
                      │ f. notification_logs に1行 INSERT（kind/recipients/sent/failed/skipped）
                      ▼
              [LINE push → owner/co-owner]   [notification_logs] ◀── E2E が SQL assert

[admin/E2E]──POST {url}──▶[scraper Edge Fn]
                              │ ①epu lookup（events をネスト select に拡張）
                              │ ②既存行 select: natural_key→{status,display_name} Map
                              │ ③upsert（既存処理そのまま）
                              │ ④diffParticipants(既存Map, 新rows) → {new[], changed[]}
                              │ ⑤変化あり: notifyScrapeChanges()（1スクレイプ=1サマリ通知）
                              ▼
                    [_shared/notify/notifier.ts]（同上 b〜f）

[admin UI] ──(RLS: or (select is_root()))──▶ [PostgREST]
   root: listMyOas が全OAを返す（コード変更ゼロ — dev実機プローブ済み）
   templates: question_templates を oa_members チェーンでスコープ（全アクセス可能OA分が自動で返る）
```

### Recommended Project Structure（Phase 4 追加分）

```
supabase/functions/_shared/notify/
├── window.ts        # todayJst() + isWithinNotifyWindow() — 純関数（Denoユニットテスト対象）
├── diff.ts          # diffParticipants(existing, incoming) — 純関数（同上）
├── messages.ts      # 通知テキスト組み立て（参加者名・更新種別・イベント名）— 純関数
└── notifier.ts      # notifyConfirmUpdate / notifyScrapeChanges（クエリ+push+log INSERT）
supabase/functions/tests/
├── notify_window_test.ts / notify_diff_test.ts / notify_messages_test.ts   # unit
└── e2e_full_chain_test.ts                                                  # E2E_TEST=1
admin/lib/data/templates.ts        # listQuestionTemplates / insertQuestionTemplate
admin/lib/actions/templates.ts     # saveQuestionTemplate server action
admin/lib/schemas/template.ts      # name + questions（oa.ts の questionsSchema を再利用）
admin/components/oa/template-save-dialog.tsx / template-apply-select.tsx
admin/app/(app)/events/loading.tsx / events/[id]/loading.tsx / oa/settings/loading.tsx
```

### Pattern 1: 共有 notifier — 呼び出し側は fire-and-best-effort

**What:** notifier は構造化結果を返すが、webhook/scraper は**例外を絶対に外へ漏らさない**（webhook の 200 契約 / scraper の 200 応答を通知失敗で壊さない）。

```typescript
// _shared/notify/notifier.ts の公開シグネチャ（推奨）
export interface NotifyResult {
  kind: "answer" | "completion" | "scrape_changes";
  inWindow: boolean;        // false なら送信ゼロ・logsにも書かない（件数はconsoleログ）
  recipients: number;       // line_user_id 非null の owner/co-owner 数
  sent: number;
  failed: number;
  skippedNoLineId: number;  // line_user_id null でスキップした member 数
}

export async function notifyConfirmUpdate(
  supabase: SupabaseClient,
  getToken: () => Promise<string | null>,   // webhook の既存トークンキャッシュを再利用
  params: { participantId: string; kind: "answer" | "completion" },
): Promise<NotifyResult>;

export async function notifyScrapeChanges(
  supabase: SupabaseClient,
  params: {
    eventId: string; oaConfigId: string; eventTitle: string; eventDate: string | null;
    newParticipants: { displayName: string; status: string }[];
    statusChanges: { displayName: string; from: string; to: string }[];
  },
): Promise<NotifyResult>;
// scraper はトークンキャッシュを持たないため notifier 内で issueStatelessToken
// （LINE_CHANNEL_ID/SECRET は project 全 Edge Fn 共有 secrets — webhook/message-sender で実証済み）
```

**webhook 挿入点（webhook/index.ts handleEvent postback 分岐）:**
- 条件: `result.answer` が存在し **answers upsert が成功**したときのみ（`answerPersistFailureResult` に差し替わった場合は通知しない）
- kind: `result.reply === "completion" ? "completion" : "answer"` — **最終問は completion 1通のみ**（answer と completion の二重通知を避ける。「全問完了」は回答保存を包含する更新種別）
- 位置: `(c) reply送信` の **後**（ユーザーへの次質問提示を通知 push で遅延させない）。`reply === "none"` 経路（完了後再タップ等）は answer 保存なし→通知なしで自然に整合
- 全体を `try { await notifyConfirmUpdate(...) } catch (err) { console.error(...) }` で包む

**scraper 挿入点（scraper/index.ts ステップ(4)）:**
- epu lookup を `select("id, events(id, title, event_date, oa_config_id)")` に拡張（1クエリ追加なし）
- upsert 前に `from("participants").select("natural_key, status, display_name").eq("event_platform_url_id", epu.id)` — 10-100行スケールで安価
- upsert 成功後に diff → 変化があれば notifyScrapeChanges（**1スクレイプ実行 = 最大1通のサマリ**。参加者ごとに1通ずつ送ると初回スクレイプで数十通の通知爆発になる — Pitfall 2）
- レスポンスに `changes: { new: n, statusChanged: m }, notified: sent数` を追加すると E2E/管理画面の即時確認に使える（裁量）

### Pattern 2: scraper 変化検出 — select-before-upsert 差分（確定推奨）

**What:** 旧値が必要なのは scraper だけが知る「再スクレイプ」文脈。PostgREST/supabase-js では `upsert().select()` の returning は**更新後の新値のみ**で、INSERT/UPDATE の区別も旧 status も取れない。xmax トリックはシステム列のため select 不可。安定解は upsert 前の 1 select。

```typescript
// scraper/index.ts — upsert 前（rows 構築後）
const { data: existingRows, error: existErr } = await supabase
  .from("participants")
  .select("natural_key, status, display_name")
  .eq("event_platform_url_id", epu.id);
// existErr 時は差分検出を諦めて通知スキップ（upsert 自体は続行 — 取得保存を優先）

// _shared/notify/diff.ts — 純関数
export interface ExistingRow { natural_key: string; status: string; display_name: string }
export interface DiffResult {
  newParticipants: { displayName: string; status: string }[];
  statusChanges: { displayName: string; from: string; to: string }[];
}
export function diffParticipants(
  existing: ExistingRow[],
  incoming: { naturalKey: string; displayName: string; status: string }[],
): DiffResult {
  const before = new Map(existing.map((r) => [r.natural_key, r]));
  const result: DiffResult = { newParticipants: [], statusChanges: [] };
  for (const p of incoming) {
    const prev = before.get(p.naturalKey);
    if (!prev) {
      result.newParticipants.push({ displayName: p.displayName, status: p.status });
    } else if (prev.status !== p.status) {
      result.statusChanges.push({ displayName: p.displayName, from: prev.status, to: p.status });
    }
  }
  return result;
}
```

**初回スクレイプの扱い（裁量・推奨）:** `existing.length === 0` のとき（初回取り込み）は全員が「新規」になり通知ノイズ。**初回は通知スキップ（件数ログのみ）を推奨** — 「再スクレイプで…新規参加者の出現」という CONTEXT 文言とも整合する。E2E では2回目スクレイプ前に DB を意図的に変異させて検証する（Pattern 7）。

### Pattern 3: 2日前判定 — JST 純関数（送信時評価）

**What:** `event_date - interval '2 days' <= 今日 AND event_date >= 今日`。既存 get_confirm_targets が `(now() at time zone 'Asia/Tokyo')::date` を使う流儀を TS に写像する。

```typescript
// _shared/notify/window.ts
/** JST の今日を 'YYYY-MM-DD' で返す（en-CA ロケールは ISO 形式を出す） */
export function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}
/**
 * 通知窓: event_date - 2日 <= today（2日前以降）かつ event_date >= today（未終了=当日含む）
 * eventDate null は窓外扱い（通知しない）
 */
export function isWithinNotifyWindow(eventDate: string | null, today: string): boolean {
  if (!eventDate) return false;
  const diffDays = (Date.parse(eventDate) - Date.parse(today)) / 86_400_000;
  return diffDays >= 0 && diffDays <= 2;
}
```
- 純関数なので Deno ユニットテストで境界（diff=2 通知 / diff=3 非通知 / diff=0 当日通知 / diff=-1 終了後非通知 / null 非通知）を網羅できる — 成功条件1の根拠テスト
- `Date.parse("YYYY-MM-DD")` は UTC midnight 解釈で両辺同形 → 日数差は常に整数 [VERIFIED: ECMAScript date-only forms は UTC 解釈]

### Pattern 4: notification_logs — 通知発火の機械検証（推奨採用）

**What:** notifier が送信実行時（DRY_RUN 含む）に 1 行 INSERT。**窓外は行を書かず console に件数ログのみ** → 「2日前より前では通知されない」= 行が存在しないこと、で機械検証が成立する。

```sql
-- 20260611171037_create_core_tables.sql に in-place 追加
create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  oa_config_id uuid not null references public.oa_configs(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  kind text not null check (kind in ('answer', 'completion', 'scrape_changes')),
  recipients integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  skipped_no_line_id integer not null default 0,
  detail jsonb,           -- 例: {"new": 2, "statusChanged": 1}（PII は入れない — 名前不要・件数のみ）
  created_at timestamptz not null default now()
);
-- 20260611171038_enable_rls.sql に in-place 追加
alter table public.notification_logs enable row level security;
create policy notification_logs_oa_member_select
  on public.notification_logs for select to authenticated
  using (
    exists (select 1 from public.oa_members m
      where m.oa_config_id = notification_logs.oa_config_id
        and m.auth_user_id = (select auth.uid()))
    or (select public.is_root())
  );
-- 書込ポリシーなし（service role の Edge Functions のみ INSERT — answers/line_users と同方針）
```

**DRY_RUN stdout 案を退けた理由:** Edge Function の console ログ取得は Management API/analytics 経由で反映遅延・ページング・形式安定性の問題があり、夜間 E2E の決定性を損なう。レスポンスボディ案は webhook の「常に 200 ok」最小契約への内部状態露出になる。テーブルは既存 E2E の SQL assert パターン（e2e_confirm_flow_test.ts が全面採用）とそのまま揃う。

### Pattern 5: root_users + is_root() + OR 拡張 — **dev 実機プローブ済み（HIGH）**

**What:** 以下の SQL を dev のトランザクション内で実行し、全アサーション成功後にロールバック（痕跡ゼロを確認済み）。

```sql
-- 20260611171037_create_core_tables.sql に in-place 追加
create table public.root_users (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 20260611171038_enable_rls.sql に in-place 追加
alter table public.root_users enable row level security;
-- ポリシーなし = authenticated から不可視（プローブで確認: count 0）。登録経路は setup-dev（service role）のみ

create or replace function public.is_root()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.root_users r
    where r.auth_user_id = (select auth.uid())
  )
$$;
revoke all on function public.is_root() from public, anon;
grant execute on function public.is_root() to authenticated;

-- 既存 7 テーブル + question_templates + notification_logs の SELECT ポリシー末尾に追加:
--   or (select public.is_root())
-- 例（oa_configs — プローブで動作確認した形そのまま）:
--   using (
--     exists (select 1 from public.oa_members m
--       where m.oa_config_id = oa_configs.id and m.auth_user_id = (select auth.uid()))
--     or (select public.is_root())
--   )
```

**プローブ結果（2026-06-12 dev 実機・ロールバック済み）:**
- root 文脈（pooler ハーネス asUser 相当）: `oa_configs` → dev-oa, dev-oa-2 の **2行** / `events` → 2行（全OA横断 SELECT 成立）
- 非root 偽ユーザー: `oa_configs` → **0行**（既存 deny 挙動が OR 追加で壊れない = 既存 RLS マトリクステストは無修正で green のはず）
- root の UPDATE（oa_configs 両方）: **0行**（書込ポリシー不変 = SELECT-only が構造的に成立）
- root_users 自体: authenticated から **0行**（root の存在自体が漏れない）

**性能:** `(select public.is_root())` は initplan として**ステートメントごとに1回**評価される（Supabase RLS 最適化の定石 — 既存ポリシーの `(select auth.uid())` と同じ理屈）。is_root は STABLE + 引数なしなので確実にキャッシュされる。行ごとの再評価なし。

**アプリ側変更ゼロの確認:** `listMyOas` は `from("oa_configs").select("id, name")` の素朴な SELECT（実読）→ RLS が root に全行返す。`app/(app)/layout.tsx` の `/no-access` 判定は `myOas.length === 0`（実読）→ root は非空で通過。`register_owner_by_identity` は X identity なしの root に 0 行（冪等・無害）。**CONTEXT が拡張点と想定した listMyOas は実際には無変更でよい。**

### Pattern 6: question_templates — テーブル/RLS/データ層/UI

```sql
-- 20260611171037_create_core_tables.sql に in-place 追加
create table public.question_templates (
  id uuid primary key default gen_random_uuid(),
  oa_config_id uuid not null references public.oa_configs(id) on delete cascade,
  name text not null,
  questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
-- 20260611171038_enable_rls.sql に in-place 追加
alter table public.question_templates enable row level security;
create policy question_templates_oa_member_select
  on public.question_templates for select to authenticated
  using (
    exists (select 1 from public.oa_members m
      where m.oa_config_id = question_templates.oa_config_id
        and m.auth_user_id = (select auth.uid()))
    or (select public.is_root())
  );
create policy question_templates_oa_member_insert
  on public.question_templates for insert to authenticated
  with check (
    exists (select 1 from public.oa_members m
      where m.oa_config_id = question_templates.oa_config_id
        and m.auth_user_id = (select auth.uid()))
  );
-- UPDATE/DELETE ポリシーなし（v1 は保存+適用のみ。UI-SPEC に削除 UI なし — deny-by-default 維持）
```

- **クロスOA適用は RLS が自動充足**: `listQuestionTemplates(supabase)` = フィルタなし SELECT → oa_members チェーンで「自分がアクセスできる全OA」のテンプレートが返る。追加ロジック不要
- **スキーマ再利用**: `lib/schemas/oa.ts` の questions 配列スキーマ（max 20 / id 一意 superRefine / LINE 上限）は現状 `oaSettingsSchema` にインライン → **`questionsSchema` として export に切り出して**テンプレートスキーマ（`{ name: z.string().min(1).max(100), questions: questionsSchema }`）と oaSettingsSchema の両方から参照する（T-03-14 の同型性維持）
- **UI 結線**: question-list-editor.tsx は `{ value, onChange }` の controlled component（実読）。テンプレ一覧は OA設定ページ（RSC）が `listQuestionTemplates` で取得して prop 渡し。保存 server action は `saveOaSettings`（実読）と同型: zod 再検証 → data層 insert（error 時 403 はエラーになる — INSERT は UPDATE と違い silent-0-row にならない）→ `revalidatePath("/oa/settings")`
- 適用はクライアント置換のみ（UI-SPEC Locked — サーバー呼び出しなし、永続化は既存「設定を保存」）

### Pattern 7: E2E 全鎖テスト — e2e_full_chain_test.ts（Deno 側・E2E_TEST=1）

**配置の裁量確定（推奨）:** 全鎖は **Deno 側**（署名生成・SQL assert・x-cron-key 呼び出しのツールが e2e_confirm_flow_test.ts に全部ある）。「admin データ層で回答状況が見える」検証は **vitest 側の既存 data.test.ts 系**が担う（RLS_TEST=1 で同夜に実行 — 全鎖テストが書いた answers ではなく seed フィクスチャで検証する独立性を維持）。

**シナリオ設計:**
```
(a) setup:
    - seed event ...0002 の event_date を current_date + 1 に UPDATE（★窓内化 — Pitfall 1）
    - 窓外フィクスチャ: OA1 配下に event(current_date + 10) + epu(架空URL) +
      participant(line_user ...0004 に紐付け・confirm_status='sent'・index 0) を固定UUIDで作成
    - notification_logs の対象行を削除（再実行可能性）
    - seed participant ...0005 を pending/index0 にリセット + answers 削除（既存パターン）
(b) 実Twiplaスクレイプ: POST scraper {url: https://twipla.jp/events/731057}
    （Bearer anonKey）→ 200 / saved:true / count>0。seed epu ...0003 が同URL登録済み
(c) スクレイプ差分通知の検証（決定的化トリック）:
    - SQLで実スクレイプ行のうち1行の status を別値に UPDATE + 1行を DELETE
    - 再度 scraper POST → diff が statusChange 1 + new 1 を検出
    - notification_logs に kind='scrape_changes' 行（sent>=1, detail の件数一致）を SQL assert
(d) message-sender（x-cron-key + anonKey）→ ...0005 が 'sent'（既存パターン流用）
(e) 署名付き postback ×3（既存 makePostbackEvent/encodePostback 流用）:
    - Q1 後: answers 1行 + notification_logs kind='answer' 1行（sent>=1, skipped_no_line_id は
      setup-dev の投入内容に一致 — user2 を null のままにすれば 1）
    - Q3 後: completed + answers 3行 + kind='completion' 1行（最終問で 'answer' 行が増えないこと
      = 二重通知防止のassert）
(f) 窓外非通知（成功条件1の裏面）: 窓外フィクスチャ participant へ署名付き postback
    → answers は保存される（webhook は窓と無関係に保存）が、
      notification_logs に該当 event_id の行が 0 行であることを assert
(g) teardown: event_date を current_date + 3 に復元 / 窓外フィクスチャ削除（FK順）/
    participant リセット / notification_logs 掃除
```
- LINE_DRY_RUN=1 のため実送信なし。pushMessage は DRY_RUN で正常 return → notifier の `sent` がカウントされ logs に残る（= 機械検証が成立する設計根拠）
- 実 Twipla fetch を含むため LIVE 性あり（twipla.jp 到達不能なら fail — Environment Availability 参照）
- (c) の DB 変異トリックにより「実データが2回のスクレイプ間で変わらない」問題を回避し決定的にする

### Pattern 8: oa_members.line_user_id + setup-dev 拡張

```sql
-- 20260611171037_create_core_tables.sql の oa_members 定義に in-place 追加:
--   line_user_id text,   -- 通知先 LINE userId ("U..." 形式)。null = 通知スキップ+ログ
```
- **FK にしない理由（確定）**: line_users は「そのOAの友だち」テーブル。owner の LINE アカウントは自OAの友だちとは限らず、別OAの管理者が co-owner の場合は確実に行がない。素の "U..." テキストが正しいモデル
- **フォーマット check 制約は付けない**: dev の E2E 値は `U00000000000000000000000000000dev` のような非hex の架空値（seed の line_users と同流儀）— `^U[0-9a-f]{32}$` を強制すると dev が壊れる。null/非null のみで分岐
- setup-dev.ts 拡張（冪等）:
  1. `dev-root@nomimas.test` を ensureUser で作成 → `root_users` へ `on conflict do nothing` INSERT
  2. user1 の oa_members 行（dev-oa owner）に `line_user_id = 'U00000000000000000000000000ownr1'` を UPDATE（E2E 通知先）
  3. user2（dev-oa co-owner）は **null のまま残す** → skipped_no_line_id 経路が E2E で自然に検証できる
- prod の root/通知先投入は人間作業（prod 禁止 — Deferred と整合）

### Pattern 9: Phase 3 UI 修正 — 全ターゲット照合済み（2026-06-12 実コード）

| Fix | File:Line（実測） | 内容 |
|-----|------------------|------|
| top-3 #1 二重プラス | `admin/components/events/events-page-client.tsx:41`（`+ イベントを作成`）/ `event-form-dialog.tsx:337`（`+URL追加`） | 文字列リテラルの "+" 除去（Plus アイコンは維持） |
| top-3 #3 accent | `events-page-client.tsx:38` / `event-form-dialog.tsx:374`（`bg-zinc-900 text-white hover:bg-zinc-800`）/ `linking-tab.tsx:283`（`hover:bg-zinc-700`）→ className 除去で `variant="default"` に / `app-sidebar.tsx:37`（`border-zinc-900 text-zinc-900 font-medium`）→ `border-primary text-primary`（**`font-medium` も同時に除去** — UI-SPEC タイポ契約は 400/600 のみ） | |
| top-3 #2 loading | `admin/app/(app)/events/loading.tsx` / `events/[id]/loading.tsx` / `oa/settings/loading.tsx` 新規（ルートグループは `(app)` — 実構成確認済み）+ `oa-selector.tsx:33` の `router.refresh()` を `useTransition` で包む（現状 useTransition/Loader2 なし — 実測） | Skeleton は Phase 3 でインストール済み・未使用 |
| 5a aria-label | `event-form-dialog.tsx` の URL 行ゴミ箱（UI-SPEC: lines 315–324 近傍）に `aria-label="URLを削除"` — `question-list-editor.tsx:174-183` の既存パターン踏襲 | |
| 5b ログイン文言 | `admin/app/login/page.tsx:43`（signInWithPassword エラー）→ locked 文言。**注意: line 30 は signInWithOAuth の起動失敗**であり「メールアドレスまたはパスワード…」は意味的に誤り → line 30 は「ログインに失敗しました。もう一度お試しください」等の汎用文言を推奨（planner 確定。UI-SPEC の searchParams 条件マッピングは実装と異なり、実装は useState ローカルエラー — 実読） | |
| 5c ステータス列 | `admin/components/events/events-table.tsx`（全行 "—" の dead cell 実測確認）→ 列削除（UI-SPEC auto 確定） | |

### Anti-Patterns to Avoid
- **DB トリガー/cron で通知**: イベント駆動が Locked。pg_net で LINE API を直接叩く案は署名/トークン管理が DB に漏れる
- **webhook で通知失敗を 4xx/5xx に伝播**: 再配達ストームの再来。通知は常に try/catch + console.error
- **reply 前に通知 push**: ユーザーの次質問提示が owner 通知のネットワーク往復分遅延する。順序は DB→reply→notify
- **最終問で answer + completion の2通**: kind を排他にする（completion は回答保存を包含）
- **`or is_root()` を裸で書く**: `(select public.is_root())` で initplan 化（既存ポリシーの `(select auth.uid())` と同じ規約）
- **root_users に INSERT ポリシーを作る**: 権限昇格の単一点。経路は setup-dev（service role）のみ
- **scraper で参加者ごとに1通ずつ push**: 初回/大規模イベントで通知爆発。1スクレイプ=1サマリ
- **通知テキストや detail jsonb にフル userId を入れる**: T-02-08/T-02-14 準拠（参加者表示名・イベント名・件数のみ）
- **templates の questions を独自スキーマで検証**: oaSettingsSchema.questions と同一が Locked — 必ず共通 export を参照

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LINE push 送信 | 新規 fetch ラッパー | `_shared/line/client.ts` pushMessage | DRY_RUN・X-Line-Retry-Key・1..5件 assert・ログ規約が実装済み |
| トークン発行 | 自前 OAuth | `_shared/line/token.ts` issueStatelessToken | webhook は既存 getToken() キャッシュを notifier に注入 |
| JST 日付処理 | 手動 +9h 計算 | `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" })` | DST なしでも UTC 跨ぎ日付バグの定番回避。get_confirm_targets と同義 |
| RLS 実行者切替テスト | ユーザー毎ログイン | `admin/tests/integration/rls.helpers.ts` asUser | Phase 3 実証済みハーネス。root 軸も sub を root の uuid にするだけ |
| 署名付き webhook テスト | 新規実装 | e2e_confirm_flow_test.ts の generateSignature / sendSignedEvent / makePostbackEvent | 実証済み。full_chain へ流用（共有ヘルパー化は裁量） |
| questions 検証 | 新 zod スキーマ | `lib/schemas/oa.ts` の配列スキーマを export 切り出し | LINE 上限・id 一意性・bot 側同型性（T-03-14）が織り込み済み |
| モック/rootユーザー作成 | SQL 直 INSERT | setup-dev.ts の ensureUser（GoTrue admin API） | auth スキーマ整合を GoTrue に任せる（確立パターン） |

**Key insight:** 本フェーズは新技術ゼロで、価値は「既存の実証済み部品の正しい結線」にある。notifier の純関数部分（窓・差分・文面）を I/O から分離するほど、成功条件1の検証がユニットテストに落ち、E2E は結線確認だけになる。

## Common Pitfalls

### Pitfall 1: seed イベントは通知窓の外（E2E が黙って非通知になる）
**What goes wrong:** seed の dev-event は `event_date = current_date + 3`（confirm_days_before=7 の配信窓には入るが、**通知窓は2日**）。全鎖E2Eをそのまま流すと配信・回答は成功するのに通知だけ発火せず、「通知が実装されていない」のか「窓外」なのか区別できない。
**How to avoid:** E2E setup で `event_date = current_date + 1` に UPDATE、teardown で `current_date + 3` に復元（Pattern 7 (a)/(g)）。seed.sql 自体は変えない（message-sender E2E など既存テストの前提を維持）。
**Warning signs:** notification_logs が常に 0 行・E2E assert が通知だけ fail。

### Pitfall 2: 初回スクレイプ＝全員新規の通知爆発
**What goes wrong:** 実Twipla URL の初回取り込みで参加者全員が diff 上「新規」になり、参加者ごと通知だと数十 push、サマリでも無意味な1通が飛ぶ。
**How to avoid:** (1) 1スクレイプ=1サマリ通知に集約、(2) `existing.length === 0`（初回）は通知スキップ+件数ログ（Pattern 2 推奨）。E2E は2回目スクレイプ前の DB 変異で差分を作る（Pattern 7 (c)）。

### Pitfall 3: 通知の失敗・遅延が webhook の応答契約を壊す
**What goes wrong:** notifier 内の例外が handleEvent から漏れる→（個別 try/catch はあるが）通知のために reply が遅れる/失敗がログ嵐になる。
**How to avoid:** 呼び出しは常に reply 後 + try/catch。notifier 自体も宛先ごとの push 失敗を failed カウントに落として続行（message-sender の per-target 継続パターンと同型）。

### Pitfall 4: マルチOA とグローバル LINE チャネルの不一致
**What goes wrong:** push トークンは env の LINE_CHANNEL_ID/SECRET（プロジェクト単一チャネル）で発行される。dev-oa-2 のような `line_channel_id` が null/別値の OA のイベント更新で通知を打つと、別チャネルの友だちに届かない/無効宛先 push になる。
**How to avoid:** notifier で `oa_configs.line_channel_id === Deno.env.get("LINE_CHANNEL_ID")` を確認し、不一致はスキップ+ログ（Pattern 1 c）。v1 の単一チャネル運用では実害なし・マルチチャネルは v2 課題として既知化。

### Pitfall 5: oa_members.line_user_id に厳格フォーマット制約
**What goes wrong:** `^U[0-9a-f]{32}$` 等の check 制約を置くと、dev の架空値（`U...dev` — seed line_users と同流儀）が弾かれ setup-dev/E2E が壊れる。
**How to avoid:** nullable text のみ。null はスキップ+ログ（Locked どおり）。

### Pitfall 6: db reset 後の投入順序（root_users / line_user_id が消える）
**What goes wrong:** `db reset --linked` は public スキーマのデータを全消去 → root_users 行と oa_members.line_user_id 値も消える。setup-dev を回し忘れると root テスト・通知E2Eが全滅。
**How to avoid:** 確立フロー「reset → setup-dev.ts → verify-cron.ts」に setup-dev の拡張（root + line_user_id）を含め、reset を伴う wave の検証ステップで `select count(*) from root_users` 等を確認。auth.users は冪等 ensureUser で再作成/再取得（Phase 3 A2 と同じ扱い）。

### Pitfall 7: RLS マトリクスの「root が書ける」誤実装
**What goes wrong:** SELECT ポリシー編集時にうっかり UPDATE/INSERT ポリシーにも `or is_root()` を足す、または ALL ポリシー化する → root SELECT-only の Locked 違反。
**How to avoid:** 変更対象は **for select ポリシーのみ**（9本: 既存7 + question_templates + notification_logs）。プローブで root UPDATE=0行を確認済み — RLSテストに「root の UPDATE 0行 / INSERT 拒否」を必ず追加して退行検知。

### Pitfall 8: 最終問の二重通知（answer + completion）
**What goes wrong:** 「回答保存時に通知」+「完了時に通知」を独立に実装すると Q3 で2通飛ぶ。
**How to avoid:** kind を `result.reply === "completion" ? "completion" : "answer"` の排他にする（Pattern 1）。E2E (e) で「Q3 後に kind='answer' 行が増えない」を assert。

### Pitfall 9: login/page.tsx line 30 への locked 文言の機械適用
**What goes wrong:** UI-SPEC は「line 30 and 43」と書くが、line 30 は signInWithOAuth（X認証起動）失敗。「メールアドレスまたはパスワードが正しくありません」は誤誘導。
**How to avoid:** line 43（パスワード失敗）のみ locked 文言。line 30 は汎用失敗文言（裁量）。

### Pitfall 10: E2E の実Twipla行がDBに蓄積する
**What goes wrong:** 実スクレイプで取り込まれた実参加者行は teardown で消さない限り残る（Phase 1 から同様）。Pattern 7 (c) で変異させた行を放置すると再実行時の diff 前提が崩れる。
**How to avoid:** (c) で変異させた行は teardown で削除 or 再スクレイプが上書きすることを前提に「変異→再スクレイプ→assert」を同一テスト内で完結させる（再スクレイプ後は実態と一致した状態に戻っている）。notification_logs は setup/teardown 両方で対象 event の行を削除。

### Pitfall 11: 通知文面に質問内容・回答値を含めたくなる
**What goes wrong:** 「◯◯さんが『飲酒予定』に『飲む』と回答」のような文面は便利だが、Locked は「参加者名・更新種別・イベント名」のテキストのみ。回答値を push に載せるのはスコープ外+ログ規約のグレー。
**How to avoid:** 文面は3要素に限定（詳細は管理画面で見る導線が docs の思想）。例: `【dev-event】devテスト参加者さんが最終確認の回答を更新しました` / `…最終確認を完了しました` / `【dev-event】参加者情報が更新されました（新規1名・出欠変更1名）`。

## Code Examples

### notifier 本体の照会クエリ（webhook 経路 — 1クエリで event 解決）
```typescript
// Source: webhook/index.ts の既存ネスト select パターンを流用
const { data } = await supabase
  .from("participants")
  .select("id, display_name, event_platform_urls(events(id, title, event_date, oa_config_id))")
  .eq("id", participantId)
  .single();
const ev = data?.event_platform_urls?.events;
if (!ev) return { ...result, inWindow: false }; // 解決不能はログのみ

if (!isWithinNotifyWindow(ev.event_date, todayJst())) {
  console.log(`notify: out of window — skipped (kind=${kind}, event_id=${ev.id})`);
  return { ...result, inWindow: false }; // logs に行を書かない（Pattern 4 の検証規約）
}

// 受信者解決（oa_members は service role で読む — RLS 非適用）
const { data: members } = await supabase
  .from("oa_members")
  .select("line_user_id")
  .eq("oa_config_id", ev.oa_config_id);
const recipients = (members ?? []).filter((m) => m.line_user_id);
const skippedNoLineId = (members ?? []).length - recipients.length;
```

### webhook 挿入（handleEvent postback 分岐の末尾 — reply 送信処理の後）
```typescript
// (d) owner/co-owner 通知（NOTIF-01 — 失敗しても 200 契約・reply に影響させない）
if (result.answer && !answerPersistFailed) {
  try {
    const r = await notifyConfirmUpdate(supabase, getToken, {
      participantId,
      kind: result.reply === "completion" ? "completion" : "answer",
    });
    console.log(`webhook: notify kind=${r.kind} inWindow=${r.inWindow} sent=${r.sent} failed=${r.failed} skipped=${r.skippedNoLineId}`);
  } catch (err) {
    console.error(`webhook: notify failed participant_id=${participantId}: ${(err as Error).message}`);
  }
}
// 注: 既存コードでは upsert 失敗時に result = answerPersistFailureResult(current) に
// 差し替わるため、「保存成功」の判定はフラグ（answerPersistFailed）を導入して明示する
```

### RLS マトリクスへの root 軸追加（rls.test.ts — 既存スタイル準拠）
```typescript
// beforeAll: root の auth_user_id を root_users から動的取得（setup-dev が投入）
const rootRows = await sql`select auth_user_id from public.root_users limit 1`;
if (!rootRows[0]) throw new Error("root_users が空です。setup-dev.ts を実行してください。");
const rootId = rootRows[0].auth_user_id;

describe("root 横断閲覧（OA-02完成・成功条件3）", () => {
  it("root は両OAの oa_configs / events / participants / answers を SELECT できる", async () => {
    const oas = await asUser(sql, rootId, (tx) =>
      tx`select id from public.oa_configs where id in (${OA1_ID}, ${OA2_ID})`);
    expect(oas.length).toBe(2);   // ← owner(user1) は同クエリで 1 行（権限差の対比）
  });
  it("root は UPDATE できない（0行 — SELECT only）", async () => {
    const updated = await asUser(sql, rootId, (tx) =>
      tx`update public.oa_configs set name = 'root-hacked' where id = ${OA1_ID} returning id`);
    expect(updated.length).toBe(0);   // dev 実機プローブで確認済みの挙動
  });
  it("root は events を INSERT できない（with check 違反エラー）", async () => {
    await expect(asUser(sql, rootId, (tx) =>
      tx`insert into public.events (oa_config_id, title, event_date, confirm_days_before)
         values (${OA1_ID}, 'root-insert', current_date + 10, 7)`)).rejects.toThrow();
  });
  it("root_users 自体は authenticated から不可視（rootの存在が漏れない）", async () => {
    const rows = await asUser(sql, rootId, (tx) => tx`select * from public.root_users`);
    expect(rows.length).toBe(0);
  });
});
```

### テンプレート保存 server action（saveOaSettings と同型）
```typescript
"use server";
export async function saveQuestionTemplate(
  oaConfigId: string,
  rawInput: { name: string; questions: unknown },
): Promise<{ success: boolean; error?: string }> {
  const parsed = templateSchema.safeParse(rawInput);   // name + questionsSchema（oa.ts から export）
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "入力内容に誤りがあります" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("question_templates")
    .insert({ oa_config_id: oaConfigId, name: parsed.data.name, questions: parsed.data.questions })
    .select("id");   // INSERT は RLS 違反で 403 エラーになる（UPDATE と非対称 — Phase 3 実証）
  if (error) {
    return { success: false, error: "テンプレートの保存に失敗しました。もう一度お試しください" };
  }
  revalidatePath("/oa/settings");
  return { success: true };
}
```

### E2E: 通知発火/非発火の SQL assert（e2e_full_chain_test.ts 内）
```typescript
// 窓内: Q1 postback 後
const logsAfterQ1 = await sql`
  select kind, sent, skipped_no_line_id from public.notification_logs
  where participant_id = ${SEED_PARTICIPANT_ID} order by created_at`;
assertEquals(logsAfterQ1.length, 1, "Q1後 notification_logs が1行");
assertEquals(logsAfterQ1[0].kind, "answer");
assertEquals(Number(logsAfterQ1[0].sent) >= 1, true, "DRY_RUNでも sent>=1（送信実行の証跡）");

// 窓外: 窓外フィクスチャへの postback 後（answers は保存される・通知は出ない）
const outLogs = await sql`
  select count(*)::int as c from public.notification_logs where event_id = ${FX_OUT_EVENT_ID}`;
assertEquals(outLogs[0].c, 0, "2日前より前のイベントでは通知されない（成功条件1）");
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 通知なし（管理画面で能動確認のみ） | イベント駆動 push（webhook/scraper → notifier） | 本フェーズ | cron 追加なしでリアルタイム性確保 |
| listMyOas = oa_members 経由の自OAのみ | RLS の `or (select is_root())` で root に全行 | 本フェーズ | アプリ層コード変更ゼロで横断管理UI成立（プローブ済み） |
| RLS マトリクス = owner/co-owner 2軸 | + root 軸（SELECT可・書込不可の対比） | 本フェーズ | 成功条件3が既存ハーネスの sub 差し替えだけで書ける |

**Deprecated/outdated:** なし（新規 API/ライブラリ導入がないため）。UI-SPEC の login 文言マッピング（searchParams 前提）は実装（useState）と乖離 — Pattern 9 の注意書きで上書き。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | dev の Edge Function secrets に LINE_DRY_RUN=1 が現在も設定されている（Phase 2 で設定済みの引き継ぎ） | Pattern 7 / E2E | 中 — 未設定だと E2E が実 push を試み架空 userId で LINE API 4xx → failed カウントになり assert が崩れる。実行時に `supabase secrets list --project-ref $DEV_PROJECT_REF` で確認するタスクを Wave 0 に置く [ASSUMED] |
| A2 | 実Twipla イベント 731057 が公開中で参加者>0（Phase 1 で実証済みの継続） | Pattern 7 (b) | 中 — 閉鎖されていたら E2E (b) が fail。fallback: 別の公開イベントURLに seed/epu を差し替え（人間確認 or 実行時に fetch で事前チェック） [ASSUMED] |
| A3 | `Date.parse("YYYY-MM-DD")` の UTC 解釈による日数差計算が常に整数（date-only 同士） | Pattern 3 | 低 — ECMAScript 仕様で date-only forms は UTC midnight。ユニットテストの境界ケースで即検知 [VERIFIED: ECMA-262 Date Time String Format] |
| A4 | db reset --linked 後も auth.users が残る/消えるに関わらず setup-dev の冪等 ensureUser で復元できる（Phase 3 A2 の継続） | Pitfall 6 | 低 — 確立フローに setup-dev 再実行が含まれる |
| A5 | scraper への通知ロジック追加後も既存の twipla_live_test / scraper-trigger.test が green（変更は epu select 拡張 + upsert 後の追記のみで応答形式の既存フィールド不変） | Pattern 1 | 低 — レスポンスに changes フィールドを足す場合も既存キー（platform/count/saved）は不変に保つ |

## Open Questions

1. **scraper レスポンスに changes/notified を含めるか**
   - What we know: E2E は notification_logs で検証可能なので必須ではない。管理画面の「参加者を取得」結果表示に使える
   - Recommendation: 含める（既存キー不変・追加のみ）。planner 確定でよい
2. **初回スクレイプ（existing 0行）の通知スキップ**
   - What we know: CONTEXT は「再スクレイプで…変化」「新規参加者の出現も対象」— 初回全員通知は文言上グレー
   - Recommendation: 初回スキップ+件数ログ（Pitfall 2）。通知文面と同じく裁量領域
3. **login/page.tsx line 30（OAuth 起動失敗）の文言**
   - Recommendation: 「ログインに失敗しました。もう一度お試しください」（locked 文言は line 43 のみ）

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Deno | notifier 実装・Deno テスト・E2E | ✓ | 2.8.2（Phase 3 確認） | — |
| Node / npm / vitest | admin テスト・build | ✓ | 22.12 / 10.9.2 / 4.1.8（既存） | — |
| Supabase CLI（dev linked） | db reset / functions deploy --use-api / secrets list | ✓ | 2.101.0（Phase 3 確認） | — |
| セッションプーラー（dev） | RLS テスト・E2E SQL assert・本リサーチのプローブ | ✓ **本セッションで接続成功（プローブ実行）** | aws-1-ap-northeast-1:5432 | — |
| env.dev | 全スクリプト/テスト | ✓ 実在確認（LINE_CHANNEL_ID/SECRET・CRON_FUNCTION_KEY・SUPABASE_* キー名を確認。値は非読） | — | — |
| デプロイ済み Edge Fn（scraper/webhook/message-sender） | E2E 全鎖 | ✓（Phase 2/3 デプロイ済み。本フェーズで webhook/scraper を再デプロイ） | — | — |
| LINE_DRY_RUN=1（dev secrets） | E2E の非実送信 | [ASSUMED A1 — 実行時に secrets list で確認] | — | `supabase secrets set LINE_DRY_RUN=1` で再設定 |
| twipla.jp（実URL 731057） | E2E (b) 実スクレイプ | [ASSUMED A2 — LIVE 依存] | — | 別公開イベントURLへ差し替え（HUMAN判断） |
| Vercel | — | 対象外（Deferred — 朝のTODO） | — | — |

**Missing dependencies with no fallback:** なし
**Missing dependencies with fallback:** LINE_DRY_RUN（再設定1コマンド）/ twipla.jp 到達性（URL差し替え）

## Validation Architecture

> workflow.nyquist_validation は config に未設定（= 有効扱い）。

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Deno 組込みランナー（supabase/ — 既存82+件）+ vitest 4.1.8（admin/ — 既存94件・node env） |
| Config file | supabase/functions/deno.json（既存）/ admin/vitest.config.mts（既存 — include パターンは新規ファイルを自動被覆） |
| Quick run command | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/` + `cd admin && npx vitest run` |
| Full suite command | 上記 + `cd admin && RLS_TEST=1 npx vitest run && npm run build` + `set -a; source env.dev; set +a; E2E_TEST=1 LINE_DRY_RUN=1 deno test --allow-net --allow-read --allow-env supabase/functions/tests/e2e_full_chain_test.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NOTIF-01 | 窓判定: diff 0..2 → 通知 / 3以上・負・null → 非通知（境界網羅） | unit (Deno) | `deno test --config supabase/functions/deno.json --allow-read supabase/functions/tests/notify_window_test.ts` | ❌ Wave 0 |
| NOTIF-01 | 差分検出: 新規/変化/不変/初回（existing空）の分類 | unit (Deno) | `... tests/notify_diff_test.ts` | ❌ Wave 0 |
| NOTIF-01 | 通知文面: 3要素（参加者名/種別/イベント名）・userId 非含有 | unit (Deno) | `... tests/notify_messages_test.ts` | ❌ Wave 0 |
| NOTIF-01 | 窓内→ logs 行あり(sent>=1) / 窓外→ logs 0行（成功条件1の対比） | E2E (Deno) | `E2E_TEST=1 ... e2e_full_chain_test.ts`（Pattern 7 (e)(f)） | ❌ Wave 0 |
| NOTIF-01 | scraper 差分通知: 変異→再スクレイプ→ kind='scrape_changes' 行 | E2E (Deno) | 同上（Pattern 7 (c)） | ❌ Wave 0 |
| OA-03 | templateSchema: name必須/questions=oaSettingsSchema同一検証（id一意・LINE上限） | unit (vitest) | `cd admin && npx vitest run tests/unit/template-schema.test.ts` | ❌ Wave 0 |
| OA-03 | RLS: user1 が OA2 のテンプレ SELECT 0行 / OA2 への INSERT エラー / 自OA INSERT 成功 / root 全件 SELECT | integration | `RLS_TEST=1 npx vitest run tests/integration/rls.test.ts`（既存ファイルに追記） | ✓ 拡張 |
| OA-03 | data層: listQuestionTemplates が複数OA所属ユーザー(user2)に両OA分を返す（クロスOA適用候補） | integration | `RLS_TEST=1 npx vitest run tests/integration/data.test.ts`（追記） | ✓ 拡張 |
| OA-02 (root) | root 全テーブル SELECT 可 / owner は他OA 0行（同一テスト内対比） / root UPDATE 0行 / root INSERT エラー / root_users 不可視 | integration | `RLS_TEST=1 npx vitest run tests/integration/rls.test.ts`（root 軸追記 — Code Examples 参照） | ✓ 拡張 |
| 成功条件4 | 全鎖: 実スクレイプ→紐付け→sender→postback×3→answers→通知→（admin data層は data.test.ts が担保） | E2E | `E2E_TEST=1 ... e2e_full_chain_test.ts` | ❌ Wave 0 |
| UI fixes | ビルド構造ゲート + loading.tsx 3ファイル存在 + 文言 grep（"+ イベント" 非存在 / bg-zinc-900 非存在） | smoke | `cd admin && npm run build` + `grep -r "bg-zinc-900" components/ \| wc -l` = 0 + `ls app/(app)/events/loading.tsx ...` | ❌ Wave 0（grep は即時可） |
| 既存回帰 | Phase 1-3 全テスト green（RLS OR 拡張で既存マトリクス不変 — プローブで非root 0行を確認済み） | regression | Quick/Full 両コマンド | ✓ 既存 |

### Sampling Rate
- **Per task commit:** Deno unit（該当 _shared/notify テスト）+ `cd admin && npx vitest run`（unit）+ `npx tsc --noEmit`
- **Per wave merge:** Full suite（スキーマ変更 wave は `db reset --linked --yes` → `setup-dev.ts` → `verify-cron.ts` → Full の順。Edge Fn 変更 wave は deploy → E2E）
- **Phase gate:** 成功条件 1-4 の全コマンド green → `/gsd:verify-work`。実LINE受信・実ブラウザは HUMAN-UAT（Vercel は朝のTODO）

### Wave 0 Gaps
- [ ] `supabase/functions/_shared/notify/{window,diff,messages,notifier}.ts` + 対応 unit テスト3本
- [ ] マイグレーション in-place 編集: core_tables（oa_members.line_user_id 列 / root_users / question_templates / notification_logs）+ enable_rls（is_root() / SELECT 9本の OR 拡張 / templates・logs ポリシー）
- [ ] `scripts/setup-dev.ts` 拡張: dev-root@nomimas.test 作成 + root_users 投入 + user1 の oa_members.line_user_id 投入（user2 は null 維持）
- [ ] `supabase/functions/tests/e2e_full_chain_test.ts`（署名ヘルパーは既存から流用）
- [ ] `admin/lib/schemas/oa.ts` の questions 配列スキーマ export 切り出し + `template.ts`
- [ ] `admin/{lib/data,lib/actions,components/oa}` テンプレート一式 + rls/data テスト追記
- [ ] `admin/app/(app)/{events,events/[id],oa/settings}/loading.tsx`
- [ ] 実行時確認: `supabase secrets list` で LINE_DRY_RUN=1（A1）

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes（変更なし） | 既存 Supabase Auth。root も通常ログイン + root_users 照合のみ |
| V3 Session Management | yes（変更なし） | 既存 @supabase/ssr |
| V4 Access Control | yes（中核） | root = SELECT ポリシーのみ OR 拡張（書込不変 — プローブ実証）。root_users へ INSERT 経路を authenticated に与えない（昇格防止）。root_users 自体不可視（root の存在秘匿）。notification_logs/question_templates も oa_members チェーン + root SELECT |
| V5 Input Validation | yes | テンプレートは questionsSchema（id一意・LINE上限）をサーバー再検証。notifier 入力は内部呼び出しのみ（外部入力なし） |
| V6 Cryptography | no | 署名検証は既存 _shared/line/signature.ts（変更なし） |
| V14 Config / Secrets | yes | 新規シークレットなし。oa_members.line_user_id は PII（LINE userId）— ログには出さない（push 宛先は client.ts が末尾6字マスク済み）。public repo に値を書かない（setup-dev が env から投入） |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| root 自己登録による権限昇格 | Elevation of Privilege | root_users に INSERT/UPDATE ポリシーなし（deny-by-default）。投入は service role スクリプトのみ。RLSテストで「authenticated が root_users に INSERT できない」を追加可（裁量） |
| is_root() の search_path ハイジャック | Elevation of Privilege | `set search_path = ''` + スキーマ修飾（register_owner_by_identity と同規約） |
| 通知経由の情報漏えい（userId/回答値） | Information Disclosure | 文面は参加者表示名・更新種別・イベント名のみ（Locked）。logs の detail は件数のみ。console は既存マスク規約 |
| 通知 push の悪用（第三者がスクレイプ起動→owner へ通知スパム） | DoS | scraper は anon キーで起動可能（既知 — Phase 3 で計上済み）。通知は registered URL 完全一致 + 差分発生時のみ + 1スクレイプ1通に律速。必要なら scraper にも x-cron-key 同等を v2 で（planner 判断） |
| 通知失敗による webhook 再配達ストーム | DoS | notify は try/catch で握り常に 200（Pitfall 3） |
| root の閲覧ログ不在（説明責任） | Repudiation | v1 スコープ外（root は信頼された運用者前提）。notification_logs は通知の監査証跡を兼ねる |
| RLS OR 拡張の退行（既存 deny の破壊） | Tampering | プローブで非root 0行を確認済み + 既存マトリクステスト無修正 green を回帰ゲートに |

## Sources

### Primary (HIGH confidence — 本セッションで dev 実機検証 / 実コード読解)
- **dev 実機プローブ（ロールバック付き）**: root_users + is_root() + `alter policy ... or (select public.is_root())` → root=全OA SELECT / 非root=0行 / root UPDATE=0行 / root_users 不可視 / ロールバック後の痕跡ゼロ（to_regclass null・pg_proc 0件）を全確認
- 実コード読解: `supabase/functions/webhook/index.ts`（回答保存/完了/reply 順序・getToken キャッシュ・isRedelivery）/ `scraper/index.ts`（natural_key upsert・epu lookup）/ `_shared/line/client.ts`（pushMessage DRY_RUN）/ `message-sender/index.ts`（per-target 継続・JST 窓の先行例）/ migrations 3本（ポリシー全文・get_confirm_targets の JST 流儀）/ `seed.sql`（event_date=current_date+3・架空 LINE userId 形式）/ `setup-dev.ts`（ensureUser 冪等パターン）/ `admin/lib/data/oa.ts`・`app/(app)/layout.tsx`（listMyOas/no-access — root 無変更成立の根拠）/ `lib/schemas/oa.ts`（questions スキーマのインライン構造）/ `question-list-editor.tsx`（controlled component）/ `rls.{helpers,test}.ts`（asUser ハーネス・既存マトリクス）/ `e2e_confirm_flow_test.ts`（署名・assert・teardown パターン）
- UI 修正ターゲットの grep 照合: events-page-client.tsx:38,41 / event-form-dialog.tsx:337,374 / linking-tab.tsx:283 / app-sidebar.tsx:37（font-medium 含む）/ login/page.tsx:30,43 / events-table.tsx dead cell / oa-selector.tsx:33
- 03-RESEARCH.md（Phase 3 実証事項の引き継ぎ: pooler ハーネス・silent-0-row・initplan 規約・確立コマンド列）

### Secondary (MEDIUM confidence)
- PostgREST/supabase-js の upsert returning が新値のみ・システム列 select 不可（PostgREST 仕様 + 既存実装の onConflict 挙動から） — select-before-upsert 推奨の根拠
- Supabase RLS initplan 最適化（`(select fn())` ラップ） — 既存マイグレーションが全面採用済みの規約に準拠

### Tertiary (LOW confidence — 実行時確認)
- LINE_DRY_RUN の dev secrets 残存（A1）/ twipla.jp 731057 の公開継続（A2）

## Metadata

**Confidence breakdown:**
- root権限（RLS OR 拡張）: HIGH — dev 実機でメカニズム全体をプローブ済み
- 通知設計（挿入点・差分・窓・logs）: HIGH — 全挿入点の実コード読解 + 純関数分離で検証可能性を担保。LINE push 自体は既存実証済みクライアント
- テンプレート: HIGH — 既存テーブル/RLS/action パターンの同型適用のみ
- E2E 全鎖: MEDIUM-HIGH — 構成部品は全て実証済みだが、実Twipla LIVE 依存（A2）と LINE_DRY_RUN 残存（A1）の2点が実行時確認
- UI 修正: HIGH — 全ターゲット行を実コードで照合済み

**Research date:** 2026-06-12
**Valid until:** 2026-07-12（外部依存の変化が少ない — 実Twipla URL の生存のみ要注意）
