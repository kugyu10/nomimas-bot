# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-06-13（dev機械検証） / 2026-06-19（本番リリース）
**Phases:** 4 | **Plans:** 16 | **Sessions:** 夜間自律実行1回 + 仕上げ/HUMAN-UAT/prod構築 数回

### What Was Built
- Twiplaスクレイパー（プロバイダー抽象化・匿名化フィクスチャTDD・実URL E2E・SSRF防止）
- LINE Bot 自動配信〜1問1答〜回答保存の E2E（pg_cron + Vault・Web Crypto 署名検証・ステートレストークンv3・なりすまし照合）
- Next.js 16 管理画面（X OAuth・RLSマトリクス・イベントCRUD・手動紐付け・回答状況・OA設定・質問D&D・テンプレート）
- イベント駆動の更新通知（2日前窓判定・notification_logs）・root 横断閲覧
- 本番環境（Vercel + prod Supabase）構築・実機 HUMAN-UAT 全8件 pass・実X OAuth・実LINE push 配信

### What Worked
- 全成功条件を機械検証可能に設計した方針が効き、夜間自律実行で 4フェーズ16プランを完走できた
- スタック全Supabase統一（Edge Functions + pg_cron + Vault）で運用面の分岐が少なく、prod複製が短時間で済んだ
- env を dev/prod 分離 + gitignore 徹底（public repo）でシークレット事故ゼロ
- ステートレストークン + push API に送信を統一したことで、prod でも追加発行設定なしに配信が通った

### What Was Inefficient
- prod 化が「dev だけ動く」状態から始まり、HUMAN-UAT 段階で外部設定（X アプリの Project 未所属＝403 client-not-enrolled、Vercel Root Directory、env名 PUBLISHABLE_KEY 不一致、prod Supabase 未構築）が芋づる式に発覚。prod 前提の設定チェックリストを v1 設計時に用意しておけば往復が減った
- 管理画面に OA 作成・初期 root/owner ブートストラップの導線が無く、prod では seed スクリプトを都度書いて解錠する必要があった
- 個別送信ボタンを「紐付けタブの紐付け済みリスト」に置いたため、全員紐付け済みで早期returnに隠れて消える不具合（回答状況タブへ移設で解消）

### Patterns Established
- LINE 送信は必ず「ステートレストークン（client_credentials, channel_id+secret）→ POST /v2/bot/message/push」で統一（静的トークン・reply依存に逃げない）
- prod ブートストラップは冪等 deno スクリプト（PROD_PROJECT_REF 安全弁付き）で Vault/oa_config/root/owner を投入
- X OAuth は同一アプリを dev/prod 流用し、各 Supabase プロジェクトの callback を X アプリに登録。アプリは Project 所属が必須
- friend 取り込み: 未認証OAは getFollowerIds 403 のため、follow に加え message イベントでも line_users を upsert

### Key Lessons
1. 「dev で全要件 green」と「本番で動く」は別物。外部ダッシュボード（X / LINE / Supabase Auth / Vercel）の設定が本番化の主戦場になる。prod 化チェックリストを v1 から持つ。
2. 管理画面に「最初の OA 作成」「初期 owner 招待」の導線が無いと prod で詰む。ブートストラップ UX は MVP に含める価値がある。
3. UI のアクションボタンは「対象が0/全件」の空状態（早期return）で消えないか確認する。最も使いたい状態でこそ出ること。
4. Supabase Management API トークンは macOS Keychain から取得でき、Auth プロバイダー設定をダッシュボード無しで自動化できる。

### Cost Observations
- Model mix: 主に opus（夜間自律実行・仕上げ）
- Sessions: 夜間自律1回 + 日中の HUMAN-UAT/prod構築/バグ修正 数回
- Notable: 機械検証可能な成功条件設計が自律実行の完走率を支えた

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 夜間自律1 + 数回 | 4 | GSD 自律実行で MVP 完走 → HUMAN-UAT → 本番化を別フェーズとして実施 |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | RLS 121 + 各種ユニット/E2E | 機械検証 12/12 要件 | cheerio / zod のみ（全サーバーレス） |

### Top Lessons (Verified Across Milestones)

1. 成功条件は機械検証可能に設計する（自律実行の完走率に直結）。
2. 本番化は dev 完成後の独立した作業領域 — 外部設定の往復を見込む。
