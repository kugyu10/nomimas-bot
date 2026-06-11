# 事前設定ガイド（寝る前にやること）

夜間の自動実装を最大限進めるために必要な外部サービス設定です。
**必須は 1. の LINE チャネルのみ**（所要 5〜10分）。2. の X OAuth は Phase 3 までに設定できればOK。

---

## 1. LINE Messaging API チャネル作成【必須・5〜10分】

既存の LINE 公式アカウント（OA）に Messaging API を有効化します。

### 手順

1. [LINE Official Account Manager](https://manager.line.biz/) を開き、開発に使う OA を選択
2. 右上 **設定** → 左メニュー **Messaging API** → **Messaging APIを利用する**
3. プロバイダーを選択（なければ新規作成。例: `nomimas`）
4. プライバシーポリシー・利用規約URLは空欄でOK → **OK** で有効化
5. [LINE Developers コンソール](https://developers.line.biz/console/) を開き、該当プロバイダー配下にチャネルが出来ていることを確認
6. **チャネル基本設定** タブ → 一番下の **チャネルシークレット** をコピー
7. **Messaging API設定** タブ → 一番下の **チャネルアクセストークン（長期）** → **発行** をクリックしてコピー
8. 同じ **Messaging API設定** タブで以下を設定:
   - **応答メッセージ**: オフ（LINE公式アカウント機能の項目。「編集」から応答設定画面へ飛んで無効化）
   - **Webhook**: いったんそのまま（URL は Edge Function デプロイ後に自動実装側で案内）

### env への記入

`env.dev` の以下を埋める:

```
LINE_CHANNEL_SECRET=（手順6の値）
LINE_CHANNEL_ACCESS_TOKEN=（手順7の値）
```

> 💡 開発用と本番用で OA を分ける場合は、本番 OA 側も同様に作成して `env.prod` に記入（後日でOK）。

---

## 2. X (Twitter) OAuth アプリ作成【Phase 3 までに・10〜15分】

管理画面のログイン（Supabase Auth 経由）に使います。

### 手順

1. [X Developer Portal](https://developer.x.com/en/portal/dashboard) にログイン（Freeプランで可。未登録なら開発者登録から）
2. **Projects & Apps** → プロジェクト作成（例: `nomimas`）→ App 作成
3. App の **Settings** → **User authentication settings** → **Set up**:
   - **App permissions**: Read
   - **Type of App**: Web App, Automated App or Bot
   - **Callback URI / Redirect URL**:
     ```
     https://cmsxvxtcdniqgvhxjqri.supabase.co/auth/v1/callback
     ```
     （本番用に `https://hgojtooexbknqotzkkja.supabase.co/auth/v1/callback` も追加しておくと後が楽）
   - **Website URL**: 任意（例: `https://github.com/kugyu10/nomimas-bot`）
4. 保存すると **OAuth 2.0 Client ID / Client Secret** が表示されるのでコピー
5. あわせて **Keys and tokens** タブの **API Key / API Key Secret**（Consumer Keys）も控えておく
   （Supabase の Twitter プロバイダーは OAuth 1.0a の Consumer Keys を使う構成があるため、両方あると確実）

### Supabase 側の設定

1. [Supabase Dashboard](https://supabase.com/dashboard/project/cmsxvxtcdniqgvhxjqri/auth/providers)（nomimas-bot-dev）→ **Authentication** → **Sign In / Providers**
2. **Twitter** を有効化し、取得したキーを入力して保存

### env への記入

```
X_OAUTH_CLIENT_ID=（Client ID）
X_OAUTH_CLIENT_SECRET=（Client Secret）
```

---

## 3. あると助かるもの（任意）

- **Twipla のサンプルイベントURL**: スクレイピング実装の実地検証に使います。
  実在のイベントページ（自分が主催した過去イベント等）の URL を `docs/NIGHT-RUN.md` のメモ欄か Claude への次のメッセージで共有してください。

---

## 設定済みチェックリスト

- [x] Supabase dev/prod プロジェクト（作成済み・キー取得済み）
- [x] Supabase CLI ログイン
- [x] GitHub リポジトリ `kugyu10/nomimas-bot`（⚠️ **public** — 秘密情報は env ファイルのみに置くこと）
- [x] Deno / Vercel CLI インストール
- [ ] LINE チャネルシークレット & アクセストークン → `env.dev`
- [ ] X OAuth Client ID/Secret → `env.dev`（Phase 3 までに）
- [ ] Twipla サンプルURL の共有（任意）
