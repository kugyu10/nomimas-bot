# Phase 4 — UI Review（通知 + 統合仕上げ / notifications-integration）

**Audited:** 2026-06-13
**Baseline:** `.planning/phases/04-notifications-integration/04-UI-SPEC.md`（approved — 03-UI-SPEC を継承）
**Scope:** Phase 4 の新規/変更サーフェスのみ（テンプレート Dialog/Select、loading スケルトン、OA セレクタスピナー、CTA/accent/a11y/コピー修正）
**Screenshots:** not captured（dev server 未起動: 3000/5173/8080 全て応答なし → code-only audit）
**Mode:** ADVISORY — 非ブロッキング

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | 契約コピー（テンプレート系21項目・ログイン失敗）は完全一致。ただし OAuth callback 失敗の `?error=auth` がログイン画面で未処理＝無言失敗 |
| 2. Visuals | 2/4 | OA セレクタが手動 chevron + select.tsx 組込 chevron の**二重表示**。pending 時もスピナーが chevron を「置換」せず併存。disabled トリガーの Tooltip は発火しない |
| 3. Color | 4/4 | `bg-zinc-900` ハードコード全廃を確認（zinc-N 残存 0件）。CTA は全て default variant、sidebar は `border-primary text-primary` |
| 4. Typography | 3/4 | Phase 4 新規ファイルは契約準拠。ただし Phase 4 で編集したファイルに `font-medium`(500)/`text-base`(16px) の契約違反が残存 |
| 5. Spacing | 2/4 | loading.tsx が layout の `p-6` 内でさらに `p-6` → スケルトンが実コンテンツより 24px 内側＝layout shift。新規ファイルに `space-y-1.5`(6px) オフスケール |
| 6. Experience Design | 3/4 | スケルトン3ルート + useTransition スピナー + in-flight 制御 + 確認 AlertDialog + タイマー解放まで網羅的に優秀。Tooltip 不発火と callback エラー黙殺が減点 |

**Overall: 17/24**（Phase 3: 15/24 → +2）

---

## Phase 3 指摘の解消状況

### Top 3（全て RESOLVED）

| # | Phase 3 指摘 | 状態 | 根拠 |
|---|-------------|------|------|
| 1 | プライマリ CTA の二重プラス | **RESOLVED** | `events-page-client.tsx:39-40` は `<PlusIcon /> イベントを作成`、`event-form-dialog.tsx:350-351` は `<PlusIcon /> URL追加` — リテラル「+」消去、アイコン保持 |
| 2 | ローディング状態の全面欠落 | **RESOLVED**（新規欠陥2件あり — Top Fix 1/2 参照） | `events/loading.tsx`・`events/[id]/loading.tsx`・`oa/settings/loading.tsx` 全て Skeleton で実装、`oa-selector.tsx:28,36-38` `useTransition` + `isPending` スピナー |
| 3 | accent の `bg-zinc-900` ハードコード | **RESOLVED** | `grep zinc-[0-9]`（ui/ 除く）= **0件**。`events-page-client.tsx:36`・`event-form-dialog.tsx:385`・`linking-tab.tsx:281` は default variant、`app-sidebar.tsx:37` は `border-primary text-primary` |

### 軽微指摘（5a/5b/5c — 全て RESOLVED）

| 指摘 | 状態 | 根拠 |
|------|------|------|
| 5a. URL 削除ボタン aria-label/Tooltip | **RESOLVED** | `event-form-dialog.tsx:329` `aria-label="URLを削除"` + `:321-337` Tooltip ラッパー |
| 5b. ログイン失敗文言の誤用 | **RESOLVED**（部分 — 下記 Open 参照） | `login/page.tsx:43` 「メールアドレスまたはパスワードが正しくありません」 |
| 5c. イベント一覧の dead ステータス列 | **RESOLVED** | `events-table.tsx:46-52` — 列構成は イベント名\|開催日\|参加者数\|回答済み / 総数\|操作 |

### Phase 3 指摘で STILL OPEN（Phase 4 スコープ外として未対応）

