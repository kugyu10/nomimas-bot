# Phase 3 — UI Review（管理画面 / admin-ui）

**Audited:** 2026-06-12
**Baseline:** `.planning/phases/03-admin-ui/03-UI-SPEC.md`（approved design contract）
**Screenshots:** not captured（dev server 未起動: 3000/5173/8080 全て応答なし → code-only audit）
**Mode:** ADVISORY — 本レビューは Phase 4 polish への入力であり、ブロッキングではない

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | 契約コピーはほぼ完全一致。ただし「+ イベントを作成」が icon+literal で二重「+」表示、ログイン失敗に auth-required 用コピーを誤用 |
| 2. Visuals | 2/4 | 一覧の最重要 CTA に二重プラス、イベント一覧の「ステータス」列が常時 "—" のデッド列、アイコンボタンの aria-label 欠落あり |
| 3. Color | 3/4 | トークン遵守・badge 契約は完全一致。ただし accent が `bg-primary` トークンでなく `bg-zinc-900` ハードコード（hover 値も不統一） |
| 4. Typography | 2/4 | 契約「weight は 400/600 のみ」に対し `font-medium`(500) が9箇所、未宣言の `text-base`(16px) が5箇所。フォントも Inter 契約に対し Geist |
| 5. Spacing | 2/4 | 「4の倍数のみ」契約に対し 6px/12px/2px がオフスケール使用、44px タッチターゲット契約は全ボタンで未達（28–36px） |
| 6. Registry Safety | 3/4 | サードパーティ registry なし・全て official で安全。ただし preset が契約 `new-york` でなく `radix-nova` |

**Overall: 15/24**

**補助スコア（advisory・合計外）— Experience Design: 2/4** — 楽観更新+巻き戻し・確認ダイアログ・pending 無効化は優秀だが、Skeleton/loading.tsx が全ルートで未実装、error boundary なし、OA セレクタ切替スピナー未実装。

---

## Top 3 Priority Fixes

1. **プライマリ CTA の二重プラス表示**（`admin/components/events/events-page-client.tsx:40-41`、`admin/components/events/event-form-dialog.tsx:336-337`）— 画面で最も目立つボタンが「⊕ + イベントを作成」「⊕ +URL追加」と崩れて見える — `<PlusIcon>` を残しリテラルの「+」を文字列から削除（契約コピー「+ イベントを作成」の「+」はアイコンで表現）。
2. **ローディング状態の全面欠落** — ナビゲーション・OA 切替時に無反応で固まって見える（async RSC のため体感数百 ms〜数秒）— `app/(app)/events/loading.tsx`・`app/(app)/events/[id]/loading.tsx`・`app/(app)/oa/settings/loading.tsx` を installed 済みの `Skeleton` で追加し、`oa-selector.tsx` に切替中スピナー（`useTransition`）を追加。
3. **accent のハードコード `bg-zinc-900`**（`events-page-client.tsx:38`、`event-form-dialog.tsx:374`、`linking-tab.tsx:283`、`app-sidebar.tsx:37`）— テーマトークンを迂回し hover も `zinc-800`/`zinc-700` で不統一 — `bg-primary text-primary-foreground hover:bg-primary/90`（デフォルト Button variant）に置換。`oa-settings-form.tsx:221` は既にデフォルト variant で正しい。

---

## Detailed Findings

### Pillar 1: Copywriting (3/4) — WARNING

