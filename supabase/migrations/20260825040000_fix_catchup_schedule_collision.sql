-- confirm-broadcast-catchup のスケジュール衝突を直す
--
-- 何が問題だったか（独立した反証プロセスが dev の実物から指摘）:
--   20260825030000 で追加した catchup ジョブのスケジュールは '*/30 0-12 * * *' だった。
--   `*/30` は分 {0, 30} を意味するため、時 {0..12} との組み合わせに **UTC 01:00 が含まれる**。
--   既存の confirm-broadcast-daily は '0 1 * * *' = UTC 01:00。
--   → 毎日 UTC 01:00（= JST 10:00）に **2本のジョブが同一分に同時発火**する。
--
--   さらに両ジョブの本文は完全に同一（dev 実測で md5 一致）であり、どちらも
--   message-sender を正しく認証して起動する。つまり本当に2回走る。
--
--   message-sender は「get_confirm_targets で対象を読む → LINE に push →
--   confirm_status='sent' に更新」という順序で動き、読み取りと書き込みの間に
--   LINE トークン発行などの await が複数挟まる
--   （supabase/functions/message-sender/index.ts:177-184, 252-262, 366, 371-375）。
--   排他制御（advisory lock / for update）はリポジトリのどこにも無い。
--   → 2本が並行すると、両方が同じ participant を pending として読み、両方が push し、
--     その後で両方が 'sent' に更新する。**同じ参加者に確認配信が2通届く。**
--
--   confirm_status による重複防止は「逐次に実行される限り」有効で、
--   「同時に実行された場合」は無効。20260825030000 のコメントはこの区別を欠いていた。
--
-- この修正:
--   catchup の発火分を :15 と :45 に移し、:00 に発火する既存ジョブと**分単位で重ならない**
--   ようにする。'15,45 0-12 * * *' = UTC の 0〜12 時台の :15 と :45
--   （= JST 09:15, 09:45, 10:15, ... 21:45）。
--   daily（UTC 01:00）と同じ分に発火することは無くなる。
--   カバー範囲（日中30分以内に取りこぼしを拾う）は変わらない。
--
-- これで十分か（正直に書く）:
--   **不十分。** 分をずらすのは衝突の「確率」を消すだけで、競合そのものは残る。
--   message-sender の1回の実行が15分以上かかれば次の catchup と重なりうる。
--   根本的には message-sender 側に排他が必要で、筋の良い直し方は
--   「push の前に confirm_status を原子的に確保する（claim-then-send）」:
--     update participants set confirm_status='sent'
--     where id = $1 and confirm_status='pending'
--   が1行更新したときだけ push する。これなら同時実行でも1回しか送られない
--   （送信失敗時に pending へ戻すかどうかは別途判断が必要）。
--   これは Edge Function のコード変更＝デプロイを伴うため、夜間には入れていない。
--   docs/v1.1-polling-design.md の付記3 を参照。
--
-- 冪等性: 既存の流儀どおり「存在すれば unschedule してから schedule」。

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
