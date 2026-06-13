-- cron基盤マイグレーション
-- Phase 2 Plan 01: pg_cron/pg_net有効化 + 配信対象抽出関数 + cron.schedule（Vault参照型）
-- 注意: cron拡張はdb resetで消えるため必ずマイグレーションに置く（02-RESEARCH Pitfall 1実証済み）

-- 拡張有効化
-- pg_catalogスキーマに入る（Supabase managed）
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- public.get_confirm_targets(p_event_id uuid default null)
-- 配信対象参加者を返す（attending ∧ pending ∧ 紐付け済み）。
--   p_event_id = null  : cron 自動配信モード — 全OA・N日前の窓内イベントのみ
--   p_event_id 指定     : 管理画面の手動配信モード — そのイベントに絞り、窓を無視
--                         （主催者が任意のタイミングで「今すぐ送る」ため）
-- service_role のみ実行可（T-02-03）。手動モードの認可は message-sender 側で
-- ユーザーJWT経由のイベントアクセス検証（RLS）により担保する。
-- ----------------------------------------------------------------------------
-- 旧シグネチャ（引数なし）を破棄してからデフォルト引数版を作る
-- （0引数版とデフォルト引数版が共存すると get_confirm_targets() が曖昧になるため）
drop function if exists public.get_confirm_targets();
create or replace function public.get_confirm_targets(p_event_id uuid default null)
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
    and (
      -- 手動モード: 指定イベントに絞り、N日前の窓は無視
      (p_event_id is not null and e.id = p_event_id)
      or
      -- cron モード: 全イベント・窓内のみ
      (p_event_id is null
        and e.event_date is not null
        and e.event_date >= (now() at time zone 'Asia/Tokyo')::date
        and (e.event_date - (now() at time zone 'Asia/Tokyo')::date) <= e.confirm_days_before)
    )
$$;

revoke all on function public.get_confirm_targets(uuid) from public, anon, authenticated;
grant execute on function public.get_confirm_targets(uuid) to service_role;

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
-- WR-01: x-cron-key ヘッダで message-sender の専用シークレット照合を通過する
--   （Vault 'cron_shared_secret' は scripts/setup-dev.ts が env から投入）
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
      ),
      'x-cron-key', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_shared_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- ----------------------------------------------------------------------------
-- public.propagate_oa_links(p_oa_config_id uuid)
-- 同一OA内の「Xアカウント(screen_name)で既に紐付け済みの人」を、
-- 同OAの未紐付け participants（別イベント含む）にも自動で引き継ぐ。
--   - 同一人物の判定は screen_name（小文字化）で行う（display_name は表記揺れのため使わない）
--   - 既に紐付いている行は上書きしない（line_user_id is null のみ対象）
--   - 同一 screen_name が複数の line_user に紐付く異常時は updated_at 最新を採用
-- SECURITY INVOKER: 呼び出し元の権限で実行（ユーザー経由なら RLS でOAスコープに限定、
--   scraper の service role 経由なら RLS バイパス）。
-- 返り値: 更新した行数。
-- ----------------------------------------------------------------------------
create or replace function public.propagate_oa_links(p_oa_config_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  with known as (
    select distinct on (lower(pp.screen_name))
      lower(pp.screen_name) as sn,
      pp.line_user_id
    from public.participants pp
    join public.event_platform_urls epu on epu.id = pp.event_platform_url_id
    join public.events e on e.id = epu.event_id
    where e.oa_config_id = p_oa_config_id
      and pp.line_user_id is not null
      and coalesce(pp.screen_name, '') <> ''
    order by lower(pp.screen_name), pp.updated_at desc
  ),
  tgt as (
    select p.id, k.line_user_id
    from public.participants p
    join public.event_platform_urls epu on epu.id = p.event_platform_url_id
    join public.events e on e.id = epu.event_id
    join known k on k.sn = lower(p.screen_name)
    where e.oa_config_id = p_oa_config_id
      and p.line_user_id is null
      and coalesce(p.screen_name, '') <> ''
  )
  update public.participants p
  set line_user_id = tgt.line_user_id
  from tgt
  where p.id = tgt.id;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.propagate_oa_links(uuid) from public, anon;
grant execute on function public.propagate_oa_links(uuid) to authenticated, service_role;
