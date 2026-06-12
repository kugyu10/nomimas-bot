-- RLS有効化 + ポリシー定義マイグレーション
-- Phase 1: deny-by-default + 各テーブル1本のSELECTポリシー（oa_members経由）
-- Phase 3: INSERT/UPDATE ポリシー追加 + (select auth.uid()) initplan最適化 + owner自動登録RPC

-- =============================================================
-- Row Level Security 有効化（全7テーブル）
-- =============================================================

alter table public.oa_configs enable row level security;
alter table public.oa_members enable row level security;
alter table public.events enable row level security;
alter table public.event_platform_urls enable row level security;
alter table public.line_users enable row level security;
alter table public.participants enable row level security;
alter table public.answers enable row level security;

-- =============================================================
-- SELECTポリシー（oa_members経由でauth.uid()を判定）
-- ポリシー名: <table>_oa_member_select で統一
-- to authenticated を指定（未認証ユーザーはdeny-by-default）
-- (select auth.uid()) でinitplan最適化（行ごと再評価を避ける）
-- =============================================================

-- oa_configs: 自分がoa_membersに存在するOAのみ
create policy oa_configs_oa_member_select
  on public.oa_configs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.oa_members m
      where m.oa_config_id = oa_configs.id
        and m.auth_user_id = (select auth.uid())
    )
  );

-- oa_members: 自分自身の行のみ
create policy oa_members_oa_member_select
  on public.oa_members
  for select
  to authenticated
  using (auth_user_id = (select auth.uid()));

-- events: 自テーブルのoa_config_id経由でoa_membersと結合
create policy events_oa_member_select
  on public.events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.oa_members m
      where m.oa_config_id = events.oa_config_id
        and m.auth_user_id = (select auth.uid())
    )
  );

-- event_platform_urls: events をjoinしてoa_members確認
create policy event_platform_urls_oa_member_select
  on public.event_platform_urls
  for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      join public.oa_members m on m.oa_config_id = e.oa_config_id
      where e.id = event_platform_urls.event_id
        and m.auth_user_id = (select auth.uid())
    )
  );

-- line_users: 自テーブルのoa_config_id経由でoa_membersと結合
create policy line_users_oa_member_select
  on public.line_users
  for select
  to authenticated
  using (
    exists (
      select 1 from public.oa_members m
      where m.oa_config_id = line_users.oa_config_id
        and m.auth_user_id = (select auth.uid())
    )
  );

-- participants: event_platform_urls → events をjoinしてoa_members確認
create policy participants_oa_member_select
  on public.participants
  for select
  to authenticated
  using (
    exists (
      select 1 from public.event_platform_urls epu
      join public.events e on e.id = epu.event_id
      join public.oa_members m on m.oa_config_id = e.oa_config_id
      where epu.id = participants.event_platform_url_id
        and m.auth_user_id = (select auth.uid())
    )
  );

-- answers: participants → event_platform_urls → events をjoinしてoa_members確認
create policy answers_oa_member_select
  on public.answers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.participants p
      join public.event_platform_urls epu on epu.id = p.event_platform_url_id
      join public.events e on e.id = epu.event_id
      join public.oa_members m on m.oa_config_id = e.oa_config_id
      where p.id = answers.participant_id
        and m.auth_user_id = (select auth.uid())
    )
  );

-- =============================================================
-- Phase 3: 書込ポリシー（INSERT / UPDATE）
-- ポリシー名: <table>_oa_member_<op> で統一
-- to authenticated / using + with check = oa_members existsチェーン（同形）
-- DELETE ポリシーは作らない（deny-by-default維持。Phase 3 UIに削除操作なし）
-- answers / line_users / oa_members には書込ポリシーを追加しない
--   (answers/line_users → service role の Edge Functions のみ書込)
--   (oa_members → RPC経由のみ登録。直接INSERT権限は authenticated に与えない)
-- =============================================================

-- oa_configs: owner/co-owner が自OAの設定を更新できる
create policy oa_configs_oa_member_update
  on public.oa_configs
  for update
  to authenticated
  using (
    exists (
      select 1 from public.oa_members m
      where m.oa_config_id = oa_configs.id
        and m.auth_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.oa_members m
      where m.oa_config_id = oa_configs.id
        and m.auth_user_id = (select auth.uid())
    )
  );

-- events: 自OAのメンバーがイベントを作成できる
create policy events_oa_member_insert
  on public.events
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.oa_members m
      where m.oa_config_id = events.oa_config_id
        and m.auth_user_id = (select auth.uid())
    )
  );

-- events: 自OAのメンバーがイベントを更新できる
create policy events_oa_member_update
  on public.events
  for update
  to authenticated
  using (
    exists (
      select 1 from public.oa_members m
      where m.oa_config_id = events.oa_config_id
        and m.auth_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.oa_members m
      where m.oa_config_id = events.oa_config_id
        and m.auth_user_id = (select auth.uid())
    )
  );

