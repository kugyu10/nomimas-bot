# Milestones: nomimas

## v1.0 MVP — ✅ SHIPPED 2026-06-13

**Phases:** 1-4（16プラン・205コミット・146ファイル/+29,539行、2026-06-12夜〜06-13朝の夜間自律実行）
**Requirements:** 12/12 機械検証済み（実Twipla URL全鎖E2E green）

**Key accomplishments:**
1. Twiplaスクレイパー実証（プロバイダー抽象化・匿名化フィクスチャTDD・実URL E2E・SSRF防止）
2. LINE Bot自動配信〜1問1答〜回答保存のE2E（pg_cron+Vault・Web Crypto署名検証・ステートレストークンv3・なりすまし照合）
3. Next.js 16管理画面（X OAuth差替構造+モック認証・RLSマトリクス121テスト・イベントCRUD・手動紐付け・回答状況・OA設定）
4. イベント駆動の更新通知（2日前窓判定・notification_logs機械検証）・質問テンプレート・root横断閲覧
5. 4フェーズ全コードレビュー実施（Critical 3+Warning 29修正）+ UI監査（15→17/24）+ セキュリティ強制（STRIDE threat model全プラン）

**Known deferred items at close:** 8（STATE.md Deferred Items参照 — 全て計画的なHUMAN-UAT/運用項目）

Archives: [ROADMAP](milestones/v1.0-ROADMAP.md) / [REQUIREMENTS](milestones/v1.0-REQUIREMENTS.md) / [AUDIT](v1.0-MILESTONE-AUDIT.md)