- **font-medium(500)** — `events-table.tsx:57`、`question-list-editor.tsx:203`（両ファイルとも Phase 4 で編集されたが違反残存）。participants-tab / answer-status-tab / linking-tab も未修正
- **text-base(16px)** — `events-table.tsx:33`（空状態見出し）、oa-settings-form の CardTitle ×3
- **フォント Geist（契約は Inter）** — `app/layout.tsx:2-10` 変更なし
- **preset `radix-nova`（契約は new-york）** — `components.json:3` 変更なし
- **44px タッチターゲット未達** — `question-list-editor.tsx:214,225,235` `h-7 w-7`(28px)、`:270` `h-8 w-8`(32px) 残存
- **error.tsx 不在** — `app/(app)/error.tsx` なし（Phase 4 contract は loading のみ要求のためスコープ外、advisory 継続）
- **event-edit-button 成功 Alert の配置不良** — 未修正
- **「ログインが必要です」リダイレクト時表示** — 04-UI-SPEC §5b の条件マッピング（`unauthorized` → 「ログインが必要です」）は未実装。login ページは searchParams を一切読まないため、保護ページからのリダイレクト時に何も表示されない

---

## Top 3 Priority Fixes

1. **OA セレクタの chevron 二重表示 + スピナー非置換**（`oa-selector.tsx:49-53` × `components/ui/select.tsx:52-55`）— `SelectTrigger` は children の後に組込 `ChevronDownIcon` を常時描画するため、idle 時は chevron が2個、pending 時は スピナー+chevron 併存。全ページ共通ヘッダーで常時露出する見栄え欠陥で、契約「replacing the chevron-down icon」に違反 — 手動 `<ChevronDown>`（:52）を削除して組込 chevron に任せ、pending 時のみ trigger に `[&_svg:last-child]:hidden` 等で組込 icon を隠して `<Loader2>` を表示する（または select.tsx に icon 差し替え prop を追加）。
2. **loading.tsx の二重パディングによる layout shift**（`events/loading.tsx:5`・`events/[id]/loading.tsx:5`・`oa/settings/loading.tsx:5` × `(app)/layout.tsx:51`）— layout の `<main className="p-6">` 内に loading.tsx がさらに `p-6` を重ね、スケルトンが実コンテンツより 24px 内側（計48px）に描画 → コンテンツ到着時に全要素が外側へ跳ねる。契約自身が「layout shift を最小化」を目的に掲げつつ `p-6` ラッパーを指示した contract erratum — 3ファイルから `p-6` を外し `space-y-4` のみ残す（04-UI-SPEC への正誤反映を推奨）。
3. **OAuth callback 失敗の無言ドロップ**（`app/auth/callback/route.ts:24` → `/login?error=auth`、`login/page.tsx` は searchParams 未読）— X ログインが callback で失敗するとログイン画面に何の表示もなく戻され、ユーザーは成否を判断できない — login ページで `error` パラメータを読み、`auth` → 「ログインに失敗しました。もう一度お試しください」、（実装するなら）`unauthorized` → 「ログインが必要です」の契約マッピングを表示する。

---

## Detailed Findings

### Pillar 1: Copywriting (3/4) — WARNING

**契約一致（Phase 4 新規21エントリ — 全て検証済み・完全一致）:**
- テンプレート保存: トリガー/Dialog タイトル/フッター CTA「テンプレートとして保存」（`template-save-dialog.tsx:97,117,156`）、「テンプレート名」(:123)、「例: 歓迎会の定型質問セット」(:129)、「現在の質問 {n} 件を保存します」(:133-135)、「保存しない」(:149)、成功「テンプレートを保存しました」（`question-list-editor.tsx:154`）、失敗「テンプレートの保存に失敗しました。もう一度お試しください」(:77,81)、disabled Tooltip「質問がありません」(:107)
- テンプレート適用: セクションラベル「テンプレートを適用」（`template-apply-select.tsx:69`）、placeholder「テンプレートを選択...」(:73)、option 形式「{name}（{n}件の質問）」(:83)、空状態「保存済みテンプレートがありません」(:78)、AlertDialog タイトル「現在の質問を上書きしますか？」(:104)、description 全文一致(:106-108)、「適用しない」(:114)/「テンプレートを適用」(:119) — 禁止された略形「キャンセル」「適用」は不使用
- ログイン失敗「メールアドレスまたはパスワードが正しくありません」（`login/page.tsx:43`）— CONTEXT.md locked copy と一致
- Tooltip「URLを削除」（`event-form-dialog.tsx:335`）

