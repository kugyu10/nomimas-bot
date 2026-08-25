-- ポーリング cron の対象を platform='twipla' に絞る
--
-- 何が問題だったか（PRレビュー指摘 low/L8）:
--   20260825010000 が登録した 'twipla-scrape-poll' のファンアウトSQLは、
--   event_platform_urls を **platform 条件なし**で拾っていた。
--   ジョブ名もコメントも Twipla 前提なのに、実装だけが全プラットフォームを対象にしていた。
--
--   開催窓内のイベントに Twipla 以外（Peatix / ジモティー等）のURLが登録されていると、
--   15分ごとに永続的に scraper へ POST し、そのたびに
--   400 {"error":"unsupported url"} が返る（scraper の resolveProvider が
--   hostname 許可リストで弾くため）。
--
--   さらに悪いことに、これは**何にも表面化しない**:
--     - net.http_post は非同期なので cron.job_run_details は 'succeeded' のまま
--     - return_message も対象行数を返すだけで、応答が 400 でも変わらない
--   つまり無駄打ちが延々と続くのに、運用上まったく気づけない。
--
-- この修正:
--   ファンアウトの where に `and epu.platform = 'twipla'` を足す。
--   将来ほかのプラットフォームを足すときは、プロバイダごとに別ジョブを立てるか、
--   ジョブ名を汎用にしたうえでこの条件を広げること
--   （scraper 側は registry で解決するのでURLを渡せば動くが、
--     「叩いても弾かれるURLを叩き続けない」ことを cron 側でも担保しておく）。
--
-- 冪等性: 既存の流儀どおり「存在すれば unschedule してから schedule」。
--   本文はスケジュール以外 20260825010000 と同一（where 句に1行足しただけ）。

do $$
begin
  if exists (select 1 from cron.job where jobname = 'twipla-scrape-poll') then
    perform cron.unschedule('twipla-scrape-poll');
  end if;
end;
$$;

select cron.schedule(
  'twipla-scrape-poll',
  '*/15 * * * *',
  $sql$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/scraper',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_function_key'
      )
    ),
    body := jsonb_build_object('url', epu.url),
    timeout_milliseconds := 30000
  )
  from public.event_platform_urls epu
  join public.events e on e.id = epu.event_id
  where epu.platform = 'twipla'
    and e.event_date is not null
    and e.event_date >= (now() at time zone 'Asia/Tokyo')::date
    and (e.event_date - (now() at time zone 'Asia/Tokyo')::date)
        <= greatest(e.confirm_days_before, 3)
  $sql$
);