**契約一致（確認済み・抜粋）:**
- 「イベントを保存」「参加者を取得」「紐付け」「設定を保存」 — 全 CTA 一致
- 空状態: 「まだイベントがありません」+ body（`events-table.tsx:33-36`）、「参加者がいません」+ body（`participants-tab.tsx:45-48`）、「まだ回答がありません」（`answer-status-tab.tsx:46,58`）、「全員の紐付けが完了しています」（`linking-tab.tsx:171`）、「紐付けされていない参加者がいます。…」（`linking-tab.tsx:191`）
- エラー: scrape 失敗・保存失敗・データ取得失敗（`oa/settings/page.tsx:43`）— 契約文言と完全一致
- 破壊操作: 「紐付けを解除しますか？」/ description / 「解除しない」/ 「紐付けを解除」（`linking-tab.tsx:335-349`）— 完全一致
- 「OAを選択...」（`oa-selector.tsx:39`）、「LINE友だちを選択...」「該当するLINE友だちが見つかりません」（`linking-tab.tsx:236,245`）、「1日前〜7日前」（`event-form-dialog.tsx:258-262`）— 一致
- 成功フィードバック「イベントを作成しました」「参加者の取得が完了しました（{n}件）」— 一致

**違反:**
- `events-page-client.tsx:41` / `event-form-dialog.tsx:337` — リテラル「+」と `PlusIcon` が重複（契約の「+ イベントを作成」はアイコンか文字どちらか一方の意図）
- `login/page.tsx:30,43` — ログイン**失敗**時に「ログインが必要です」を表示。これは契約上 auth-required（未ログインリダイレクト）用のコピー。失敗時は「ログインに失敗しました。…」系の文言が必要（契約に未定義 → Phase 4 で contract 追補推奨）
- `login/page.tsx:121` — 「テストログイン」ボタンラベルは契約外（契約は説明ラベル「テストユーザーでログイン（開発環境のみ）」のみ定義。p 要素では一致 `login/page.tsx:90`。軽微）
- 契約の Table no-rows fallback「データがありません」は未使用（全テーブルが個別空状態を持つため実害なし）

### Pillar 2: Visuals (2/4) — WARNING

- **BLOCKER 級の見栄え欠陥:** 二重プラス（上記 Top Fix 1）。メイン画面の focal point である primary CTA に発生
- **デッド列:** `events-table.tsx:64-66` — 「ステータス」列が全行 `—` 固定。契約はステータス列にデータ表示を想定。実データ未配線なら列を隠すか badge を配線すべき
- **aria-label 欠落:** `event-form-dialog.tsx:315-324` — URL 行削除の `TrashIcon` icon-only ボタンに aria-label/Tooltip なし（契約 Accessibility: icon-only は label 必須）。対照的に `question-list-editor.tsx` は全 icon ボタンに aria-label あり（144,168,179,214 — 良好）
- **Tooltip 未使用:** 契約 Component Inventory は「アイコンボタンのラベル補足」に Tooltip を宣言。回答状況タブの truncate 表示（`answer-status-tab.tsx:90-99`）のみ使用、icon ボタンには未適用
- **alert 配置不良:** `event-edit-button.tsx:43-47` — 成功 Alert が詳細ページの `flex items-center gap-2` アクション行内（`events/[id]/page.tsx:75-78`）にインライン挿入され、行内に押し込まれてレイアウトが歪む。アクション行の外に出すべき
- 階層自体は良好: h1(20px/600) + subtitle(muted) + tabs + table の構成は契約レイアウトに忠実

### Pillar 3: Color (3/4) — WARNING

- ハードコード hex/rgb: **0件**（tsx 内、ui/ 除く）— 良好
- Status badge: `answer-status-tab.tsx:23-28`・`participants-tab.tsx:18-21` — 契約 Status Badge Reference の className と**完全一致**（yellow/blue/purple/green/orange/gray の bg-100/text-800 ペア）
- Destructive: `linking-tab.tsx:326,345` — red-600 系で契約どおり「紐付けを解除のみ」に限定。60/30/10 配分は維持されている
- **違反:** accent `bg-zinc-900` ハードコード 3箇所 + sidebar `border-zinc-900 text-zinc-900`（`app-sidebar.tsx:37`）。`--primary`(oklch 0.205 ≒ zinc-900) トークンが存在するのに迂回。hover が `zinc-800`（`events-page-client.tsx:38`, `event-form-dialog.tsx:374`）と `zinc-700`（`linking-tab.tsx:283`）で不統一 → 同一アクションの押下感が画面間で異なる
- 紐付けタブの Alert に `border-green-200 bg-green-50` / `border-orange-200 bg-orange-50`（`linking-tab.tsx:170,189`）— 契約は緑 alert variant を明示しており許容（semantic status の範疇）

