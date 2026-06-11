-- dev検証用シードデータ（固定UUIDで冪等に適用可能）
-- Phase 1 Plan 02: scraper Edge Function のDB保存検証に使用

-- LINE OA設定（dev用）
insert into public.oa_configs (id, name, line_channel_id, admin_twitter_id, greeting_message)
values (
  '00000000-0000-0000-0000-000000000001',
  'dev-oa',
  null,
  null,
  null
)
on conflict (id) do nothing;

-- テストイベント（dev用）
insert into public.events (id, oa_config_id, title)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'dev-event'
)
on conflict (id) do nothing;

-- TwiplaイベントのプラットフォームURL（scraper検証用）
insert into public.event_platform_urls (id, event_id, platform, url)
values (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000002',
  'twipla',
  'https://twipla.jp/events/731057'
)
on conflict (id) do nothing;
