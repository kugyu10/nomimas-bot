# 夜間自動実装の起動手順

GSD の `.planning/`（4フェーズ・v1要件12件）はブートストラップ済み。
このドキュメントの手順で Claude Code を起動して寝るだけです。

## 寝る前チェックリスト

- [ ] `env.dev` の `LINE_CHANNEL_ACCESS_TOKEN` を発行して記入
      （LINE Developers → Messaging API設定 → チャネルアクセストークン（長期）→ 発行。
      チャネルID/シークレットは記入済み）
- [ ] （任意）Twipla のサンプルイベントURLを起動メッセージに添える
- [ ] Mac がスリープしないようにする: `caffeinate -dims` を別ターミナルで実行、
      または 電源接続＋システム設定でディスプレイオフ時のスリープを無効化

## 起動コマンド

このディレクトリで:

```bash
cd ~/work/nomimas-bot
caffeinate -dims claude --dangerously-skip-permissions
```

起動したら以下を送信:

```
/gsd:autonomous
```

補足を添える場合の例:

```
/gsd:autonomous Twiplaのサンプルイベント: https://twipla.jp/events/xxxxx
実DBはdev環境(cmsxvxtcdniqgvhxjqri)のみ使用。prodには一切触れないこと。
フェーズ完了ごとにgit commit & push。
```

> `--dangerously-skip-permissions` は全ツール実行を無確認で許可します。
> このプロジェクトは dev/prod の Supabase 認証情報を持つため、
> 心配なら起動メッセージに「prod環境(hgojtooexbknqotzkkja)への操作は禁止」と明記してください
> （ROADMAP/PROJECT.md にも dev のみ使用と記載済み）。

## 夜間に自動で行われること

1. Phase 1: モノリポ初期化・DBスキーマ・Twiplaスクレイパー・LINE Webhook 雛形（最大リスクの実証）
2. Phase 2: N日前自動配信 → 1問1答 → 回答保存の E2E
3. Phase 3: 管理画面（Next.js）。X OAuth は未設定のためモック認証で実装し、後日差し替え可能な構造
4. Phase 4: 通知・テンプレート・root権限・E2E通し

各フェーズで discuss → plan → execute → verify が回り、アトミックコミットが積まれます。

## 朝の確認ポイント

```bash
cd ~/work/nomimas-bot
git log --oneline | head -30        # 進捗をコミット履歴で確認
cat .planning/STATE.md              # 現在フェーズ・ブロッカー
ls .planning/phases/*/VERIFICATION.md 2>/dev/null   # フェーズ検証結果
```

- 止まっていた場合: そのセッションで状況を聞くか、新セッションで `/gsd:resume-work`
- ブロッカーが「LINE access token」「X OAuth」の場合: env を埋めて `/gsd:resume-work`

## メモ欄

- Twipla サンプルURL:
