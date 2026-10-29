-- LINE友だちを「Xアカウント名の自己申告」で participants に紐付ける（issue #3 / 案B）
--
-- 2関数とも webhook（service role）専用。参加者の自己申告を扱うため、なりすましの
-- 横取りを避ける方向（安全側）に倒している:
--   - 紐付けるのは line_user_id が null の行だけ（既存の紐付けは上書きしない）
--   - 同一OA内で同じ screen_name が既に別のLINEユーザーに紐付いていたら何もしない
--   - 照合は lower(screen_name) の完全一致（LIKEのワイルドカードを使わない）

-- 確認プロンプト用: 紐付け可能な参加者の表示名を返す（無ければ0行）
create or replace function public.find_link_candidate(
  p_oa_config_id uuid,
  p_screen_name text
)
returns table (display_name text)
language sql
security invoker
set search_path = ''
as $$
  select p.display_name
  from public.participants p
  join public.event_platform_urls epu on epu.id = p.event_platform_url_id
  join public.events e on e.id = epu.event_id
  where e.oa_config_id = p_oa_config_id
    and lower(p.screen_name) = lower(p_screen_name)
    and p.line_user_id is null
    and not exists (
      select 1
      from public.participants q
      join public.event_platform_urls qepu on qepu.id = q.event_platform_url_id
      join public.events qe on qe.id = qepu.event_id
      where qe.oa_config_id = p_oa_config_id
        and lower(q.screen_name) = lower(p_screen_name)
        and q.line_user_id is not null
    )
  order by p.updated_at desc
  limit 1;
$$;

-- 確定: 同一OA内の未紐付け participants（別イベント含む）に line_user_id をセット。返り値は更新行数。
create or replace function public.link_by_screen_name(
  p_oa_config_id uuid,
  p_line_user_id uuid,
  p_screen_name text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if not exists (
    select 1 from public.line_users lu
    where lu.id = p_line_user_id and lu.oa_config_id = p_oa_config_id
  ) then
    return 0;
  end if;

  if exists (
    select 1
    from public.participants q
    join public.event_platform_urls qepu on qepu.id = q.event_platform_url_id
    join public.events qe on qe.id = qepu.event_id
    where qe.oa_config_id = p_oa_config_id
      and lower(q.screen_name) = lower(p_screen_name)
      and q.line_user_id is not null
      and q.line_user_id <> p_line_user_id
  ) then
    return 0;
  end if;

  update public.participants p
  set line_user_id = p_line_user_id
  from public.event_platform_urls epu, public.events e
  where epu.id = p.event_platform_url_id
    and e.id = epu.event_id
    and e.oa_config_id = p_oa_config_id
    and lower(p.screen_name) = lower(p_screen_name)
    and p.line_user_id is null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.find_link_candidate(uuid, text) from public, anon, authenticated;
revoke all on function public.link_by_screen_name(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.find_link_candidate(uuid, text) to service_role;
grant execute on function public.link_by_screen_name(uuid, uuid, text) to service_role;
