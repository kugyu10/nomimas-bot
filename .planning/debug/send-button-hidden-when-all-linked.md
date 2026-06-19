---
slug: send-button-hidden-when-all-linked
status: resolved
created: 2026-06-19
---

# 個別最終確認の送信ボタンが「全員紐付け済み」で消える

## 症状
- 参加者個別の「最終確認を送信」ボタンが紐付けタブの「紐付け済み」リスト各行にあった。
- 全員が紐付け済みになると送信ボタンが表示されず、送信できない。

## 根本原因
`admin/components/events/linking-tab.tsx` に早期 return がある:

```ts
if (unlinked.length === 0 && linked.length > 0) {
  return <Alert>全員の紐付けが完了しています</Alert>;  // ← 紐付け済みリストごと描画されない
}
```

送信ボタンは「紐付け済みリスト」の各行に置かれていたため、全員紐付け済み＝未紐付け0件
になるとこの早期 return に入り、リスト（＝送信ボタン）が一切描画されなくなる。
「送りたい状態（全員紐付け済み）」でちょうどボタンが消える、という噛み合わせの悪さ。

## 修正（ユーザー要望: 回答状況画面に表示）
個別送信ボタンを紐付けタブから **回答状況タブ（AnswerStatusTab）** に移設した。

- `lib/answer-status.ts`: `AnswerStatusRow` に `isLinked`（line_user_id 非null）を追加。
- `components/events/answer-status-tab.tsx`:
  - `eventId` prop を受け取り、各行に `SendParticipantButton`（紐付け済みのみ。未紐付けは「未紐付け」表示）を「最終確認」列として追加。
  - 空状態を「参加者0件のときのみ」に緩和（回答0件でも表を描画）。未回答者にこそ最終確認を
    送りたいので、回答が無くても送信ボタンを出せるようにした。
- `components/events/linking-tab.tsx`: 紐付け済みリストから送信ボタンを撤去（紐付け専用に戻す）。
- `app/(app)/events/[id]/page.tsx`: `AnswerStatusTab` に `eventId` を渡す。

## 検証
- `npx tsc --noEmit` パス / `npm run build` 成功
- `tests/unit/answer-status.test.ts` 5件パス（isLinked 追加で既存アサーションに影響なし）