**違反/ギャップ:**
- `app/auth/callback/route.ts:24` の `?error=auth` を `login/page.tsx` が読まない — callback 失敗時に契約エラーコピーが一切表示されない（Top Fix 3）
- 04-UI-SPEC §5b 条件マッピングの `unauthorized` → 「ログインが必要です」分岐が未実装（リダイレクト時は無表示）
- `login/page.tsx:30` 「ログインに失敗しました。もう一度お試しください」（OAuth 開始失敗用）— 妥当な文言だが契約外。Copywriting Contract への追補を推奨

### Pillar 2: Visuals (2/4) — WARNING

- **chevron 二重表示（Top Fix 1）:** `oa-selector.tsx:52` の手動 `<ChevronDown className="h-4 w-4 opacity-50" />` と `ui/select.tsx:53-55` の組込 `<SelectPrimitive.Icon><ChevronDownIcon /></SelectPrimitive.Icon>` が両方描画。pending 時(:50)も Loader2 + 組込 chevron が併存し、契約の「spinner ... replacing the chevron-down icon」に不適合
- **disabled トリガーの Tooltip 不発火:** `template-save-dialog.tsx:92,103-109` — native `disabled` 属性付きボタンは pointer events を発火しないため、Radix Tooltip「質問がありません」はホバーで開かない。`disabled` を外し `aria-disabled` + 既存の onClick ガード(:93) + 見た目クラス（`opacity-50 cursor-not-allowed`）に切り替えるか、`<span tabIndex={0}>` でラップする
- **良好:** テンプレート適用ブロックは質問リスト上部(`question-list-editor.tsx:170-176`)、保存トリガーは「質問を追加」と同列 flex gap-2(:291-310) — 契約レイアウトどおり。icon-only ボタンは全て aria-label あり（:199,213,224,233,269、`event-form-dialog.tsx:329`）。スケルトン3ファイルの形状（列数・行高・カード高）は契約の構造指定と完全一致
- 軽微: 空テンプレート時の `SelectItem disabled`（`template-apply-select.tsx:77-79`）はデフォルト 14px — 契約は「12px/400 muted」を指定

### Pillar 3: Color (4/4) — PASS

- `zinc-[0-9]` 残存 **0件**（components/ + app/、ui/ 除く）— Phase 3 Top Fix 3 の4箇所全て解消:
  - `events-page-client.tsx:36-41` — className 無指定の default variant（`bg-primary text-primary-foreground hover:bg-primary/90`）
  - `event-form-dialog.tsx:385-390` — 同上
  - `linking-tab.tsx:281-287` — 同上（hover 不統一も同時解消）
  - `app-sidebar.tsx:37` — `border-l-2 border-primary pl-2 text-primary`
- Phase 4 新規ファイルにハードコード hex/rgb なし。destructive は `text-destructive`（`template-save-dialog.tsx:139`、`question-list-editor.tsx:235`）にトークンで限定。60/30/10 配分維持

### Pillar 4: Typography (3/4) — WARNING

**Phase 4 新規ファイルは準拠:** template-save-dialog / template-apply-select / loading×3 / oa-selector — 使用サイズは text-xs(12px)/text-sm(14px) のみ、weight 指定なし(400)。DialogTitle/AlertDialogTitle は shadcn 既定で 600

**残存違反（Phase 4 で編集したファイル内 — 契約「weight は 400/600 のみ・text-base 未宣言」）:**
- `events-table.tsx:57` `font-medium`(500)、`:33` `text-base font-semibold`（空状態見出し — 14px/600 か 20px/600 へ）
- `question-list-editor.tsx:203` `text-sm font-medium`（Q番号ラベル）
- グローバル: フォントが Geist のまま（`app/layout.tsx:2-10`、契約は Inter）— Phase 3 から持ち越し、Phase 4 スコープ外

### Pillar 5: Spacing (2/4) — WARNING

