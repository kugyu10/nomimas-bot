-- participants.status に 'left'（参加取消 = ページから消えた）を追加する
--
-- 何のためか（issue #2）:
--   Twipla では参加を取り消すと参加者の行そのものがページから消える。
--   これはセクション間の移動（attending → declined 等）とは別の変化で、
--   これまで diffParticipants は incoming をループするだけだったため**完全に不可視**だった。
--
--   結果として:
--     - 主催者に「減った」ことが通知されない（増加は new として通知される）
--     - DB の行は attending のまま残り、get_confirm_targets が
--       もう来ない人を確認配信の対象に含め続ける
--     - scraper は行を削除しないので scraped_at も古いまま据え置かれる
--
-- なぜ新しい status 値にしたのか（departed_at 列を足す案との比較）:
--   get_confirm_targets は cron モード・手動モードのどちらも
--   `p.status = 'attending'` で絞っている（20260612120000:53,85）。
--   離脱者を 'left' にすれば、**その関数を一切変えずに**配信対象から外れる。
--   departed_at 列にすると get_confirm_targets の両分岐に条件を足す必要があり、
--   message-sender の挙動に影響する変更の範囲が広がる。
--   admin 側も participants.status のラベル表を持っていないため UI 変更は不要
--   （ダッシュボードの status='attending' カウントは離脱者が外れて正確になる）。
--
--   副作用として status が「ページのどのセクションに居たか」と「もう載っていない」を
--   兼ねることになるが、status を「最後に観測した状態」と読めば一貫している。
--
-- 誤検知への防御:
--   パースが構造的に成功しても中身が取れなかった場合、「全員が離脱した」と誤記録すると
--   全員が確認配信の対象から外れる。これは最悪の失敗なので、
--   `shouldApplyDepartures`（_shared/notify/diff.ts）が
--   「既存が居るのに今回0件」のときは適用しない。
--   さらに `sectionCount === 0` のHTMLは scraper が取得失敗として早期 return する
--   （20260825 の誤検知防御）。この2段で守っている。
--
-- ロールバック:
--   'left' の行が存在する状態で制約を元の4値に戻すと制約違反になる。戻すなら先に
--   `update public.participants set status = 'declined' where status = 'left';` 等で
--   値を移してから制約を差し替えること。

alter table public.participants
  drop constraint if exists participants_status_check;

alter table public.participants
  add constraint participants_status_check
  check (status in ('attending', 'interested', 'declined', 'unknown', 'left'));