### Pillar 4: Typography (2/4) — WARNING

実測分布（app + components、ui/ 除く）:

| Class | Count | 契約適合 |
|-------|-------|---------|
| text-sm (14px) | 22 | OK — Body |
| text-xs (12px) | 21 | OK — Label |
| text-xl (20px) | 7 | OK — Heading（全 h1/DialogTitle が `text-xl font-semibold` で 20px/600 を遵守） |
| text-base (16px) | 5 | **違反 — 契約未宣言サイズ** |
| font-semibold (600) | 12 | OK |
| font-medium (500) | 9 | **違反 — 契約「weight は 400/600 の2種のみ。No medium」** |

- `font-medium` 箇所: `events-table.tsx:58`, `participants-tab.tsx:69`, `answer-status-tab.tsx:80`, `linking-tab.tsx:199,206,298,309`, `app-sidebar.tsx:37`, `question-list-editor.tsx:148`
- `text-base` 箇所: `events-table.tsx:33`, `participants-tab.tsx:45`（空状態見出し）, `oa-settings-form.tsx:87,141,183`（CardTitle）。契約に従うなら空状態見出し/CardTitle は 14px/600 か 20px/600 に寄せる
- **フォント:** `app/layout.tsx:2-13` — Geist / Geist_Mono。契約は「Inter（system-ui fallback）」。実害は小さいが契約逸脱（Phase 4 で Inter へ差し替えか contract 改訂）
- monospace: `oa-settings-form.tsx:113` — チャンネルID read-only に `font-mono text-xs` で契約どおり

### Pillar 5: Spacing (2/4) — WARNING

**契約適合:**
- Main content padding 24px: `(app)/layout.tsx:51` `p-6` — 一致
- Header 48px: `app-header.tsx:26` `h-12` — 一致
- OA selector 280px: `oa-selector.tsx:38` `max-w-[280px]` — 一致
- Combobox popover 320px/280px: `linking-tab.tsx:240` `w-[320px]` + maxHeight 280px — 一致（ただし inline style。Tailwind `max-h-[280px]` 推奨）
- Table row 40px: `events-table.tsx:57`, `participants-tab.tsx:68` `h-10` — 一致。**ただし `answer-status-tab.tsx` の行には h-10 がなくタブ間で行高不統一**

**違反（契約「4の倍数のみ」）:**
- 6px: `space-y-1.5` ×6（`oa-settings-form.tsx:94,107,118,148,162,188` 周辺）
- 12px: `p-3`（`linking-tab.tsx:205,306`）、`space-y-3` ×3
- 2px: `space-y-0.5`（`linking-tab.tsx:308`）
- 28px ボタン: `question-list-editor.tsx:159,170,180` `h-7 w-7`、32px: `h-8 w-8`（:215）
- **44px タッチターゲット契約は全ボタンで未達**: shadcn デフォルト h-9(36px)/sm h-8(32px)/icon h-7(28px)。デスクトップ管理画面のため実害は限定的だが契約上は **(auto)** で明示された要件
- 未宣言の任意値: `max-w-[120px]`（`app-header.tsx:39`）、`w-[200px]` combobox trigger（`linking-tab.tsx:230`）、`min-w-[2rem]`（`question-list-editor.tsx:148`）

### Pillar 6: Registry Safety (3/4) — WARNING

