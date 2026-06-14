# 夜間自動実装の起動手順

GSD の `.planning/`（4フェーズ・v1要件12件）はブートストラップ済み。
このドキュメントの手順で Claude Code を起動して寝るだけです。

## 寝る前チェックリスト

- [x] LINE 認証情報（チャネルID/シークレット記入済み。アクセストークンは実行時に
      ステートレストークン(v3)を都度発行する設計のため、事前準備は不要 — 発行テスト済み）
- [ ] （任意）Twipla のサンプルイベントURLを起動メッセージに添える
- [ ] Mac がスリープしないようにする: `caffeinate -dims` を別ターミナルで実行、
      または 電源接続＋システム設定でディスプレイオフ時のスリープを無効化

## 起動コマンド

このディレクトリで、以下のどちらかで起動します。

### A. 直接接続（今夜はこちら）

堅牢さ優先。無人完走の確実性を最優先する場合の標準形。

```bash
cd ~/work/nomimas-bot
caffeinate -dims claude --dangerously-skip-permissions
```

### B. headroom 経由（トークン圧縮・要事前検証）

[headroom](https://github.com/chopratejas/headroom) のローカルプロキシ(localhost:8787)を
通すとツール出力等が圧縮されトークンを節約できる。ただし**無人夜間実行に使う前に
昼間に1回検証すること**（下記の注意点参照）。

```bash
cd ~/work/nomimas-bot
lsof -i :8787 || true                  # ポート空き確認
headroom proxy --port 8787 &           # プロキシを先に起動
ANTHROPIC_BASE_URL=http://localhost:8787 caffeinate -dims claude --dangerously-skip-permissions
```

> **無人実行での注意点**
> - サブスク(Pro/Max)認証だと `401 / Invalid proxy server token` の既知不具合あり
>   （[issue #3998](https://github.com/modelcontextprotocol/servers/issues/3998)）。
>   最初の数分でコケると一晩無駄になるので、昼間に `claude "2+2は?"` で
>   認証通過＋圧縮statsを確認してから採用する。
> - プロキシが落ちると全API呼び出しが死ぬ単一障害点が増える（節約 vs 完走確実性）。
> - `NO_PROXY=localhost,127.0.0.1` を要する環境あり（社内プロキシ干渉時）。

起動したら以下を送信:

```
/gsd:autonomous
```

補足を添える場合の例:

```
/gsd:autonomous Twiplaのサンプルイベント: https://twipla.jp/events/731057
実DBはdev環境(cmsxvxtcdniqgvhxjqri)のみ使用。prodには一切触れないこと。
フェーズ完了ごとにgit commit & push。
無人実行なので私への質問(AskUserQuestion)で止まらないこと。
ブロッカー/検証失敗は1回リトライ→ダメなら「スキップ」を自分で選び、
内容をSTATE.mdのBlockersに記録して次のフェーズへ進むこと。
グレーゾーンの設計判断はすべて自己判断で進めてよい。
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

- Twipla サンプルURL:https://twipla.jp/events/731057