-- event_platform_urls: 自OAのメンバーがURLを追加できる（v1はURL追加のみ。削除ポリシーなし）
create policy event_platform_urls_oa_member_insert
  on public.event_platform_urls
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.events e
      join public.oa_members m on m.oa_config_id = e.oa_config_id
      where e.id = event_platform_urls.event_id
        and m.auth_user_id = (select auth.uid())
    )
  );

-- participants: 自OAのメンバーが参加者の紐付けを更新できる
-- with check: 行自体が自OAであること + 紐付け先line_userも同一OAであること（ADMIN-02整合性ガード）
create policy participants_oa_member_update
  on public.participants
  for update
  to authenticated
  using (
    exists (
      select 1 from public.event_platform_urls epu
      join public.events e on e.id = epu.event_id
      join public.oa_members m on m.oa_config_id = e.oa_config_id
      where epu.id = participants.event_platform_url_id
        and m.auth_user_id = (select auth.uid())
    )
  )
  with check (
    -- 行自体が自OAであること（usingと同形）
    exists (
      select 1 from public.event_platform_urls epu
      join public.events e on e.id = epu.event_id
      join public.oa_members m on m.oa_config_id = e.oa_config_id
      where epu.id = participants.event_platform_url_id
        and m.auth_user_id = (select auth.uid())
    )
    -- 紐付け先line_userが同一OAに属すること（nullは許可）
    and (participants.line_user_id is null or exists (
      select 1 from public.line_users lu
      join public.event_platform_urls epu on epu.id = participants.event_platform_url_id
      join public.events e on e.id = epu.event_id
      where lu.id = participants.line_user_id and lu.oa_config_id = e.oa_config_id
    ))
  );

-- =============================================================
-- Phase 3: owner自動登録RPC
-- register_owner_by_identity(): auth.identitiesのX screen_nameと
-- oa_configs.admin_twitter_idを照合し、ownerとして自動登録する
-- SECURITY DEFINER + search_path='' でauth.identitiesを直接参照（偽装不能）
-- user_metadataは一切参照しない（T-03-01: 偽装可能なため）
-- モック経路（emailプロバイダーのみ）は0行を返すだけ（setup-dev.tsが直接oa_membersを投入）
-- =============================================================

create or replace function public.register_owner_by_identity()
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_screen_name text;
begin
  -- X (OAuth 2.0) providerのidentityからscreen_nameを取得（ユーザー書換不可）
  -- A1: 両キー（user_name / preferred_username）に対応するcoalesceで安全側に倒す
  select coalesce(
    i.identity_data ->> 'user_name',
    i.identity_data ->> 'preferred_username'
  ) into v_screen_name
  from auth.identities i
  where i.user_id = (select auth.uid())
    and i.provider in ('x', 'twitter')
  limit 1;

  -- モック経路: email providerのみのユーザーはidentityなしで0行を返す（冪等）
  if v_screen_name is null then
    return;
  end if;

  return query
  insert into public.oa_members (oa_config_id, auth_user_id, role)
  select c.id, (select auth.uid()), 'owner'
  from public.oa_configs c
  where v_screen_name = any(string_to_array(coalesce(c.admin_twitter_id, ''), ','))
  on conflict (oa_config_id, auth_user_id) do nothing
  returning oa_config_id;
end $$;

revoke all on function public.register_owner_by_identity() from public, anon;
grant execute on function public.register_owner_by_identity() to authenticated;

-- =============================================================
-- Phase 3 (03-REVIEW WR-04): イベント作成のアトミック化RPC
-- create_event_with_urls(): events INSERT + event_platform_urls INSERT を
-- 1関数 = 1トランザクションで実行する。
-- 旧実装は2文に分かれており、URL重複（unique制約 23505）で2文目が失敗すると
-- 孤児 events 行が残った（DELETEポリシーが無いためUIから掃除不能）。
-- SECURITY INVOKER: RLS は呼び出しユーザー権限のまま適用される
-- （events / event_platform_urls の INSERT with check がそのまま効く）
-- =============================================================

create or replace function public.create_event_with_urls(
  p_event jsonb,
  p_urls jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_url jsonb;
begin
  insert into public.events
    (oa_config_id, title, event_date, meeting_at,
     meeting_place, fee, venue_info, confirm_days_before)
  values (
    (p_event ->> 'oa_config_id')::uuid,
    p_event ->> 'title',
    (p_event ->> 'event_date')::date,
    (p_event ->> 'meeting_at')::timestamptz,
    p_event ->> 'meeting_place',
    p_event ->> 'fee',
    p_event ->> 'venue_info',
    coalesce((p_event ->> 'confirm_days_before')::integer, 7)
  )
  returning id into v_event_id;

  for v_url in select jsonb_array_elements(p_urls)
  loop
    insert into public.event_platform_urls (event_id, platform, url)
    values (v_event_id, v_url ->> 'platform', v_url ->> 'url');
  end loop;

  return v_event_id;
end $$;

revoke all on function public.create_event_with_urls(jsonb, jsonb) from public, anon;
grant execute on function public.create_event_with_urls(jsonb, jsonb) to authenticated;
