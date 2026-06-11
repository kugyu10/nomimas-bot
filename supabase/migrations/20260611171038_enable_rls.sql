-- RLS有効化 + 最小ポリシー定義マイグレーション
-- Phase 1: deny-by-default + 各テーブル1本のSELECTポリシー（oa_members経由）
-- INSERT/UPDATE/DELETEポリシーはPhase 3で追加（Edge FunctionsはService Roleで動作しRLSをバイパスするため動作に影響なし）

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
-- 最小SELECTポリシー（oa_members経由でauth.uid()を判定）
-- ポリシー名: <table>_oa_member_select で統一
-- to authenticated を指定（未認証ユーザーはdeny-by-default）
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
        and m.auth_user_id = auth.uid()
    )
  );

-- oa_members: 自分自身の行のみ
create policy oa_members_oa_member_select
  on public.oa_members
  for select
  to authenticated
  using (auth_user_id = auth.uid());

-- events: 自テーブルのoa_config_id経由でoa_membersと結合
create policy events_oa_member_select
  on public.events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.oa_members m
      where m.oa_config_id = events.oa_config_id
        and m.auth_user_id = auth.uid()
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
        and m.auth_user_id = auth.uid()
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
        and m.auth_user_id = auth.uid()
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
        and m.auth_user_id = auth.uid()
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
        and m.auth_user_id = auth.uid()
    )
  );
