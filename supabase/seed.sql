-- dev検証用シードデータ（固定UUIDで冪等に適用可能）
-- Phase 1 Plan 02: scraper Edge Function のDB保存検証に使用
-- Phase 2 Plan 01: questions JSONB / E2Eテスト用 line_user + participant 追加

-- LINE OA設定（dev用）
-- line_channel_id は null のまま（シークレット非コミット）
-- scripts/setup-dev.ts が実行時に env.dev から UPDATE する
insert into public.oa_configs (id, name, line_channel_id, admin_twitter_id, greeting_message, questions)
values (
  '00000000-0000-0000-0000-000000000001',
  'dev-oa',
  null,
  null,
  null,
  '[
    {"id": "q_age",   "text": "年齢確認です。あなたは20歳以上ですか？",             "options": ["20歳以上です", "未成年です"]},
    {"id": "q_drink", "text": "飲酒予定はありますか？",                             "options": ["飲む", "飲まない"]},
    {"id": "q_late",  "text": "遅刻・早退の予定はありますか？",                     "options": ["なし", "遅刻予定", "早退予定"]}
  ]'::jsonb
)
on conflict (id) do nothing;

-- テストイベント（dev用）
-- event_date = current_date + 3: confirm_days_before=7 の窓内に入る動的値（E2E配信対象検証用）
-- meeting_at / meeting_place / fee / venue_info: 初回配信メッセージ組み立て検証用のダミー値
insert into public.events (id, oa_config_id, title, event_date, meeting_at, meeting_place, fee, venue_info, confirm_days_before)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'dev-event',
  current_date + 3,
  now() + interval '3 days',
  '渋谷駅ハチ公前',
  '3000円',
  '渋谷の居酒屋（dev-venue）',
  7
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

-- E2E用テスト LINE ユーザー（固定UUID）
-- 注意: line_user_id 'U00000000000000000000000000000dev' は実在しない値。
--   LINE_DRY_RUN=1 での機械検証専用。実配信検証（HUMAN-UAT）では実 follow で作られた行を使うこと
insert into public.line_users (id, oa_config_id, line_user_id, display_name)
values (
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'U00000000000000000000000000000dev',
  'dev-tester'
)
on conflict (id) do nothing;

-- E2E用テスト参加者（固定UUID）
-- status='attending' / confirm_status='pending' で get_confirm_targets() の配信対象になる
insert into public.participants (id, event_platform_url_id, display_name, natural_key, status, line_user_id, confirm_status)
values (
  '00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000003',
  'devテスト参加者',
  'dn:devテスト参加者',
  'attending',
  '00000000-0000-0000-0000-000000000004',
  'pending'
)
on conflict (id) do nothing;
