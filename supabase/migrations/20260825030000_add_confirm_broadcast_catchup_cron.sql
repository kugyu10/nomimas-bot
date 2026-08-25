-- 確認配信 catchup cron マイグレーション
-- v1.1: 「直前参加者まで確認配信が自動で届く」というゴールに対する致命的な反例への対処。
--
-- 反例（塞ぐ穴）:
--   最終確認配信は `confirm-broadcast-daily`（'0 1 * * *' UTC = 10:00 JST の1日1回だけ）が
--   message-sender を起動する（supabase/migrations/20260612120000_setup_cron_and_targets.sql）。
--   15分ごとの scraper ポーリング（20260825010000_add_twipla_scrape_polling_cron.sql）は
--   変化を検知して participants を更新するだけで、message-sender を起動しない
--   （supabase/functions/scraper/index.ts に message-sender の呼び出しは無い）。
--   get_confirm_targets の cron モードの窓は
--     e.event_date >= (now() at time zone 'Asia/Tokyo')::date
--     and (e.event_date - today) <= e.confirm_days_before
--   （20260612120000 の 61-64行付近）。
--   したがって、イベント当日の JST 10:00 以降に参加表明した人は:
--     ポーリングが15分後に検知して participants に取り込む
--       → しかしその日の 10:00 の配信はもう終わっている
--       → 翌日は event_date >= today が偽になり窓から落ちる
--       → 確認配信が一度も届かない。
--   ポーリング間隔を短くしても、配信そのものを起動する頻度（1日1回）がボトルネックの
--   ままなので解決しない。本マイグレーションは配信を起動する頻度を上げることで対処する。
--
-- なぜ頻度を上げても二重送信にならないか（既存実装で担保済み。読んで確認した）:
--   - get_confirm_targets は p.confirm_status = 'pending' の行だけを返す
--     （20260612120000_setup_cron_and_targets.sql:54, :86）。
--   - message-sender は push 成功直後に participants.confirm_status を 'sent' に更新する
--     （supabase/functions/message-sender/index.ts:373-382、コメントに「D-12: 重複防止」）。
--   → 一度送った参加者は次に catchup ジョブが走った時点で pending ではなくなっているため
--     get_confirm_targets の戻りに再び含まれない。同じ参加者が2回送信対象になることはない。
--
-- なぜ既存の confirm-broadcast-daily を一切変更せず、新しいジョブを1本追加するのか:
--   scripts/verify-cron.ts が「confirm-broadcast-daily が schedule='0 1 * * *' で存在すること」
--   を機械検証している。既存ジョブの名前やスケジュールを変更するとこの検査が落ちる。
--   新規ジョブを追加するだけであれば既存の検査は緑のまま保たれる。
--
-- なぜスケジュールが '15,45 0-12 * * *' なのか:
--   pg_cron は UTC で動く。JST = UTC+9 なので UTC の 0-12 時台は JST 09:00〜21:59 にあたる。
--   30分ごとに走らせることで「日中に取りこぼした当日参加者」を最大30分の遅延で拾う。
--   深夜（JST 22:00〜翌08:59）にはこのジョブを走らせない設計が重要:
--     深夜に確認配信が届くと本人のLINEに通知が飛んでしまう。'*/30 * * * *'（24時間）に
--     すると例えば JST 03:00 にも配信が起動してしまうため、意図的に 0-12 UTC に絞っている。
--   既存の confirm-broadcast-daily（10:00 JST 1日1回）はそのまま残るため、主たる配信タイミングは
--   変わらない。catchup ジョブは「日中に限りカバー範囲を広げる」ためだけに追加する。
--
--   【重要・後から修正】当初この値は「0-12時台に30分ごと」だった。しかしその書き方は
--   分 {0, 30} を含むため UTC 01:00 に発火し、既存の confirm-broadcast-daily
--   （'0 1 * * *' = UTC 01:00）と**同一分に同時発火**する。両ジョブの本文は同一で
--   どちらも message-sender を正しく起動するため、message-sender に排他が無い現状では
--   同じ参加者に確認配信が2通届く（confirm_status による重複防止は逐次実行にしか効かない）。
--   このマイグレーションが単独で適用された場合でも衝突しないよう、**発火分を :15 と :45 に
--   直してある**。発見の経緯と根本策は 20260825040000 と
--   docs/v1.1-polling-design.md の付記3 を参照。
--   （20260825040000 は、旧スケジュールで既に適用済みだった環境を直すために残してある。
--    このファイルと同じ '15,45 0-12 * * *' を設定するので、順に適用しても冪等。）
--   なお、この設計でも JST 22:00〜翌08:59 に参加表明した当日参加者はカバーされない
--   （docs/v1.1-polling-design.md の付記を参照。運用判断として残された穴）。
--
-- 冪等性について（20260825010000_add_twipla_scrape_polling_cron.sql の流儀を踏襲）:
--   pg_cron の cron.schedule(job_name, schedule, command) は同名ジョブが既に存在する場合、
--   同一 jobid のまま schedule/command を更新する（新規行を追加しない）。将来の pg_cron
--   バージョン差異に依存したくないため、意図を明示する目的で「存在すれば unschedule して
--   から schedule」という防御的な書き方を採用する。
--
-- ジョブ本文は既存の confirm-broadcast-daily と同一の Vault 参照パターンを踏襲する
-- （vault.decrypted_secrets から project_url / cron_function_key / cron_shared_secret を
-- その都度 SELECT する。URLもキーもリテラルで書かない。x-cron-key ヘッダも同様に必須。
-- timeout_milliseconds := 30000）。

do $$
begin
  if exists (select 1 from cron.job where jobname = 'confirm-broadcast-catchup') then
    perform cron.unschedule('confirm-broadcast-catchup');
  end if;
end;
$$;

select cron.schedule(
  'confirm-broadcast-catchup',
  '15,45 0-12 * * *',
  $sql$
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
  $sql$
);
