-- 個別最終確認の手動配信（管理画面 紐付けタブ）
-- 単一参加者を confirm_status / status に関係なく配信対象として返す関数。
-- 用途: 主催者が特定の1名へ「今すぐ送り直す」（テスト・再送）。
--   - get_confirm_targets はバッチ用で confirm_status='pending' に絞るが、
--     こちらは送り直しのため confirm_status を一切問わない。
--   - 送信可能性の最低条件として line_user_id（紐付け済み）のみ要求する。
-- service_role のみ実行可（T-02-03）。呼び出し側の認可は message-sender が
-- ユーザーJWT経由のイベントアクセス検証（RLS）＋ event_id 一致チェックで担保する。
create or replace function public.get_participant_confirm_target(p_participant_id uuid)
returns table (
  participant_id  uuid,
  line_user_id    text,
  event_id        uuid,
  event_title     text,
  event_date      date,
  meeting_at      timestamptz,
  meeting_place   text,
  fee             text,
  venue_info      text,
  oa_config_id    uuid
)
language sql stable
set search_path = ''
as $$
  select
    p.id                                       as participant_id,
    lu.line_user_id                            as line_user_id,
    e.id                                       as event_id,
    e.title                                    as event_title,
    e.event_date                               as event_date,
    e.meeting_at                               as meeting_at,
    e.meeting_place                            as meeting_place,
    e.fee                                      as fee,
    e.venue_info                               as venue_info,
    e.oa_config_id                             as oa_config_id
  from public.participants p
  join public.event_platform_urls epu  on epu.id = p.event_platform_url_id
  join public.events              e    on e.id   = epu.event_id
  join public.line_users          lu   on lu.id  = p.line_user_id
  where p.id              = p_participant_id
    and p.line_user_id    is not null
$$;

revoke all on function public.get_participant_confirm_target(uuid) from public, anon, authenticated;
grant execute on function public.get_participant_confirm_target(uuid) to service_role;
