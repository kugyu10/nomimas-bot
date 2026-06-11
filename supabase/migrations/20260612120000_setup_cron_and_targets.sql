-- cron基盤マイグレーション
-- Phase 2 Plan 01: pg_cron/pg_net有効化 + 配信対象抽出関数 + cron.schedule（Vault参照型）
-- 注意: cron拡張はdb resetで消えるため必ずマイグレーションに置く（02-RESEARCH Pitfall 1実証済み）

-- 拡張有効化
-- pg_catalogスキーマに入る（Supabase managed）
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- public.get_confirm_targets()
-- 配信対象参加者を返す（attending ∧ pending ∧ 紐付け済み ∧ N日以内イベント）
-- service_role のみ実行可（T-02-03）
-- ----------------------------------------------------------------------------
create or replace function public.get_confirm_targets()
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
  where p.status            = 'attending'
    and p.confirm_status    = 'pending'
    and p.line_user_id      is not null
    and e.event_date        is not null
    and e.event_date        >= (now() at time zone 'Asia/Tokyo')::date
    and (e.event_date - (now() at time zone 'Asia/Tokyo')::date) <= e.confirm_days_before
$$;

revoke all on function public.get_confirm_targets() from public, anon, authenticated;
grant execute on function public.get_confirm_targets() to service_role;

-- ----------------------------------------------------------------------------
-- public.count_unlinked_confirm_targets()
-- 未紐付け参加者のスキップ件数を返す（スキップログ用 — D-11）
-- service_role のみ実行可（T-02-03）
-- ----------------------------------------------------------------------------
create or replace function public.count_unlinked_confirm_targets()
returns integer
language sql stable
set search_path = ''
as $$
  select count(*)::integer
  from public.participants p
  join public.event_platform_urls epu  on epu.id = p.event_platform_url_id
  join public.events              e    on e.id   = epu.event_id
  where p.status            = 'attending'
    and p.confirm_status    = 'pending'
    and p.line_user_id      is null
    and e.event_date        is not null
    and e.event_date        >= (now() at time zone 'Asia/Tokyo')::date
    and (e.event_date - (now() at time zone 'Asia/Tokyo')::date) <= e.confirm_days_before
$$;

revoke all on function public.count_unlinked_confirm_targets() from public, anon, authenticated;
grant execute on function public.count_unlinked_confirm_targets() to service_role;

-- ----------------------------------------------------------------------------
-- cron.schedule: 日次配信トリガー（01:00 UTC = 10:00 JST）
-- ジョブ本文はVaultシークレット名参照のみ — URLもキー値もリテラルで書かない（T-02-01）
-- timeout_milliseconds = 30000（RESEARCH Pitfall 10の安全値）
-- ----------------------------------------------------------------------------
select cron.schedule(
  'confirm-broadcast-daily',
  '0 1 * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/message-sender',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_function_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
