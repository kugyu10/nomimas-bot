-- notification_logs.kind に 'confirm_broadcast' を追加
--
-- なぜ必要か:
-- notification_logs は当初「主催者(oa_members)向け通知が窓内で正しく発火したか」を
-- 機械検証するための計測台帳として作られた（20260611171037_create_core_tables.sql の
-- notification_logs コメント参照）。そのため kind は 'answer' / 'completion' /
-- 'scrape_changes' の3種類のみに制限されていた。
-- 一方、参加者本人への3日前の最終確認配信（message-sender）はこのテーブルに一切
-- 記録しておらず、「本人には届いていたのに notification_logs は sent:0 が並ぶ」という
-- 観測の矛盾を生んでいた（docs/v1.1-notification-log-audit.md 参照）。
-- 本マイグレーションは案A（message-sender の配信結果も notification_logs に記録する）を
-- 採用するため、CHECK 制約に 'confirm_broadcast' を追加する。
--
-- 変更範囲: CHECK 制約の入れ替えのみ。列の追加・削除、既存データの変更は行わない。
-- 制約名は create table 内のインライン CHECK に対して Postgres が自動生成した
-- notification_logs_kind_check（information_schema で確認済み）。将来の再実行や
-- 手動での事前変更に備えて if exists を付け、drop/add とも冪等にする。

alter table public.notification_logs
  drop constraint if exists notification_logs_kind_check;

alter table public.notification_logs
  add constraint notification_logs_kind_check
  check (kind in ('answer', 'completion', 'scrape_changes', 'confirm_broadcast'));

-- 補足: confirm_broadcast 行の oa_config_id / event_id は message-sender が
-- get_confirm_targets()/get_participant_confirm_target() の戻り値
-- （oa_config_id, event_id を含む）からそのまま埋められるため、両カラムとも
-- NOT NULL 制約を変更する必要はない（confirm_broadcast でも常に値が取れる）。
