-- コアテーブル作成マイグレーション
-- Phase 1: 基盤構築 + スクレイピング検証
-- 全テーブルは id uuid primary key + created_at timestamptz を持つ

-- LINE OA（公式アカウント）ごとの設定を保持するテーブル
-- OA-01: LINE OAごとに定型文・質問内容・管理者Twitter IDを設定できる
create table public.oa_configs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  line_channel_id text,
  admin_twitter_id text,
  greeting_message text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- OA管理者メンバー（owner / co-owner）
-- OA-02: 複数のLINE OAを1つの管理画面で管理できる（権限: root/owner/co-ownerの3段階）
-- rootはauth.usersのapp_metadataで表現予定（Phase 3/4で本格運用）
create table public.oa_members (
  id uuid primary key default gen_random_uuid(),
  oa_config_id uuid not null references public.oa_configs(id) on delete cascade,
  auth_user_id uuid not null,
  role text not null check (role in ('owner', 'co-owner')),
  created_at timestamptz not null default now(),
  unique(oa_config_id, auth_user_id)
);

-- イベント情報テーブル
-- EVENT-01: 管理者はイベントを作成できる（複数のイベントプラットフォームURL、集合時刻・場所・参加費・店情報を登録）
create table public.events (
  id uuid primary key default gen_random_uuid(),
  oa_config_id uuid not null references public.oa_configs(id) on delete cascade,
  title text not null,
  event_date date,
  meeting_at timestamptz,
  meeting_place text,
  fee text,
  venue_info text,
  confirm_days_before integer not null default 3,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- イベントプラットフォームURL（Twipla / 将来的にPeatix / ジモティー等への拡張）
-- EVENT-02: 管理者はイベントプラットフォームURLから参加者リストを自動取得できる
create table public.event_platform_urls (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  platform text not null,
  url text not null unique,
  created_at timestamptz not null default now()
);

-- LINE友だちユーザー
-- LINE-01/02/03: LINE最終確認配信・1問1答・回答収集の受信者
create table public.line_users (
  id uuid primary key default gen_random_uuid(),
  oa_config_id uuid references public.oa_configs(id) on delete set null,
  line_user_id text not null unique,
  display_name text,
  followed_at timestamptz,
  created_at timestamptz not null default now()
);

-- イベント参加者テーブル（スクレイピング結果の保持）
-- EVENT-02: Twiplaスクレイピング結果をupsert
-- ADMIN-02: LINEユーザーとの手動紐付け（Phase 3）のため line_user_id はnullable
-- natural_key: 参加者の同一性キー（CR-01対応）
--   display_name はユーザーが自由に変更でき一意性がないため、scraper が
--   coalesce(screen_name, 'dn:' || display_name) 相当の値を計算して格納する
--   （'dn:' プレフィックスで screen_name 値と display_name フォールバック値の衝突を防ぐ）
-- unique制約(event_platform_url_id, natural_key) がscraper upsertのonConflictターゲット
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  event_platform_url_id uuid not null references public.event_platform_urls(id) on delete cascade,
  display_name text not null,
  screen_name text,
  profile_url text,
  natural_key text not null,
  status text not null check (status in ('attending', 'interested', 'declined', 'unknown')),
  source_platform text not null default 'twipla',
  line_user_id uuid references public.line_users(id) on delete set null,
  confirm_status text not null default 'pending',
  scraped_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(event_platform_url_id, natural_key)
);

-- 1問1答の回答テーブル（Phase 2で書き込み。スキーマのみ先行）
-- LINE-02/03: 1問1答形式の定型質問への回答を保存
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  question_key text not null,
  question_text text,
  answer text,
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(participant_id, question_key)
);

-- updated_at 自動更新トリガー（WR-05対応）
-- UPDATE時に updated_at を now() に更新する。upsert（ON CONFLICT DO UPDATE）でも発火するため
-- scraper の再スクレイプで updated_at が正しく動く
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger oa_configs_set_updated_at
  before update on public.oa_configs
  for each row execute function public.set_updated_at();

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

create trigger participants_set_updated_at
  before update on public.participants
  for each row execute function public.set_updated_at();