**契約適合:**
- loading.tsx ラッパー `space-y-4`、スケルトン寸法（h-7/h-9/h-4/h-10/w-32/w-36/w-48/w-24/w-20/h-48/h-40/h-64）は契約指定値と完全一致
- Select 幅 `max-w-[280px]`（`template-apply-select.tsx:72`、`oa-selector.tsx:44`）— 契約一致
- gap-2 / space-y-2 / space-y-4 / p-4 — 4px 倍数準拠

**違反:**
- **二重パディング（Top Fix 2）:** loading.tsx 3ファイルの `p-6` が `(app)/layout.tsx:51` の `p-6` と重複 → スケルトン実効インセット 48px vs 実コンテンツ 24px。契約の指示自体に起因する erratum だが、結果は契約が回避を掲げた layout shift そのもの
- **オフスケール 6px:** `template-save-dialog.tsx:121` `space-y-1.5` — **Phase 4 新規ファイルでの新規違反**（契約「Phase 4 exceptions: none」）。`question-list-editor.tsx:243` にも残存。`space-y-1`(4px) か `space-y-2`(8px) へ
- 持ち越し: `question-list-editor.tsx` の `h-7 w-7`(28px)/`h-8 w-8`(32px) ボタン — 44px タッチターゲット契約未達（Phase 3 から継続）

### Pillar 6: Experience Design (3/4) — WARNING

**良好（網羅的に契約準拠）:**
- loading.tsx ×3: `aria-busy="true"` ラッパー + 全 Skeleton `aria-hidden="true"`、テキストなし — Accessibility Contract 完全準拠
- OA セレクタ: `useTransition` + `isPending`（`oa-selector.tsx:28,36-38`）、`aria-busy={isPending}` + 切替中 `aria-label="OAを切替中..."`(:45-46)、transition 中も操作可能（disabled なし）— 契約どおり
- 保存 Dialog: `autoFocus`(:130)、Enter submit（form onSubmit :120）、in-flight で CTA/Input/cancel 全 disabled + Loader2(:131,147,153-155)、保存中の dialog 閉鎖ブロック(:50-51)、エラー時 dialog 維持 + footer 上にエラー(:138-140)、成功時 close + 親 Alert 4秒 auto-dismiss
- auto-dismiss タイマーの unmount 解放 + 連続保存時の張り直し（`question-list-editor.tsx:50-57,153-158`）— メモリリーク/累積防止まで配慮
- 適用フロー: AlertDialog 確認 → confirm でクライアント置換 + Select リセット(:57-59)、cancel で選択保持(:62-64) — 契約の5ステップ全一致

**減点:**
- disabled トリガーの Tooltip 不発火（Visuals 参照）— 空状態でなぜ押せないかの説明が実質失われる
- OAuth callback エラーの黙殺（Top Fix 3）— 失敗フィードバックの欠落
- 持ち越し: `app/(app)/error.tsx` 不在（loading のみが Phase 4 契約のためスコープ外、advisory 継続）

---

## Registry Safety

- `admin/components.json` 存在、`04-UI-SPEC` Registry Safety: サードパーティなし・新規 add なし
- Registry audit: 0 third-party blocks checked, no flags
- 持ち越し note: `components.json:3` `"style": "radix-nova"`（契約 preset は new-york）— Phase 3 指摘のまま未変更

---

## Files Audited

- `.planning/phases/04-notifications-integration/04-UI-SPEC.md`（baseline contract）
- `.planning/phases/03-admin-ui/03-UI-REVIEW.md`（解消確認の対照）
- `admin/components/oa/template-save-dialog.tsx` / `template-apply-select.tsx` / `question-list-editor.tsx`
- `admin/app/(app)/events/loading.tsx` / `events/[id]/loading.tsx` / `oa/settings/loading.tsx`
- `admin/components/oa-selector.tsx`（+ `admin/components/ui/select.tsx` 構造確認）
- `admin/components/events/events-page-client.tsx` / `events-table.tsx` / `event-form-dialog.tsx` / `linking-tab.tsx`（CTA 箇所のみ）
- `admin/app/login/page.tsx` / `admin/app/auth/callback/route.ts`（エラーパラメータ追跡）
- `admin/components/app-sidebar.tsx`
- `admin/app/(app)/layout.tsx`（padding 重複検証）/ `admin/app/layout.tsx`（フォント）/ `admin/components.json`
