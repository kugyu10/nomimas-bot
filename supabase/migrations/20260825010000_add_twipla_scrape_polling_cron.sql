-- Twipla自動ポーリングcronマイグレーション
-- v1.1: 「通知ログsent:0」問題（手動スクレイプに依存していたため参加者変化を検知できていなかった）
-- への対処として、直近イベントのTwiplaページを15分ごとに自動で再取得する。
--
-- 設計方針（既に決定済み・本マイグレーションでは再検討しない）:
--   案A: cronジョブ本文のSQLで event_platform_urls を走査し、対象URLごとに
--        net.http_post で既存の scraper Edge Function を叩く。
--        新しいEdge Functionは作らない（デプロイに依存しない構成にするため）。
--
-- なぜ Vault 参照のみで URL/キーをリテラルで書かないか（20260612120000 の流儀を継承）:
--   マイグレーションファイルはリポジトリに平文でコミットされる。project_url や
--   cron_function_key（anonキー相当）をリテラルで埋めるとSECRETSがgit履歴に残ってしまう。
--   vault.decrypted_secrets からその都度 SELECT することで、シークレット本体は
--   Vault（setup-dev.ts / setup-prod-vault.ts が投入）にしか存在しない状態を保つ。
--
-- Twiplaへの負荷（1回の発火あたり最大リクエスト数）:
--   このジョブは「イベント」単位ではなく「event_platform_urls」の行単位で
--   net.http_post を1回発行する（1イベントに複数プラットフォームURLが登録されていれば
--   その分だけリクエストが増える）。対象は下記WHERE句の窓（未来日 かつ
--   confirm_days_before と3日のうち大きい方の日数以内）に入るイベントのみなので、
--   実運用規模（同時に近日イベントは数件程度）では1回の発火で数件〜十数件程度のPOSTに
--   収まる想定。15分間隔 × 1リクエスト数百ms程度なら Twipla 側への負荷は軽微だが、
--   イベント数が急増した場合はこのWHERE句の窓を絞るか間隔を延ばすことを検討する。
--
-- なぜ greatest(confirm_days_before, 3) か:
--   既存の最終確認LINE配信（confirm-broadcast-daily）の通知窓は「confirm_days_before日前
--   〜当日」（20260612120000 の get_confirm_targets 参照）。confirm_days_before の
--   デフォルトは7だが、イベント個別設定で3未満に短縮されているケースでも、
--   直前の参加者変動（キャンセル・新規参加）を最低3日分は捕捉できるようにするため
--   greatest() で下限3日を保証する。上振れ（confirm_days_before > 3）の場合はその値を
--   そのまま使う。
--
-- 冪等性について（dev で実機確認済み — 詳細は agents/cron.md 参照）:
--   pg_cron の cron.schedule(job_name, schedule, command) は同名ジョブが既に存在する場合、
--   同一 jobid のまま schedule/command を更新する（新規行を追加しない）ため、本マイグレーションを
--   複数回適用しても cron.job の行は増えない。ただし将来の pg_cron バージョン差異に
--   依存したくないため、意図を明示する目的で「存在すれば unschedule してから schedule」という
--   防御的な書き方を採用する（cron.unschedule はジョブが存在しない場合エラーになるため、
--   存在チェックをしてから呼ぶ）。

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
  where e.event_date is not null
    -- 終了済みイベント（event_date < 今日）は叩かない
    and e.event_date >= (now() at time zone 'Asia/Tokyo')::date
    -- confirm_days_before と3日のうち大きい方の日数以内のイベントのみ対象（上のコメント参照）
    and (e.event_date - (now() at time zone 'Asia/Tokyo')::date)
        <= greatest(e.confirm_days_before, 3)
  $sql$
);