- `admin/components.json` 存在。`"registries": {}` — **サードパーティ registry ゼロ**。契約どおり全コンポーネントが official 由来（alert-dialog, alert, avatar, badge, button, card, command, dialog, dropdown-menu, field, input-group, input, label, popover, select, separator, sheet, sidebar, skeleton, table, tabs, textarea, tooltip）
- Registry audit: 0 third-party blocks checked, no flags
- **契約逸脱:** `components.json:3` `"style": "radix-nova"` — 契約は `new-york` preset（frontmatter `preset: new-york / neutral base / zinc accent`）。baseColor `neutral` は一致。radix-nova は密度・角丸・コンポーネント構造（Field/InputGroup 系）が new-york と異なるため、UI-SPEC のサイズ前提（例: table compact size="sm"）と差異が出る根因になっている
- 契約 Component Inventory の `Form`（react-hook-form ラッパー）は未インストールで、代わりに `field.tsx` + 素の `register` を使用 — 機能等価で許容（advisory note）
- インストール済みだが未使用: `separator.tsx`, `skeleton.tsx`（skeleton は Top Fix 2 で使用すべき）

### 補助: Experience Design (2/4・advisory、合計外)

**良好:**
- 楽観的更新 + 失敗時巻き戻し: `linking-tab.tsx:111-127,152-164` — 契約 Interaction Contract に忠実
- 破壊操作の AlertDialog 確認: `linking-tab.tsx:320-352` — 契約どおり
- scrape ボタン: pending 中 disabled + スピナー + 成功/失敗 inline alert + 再有効化（`scrape-button.tsx`）— 契約完全準拠
- フォーム: `mode: "onBlur"` zod 検証 + `disabled={!isValid || isPending}`（`event-form-dialog.tsx:118,373`）— 契約準拠
- ログイン: next パラメータの open-redirect 防御（`login/page.tsx:52`）

**欠落:**
- **loading.tsx / Skeleton 不在**: `app/(app)/` 配下に loading.tsx ゼロ、Skeleton import ゼロ。契約 Loading state「Skeleton表示」未実装
- **error.tsx 不在**: `app/(app)/error.tsx`・`app/error.tsx`・`app/not-found.tsx` なし。events ページの fetch 失敗は未処理 throw になり契約のエラーコピーが表示されない（OA設定ページのみ手動でカバー: `oa/settings/page.tsx:38-47`）
- **OA セレクタ切替スピナー未実装**: 契約「header OA selector shows spinner icon while scope is switching **(auto)**」に対し `oa-selector.tsx` は `router.refresh()` のみで無反応
- `linking-tab.tsx:71` — `isPending` が単一でリスト内**全**ボタンを一括 disable（1件の紐付け中に他参加者の操作も不能）。participant 単位の pending 管理が望ましい
- `event-edit-button.tsx` 成功 alert の配置不良（Visuals 参照）

---

## Files Audited

- `.planning/phases/03-admin-ui/03-UI-SPEC.md`（baseline contract）
- `admin/app/layout.tsx` / `admin/app/globals.css` / `admin/components.json`
- `admin/app/(app)/layout.tsx`
- `admin/app/(app)/events/page.tsx` / `admin/app/(app)/events/[id]/page.tsx`
- `admin/app/(app)/oa/settings/page.tsx`
- `admin/app/login/page.tsx` / `admin/app/no-access/page.tsx` / `admin/app/page.tsx`
- `admin/components/app-header.tsx` / `admin/components/app-sidebar.tsx` / `admin/components/oa-selector.tsx`
- `admin/components/events/events-page-client.tsx` / `events-table.tsx` / `event-form-dialog.tsx` / `event-edit-button.tsx` / `scrape-button.tsx` / `participants-tab.tsx` / `answer-status-tab.tsx` / `linking-tab.tsx`
- `admin/components/oa/oa-settings-form.tsx` / `question-list-editor.tsx`
- `admin/components/ui/`（インベントリ確認のみ — 生成コードは個別監査対象外）
