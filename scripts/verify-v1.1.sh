#!/usr/bin/env bash
# scripts/verify-v1.1.sh
# v1.1「Twipla自動ポーリング → 直前参加者まで確認配信が届く」の合格判定スクリプト。
#
# 5つの合格条件をすべて機械判定する。1つでも落ちたら非ゼロ終了。
#
#   1. 実Twipla(741123)を fetch→parse→dev DB upsert でき、
#      さらに2回連続ポーリングで差分ゼロ（誤検知で通知を撃たない）
#   2. 保存済み実HTMLを加工した擬似ポーリングで遷移が発火する
#      （新規追加 / attending→declined / declined→attending /
#        離脱=ページから行ごと消える / 離脱からの復帰）
#   3. dev で cron が実際に発火した記録がある（cron.job_run_details に1行以上）
#   4. dev OA から本人宛ての実送信が sent:1 としてログに残っている
#   5. 既存が壊れていない（admin vitest / eslint / next build / deno test すべて exit 0、
#      テスト件数がベースラインから減っていない）
#
# 使い方（リポジトリルートから）:
#   bash scripts/verify-v1.1.sh
#
# 環境変数:
#   VERIFY_SKIP_LIVE=1  条件1の実ネットワークアクセスを飛ばす（オフライン時のみ）
#   V11_ENV_FILE        .env.local の場所（worktree で検証するとき用）
#
# 注意: このマシンには `timeout` コマンドが無い。使わないこと。

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

export CI=1 PAGER=cat GIT_PAGER=cat GIT_TERMINAL_PROMPT=0
# deno test は色付き出力に ANSI エスケープを挟むため、件数 grep が空振りする。必ず無効化する。
export NO_COLOR=1

# ベースライン（2026-08-25 00:12 実測）。退行判定に使う。
BASELINE_VITEST_TESTS=76
# 退行検出のラチェット: **現在の実測値**に合わせる。
# 夜間開始時の 112 に据え置くと、152→115 のような 37 件の消失を通してしまう
# （比較は >= なので、余白がそのまま検出漏れになる）。
# テストを増やしたらこの値も上げる。意図してテストを減らすときだけ下げる。
BASELINE_DENO_PASSED=152

FAILED=0
declare -a RESULTS=()

pass() { RESULTS+=("PASS  $1"); printf '  \033[32m[PASS]\033[0m %s\n' "$1"; }
fail() { RESULTS+=("FAIL  $1"); printf '  \033[31m[FAIL]\033[0m %s\n' "$1"; FAILED=1; }
head1() { printf '\n=== %s ===\n' "$1"; }

# .env.local を読む（DB / Edge Function へのアクセスに必要）。値は絶対に出力しない。
# git worktree で検証する場合、.env.local は gitignore のため worktree 側に存在しない。
# その場合は V11_ENV_FILE で本体ツリーの .env.local を指すこと。
ENV_FILE="${V11_ENV_FILE:-${REPO_ROOT}/.env.local}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ENV_FILE"
  set +a
else
  echo "ABORT: env ファイルが見つかりません（${ENV_FILE}）。" >&2
  echo "       worktree で実行しているなら V11_ENV_FILE=<本体ツリー>/.env.local を指定してください。" >&2
  exit 2
fi

# dev 以外を絶対に触らないための安全弁（scripts/db/sql.ts と同じ ref を固定で持つ）
if [ "${DEV_PROJECT_REF:-}" != "cmsxvxtcdniqgvhxjqri" ]; then
  echo "ABORT: DEV_PROJECT_REF が dev ではありません。このスクリプトは dev 専用です。" >&2
  exit 2
fi

DENO_RUN=(deno run --allow-net --allow-read --allow-env --config "${REPO_ROOT}/deno.json")

# ---------------------------------------------------------------------------
# 条件2: 擬似ポーリングで3遷移が発火する（純関数テスト。ネットワーク不要）
#   先に走らせる: 一番安く、壊れていれば他を試す価値が無い
# ---------------------------------------------------------------------------
head1 "条件2: 擬似ポーリングの3遷移"
if deno test --config supabase/functions/deno.json --allow-read \
     supabase/functions/tests/twipla_polling_test.ts > /tmp/v11-cond2.log 2>&1; then
  # 遷移3種と誤検知なしの4項目が実際に走ったことを、テスト名で確認する
  # （ファイルが空でも exit 0 になるため、件数ゼロを通してしまわないようにする）
  n_cases="$(grep -c '\.\.\. *ok' /tmp/v11-cond2.log || true)"
  if [ "${n_cases:-0}" -ge 7 ]; then
    pass "条件2: twipla_polling_test.ts が ${n_cases} 件 ok（新規/attending→declined/declined→attending/離脱/離脱からの復帰/誤検知なし/capacity）"
  else
    fail "条件2: テストは exit 0 だが ok が ${n_cases} 件しかない（7件以上必要）"
    tail -20 /tmp/v11-cond2.log
  fi
else
  fail "条件2: twipla_polling_test.ts が失敗"
  tail -20 /tmp/v11-cond2.log
fi

# ---------------------------------------------------------------------------
# 条件1: 実Twipla を2回連続ポーリングして、保存でき・差分ゼロであること
# ---------------------------------------------------------------------------
head1 "条件1: 実Twipla(741123)の取得・保存と2連続ポーリングの差分ゼロ"
if [ "${VERIFY_SKIP_LIVE:-0}" = "1" ]; then
  fail "条件1: VERIFY_SKIP_LIVE=1 のためスキップした（スキップは合格にしない）"
elif [ ! -f scripts/v11/check-live-poll.ts ]; then
  fail "条件1: scripts/v11/check-live-poll.ts が存在しない（未実装）"
else
  if "${DENO_RUN[@]}" scripts/v11/check-live-poll.ts > /tmp/v11-cond1.log 2>&1; then
    pass "条件1: $(tail -1 /tmp/v11-cond1.log)"
  else
    fail "条件1: check-live-poll.ts が非ゼロ終了"
    tail -25 /tmp/v11-cond1.log
  fi
fi

# ---------------------------------------------------------------------------
# 条件1b: 取り込んだ参加者が「最終確認の配信対象」になっている
#   ゴール文の「直前参加者まで確認配信が自動で届く」の橋渡しを直接測る
# ---------------------------------------------------------------------------
head1 "条件1b: 取り込んだ参加者が最終確認の配信対象になっているか"
if [ ! -f scripts/v11/check-confirm-target.ts ]; then
  fail "条件1b: scripts/v11/check-confirm-target.ts が存在しない（未実装）"
else
  if "${DENO_RUN[@]}" scripts/v11/check-confirm-target.ts > /tmp/v11-cond1b.log 2>&1; then
    pass "条件1b: $(tail -1 /tmp/v11-cond1b.log)"
  else
    fail "条件1b: check-confirm-target.ts が非ゼロ終了"
    tail -25 /tmp/v11-cond1b.log
  fi
fi

# ---------------------------------------------------------------------------
# 条件3: dev で cron が実際に発火した記録がある
# ---------------------------------------------------------------------------
head1 "条件3: dev の cron が実際に発火した記録"
if [ ! -f scripts/v11/check-cron-fired.ts ]; then
  fail "条件3: scripts/v11/check-cron-fired.ts が存在しない（未実装）"
else
  if "${DENO_RUN[@]}" scripts/v11/check-cron-fired.ts > /tmp/v11-cond3.log 2>&1; then
    pass "条件3: $(tail -1 /tmp/v11-cond3.log)"
  else
    fail "条件3: check-cron-fired.ts が非ゼロ終了"
    tail -25 /tmp/v11-cond3.log
  fi
fi

# ---------------------------------------------------------------------------
# 条件4: dev OA から本人宛ての実送信が sent:1 としてログに残っている
#   （このスクリプトは送信しない。観測するだけ。送信は
#    scripts/v11/send-one-real-message.ts が一度だけ行う）
# ---------------------------------------------------------------------------
head1 "条件4: 本人宛て実送信の sent:1 記録"
if [ ! -f scripts/v11/check-line-sent.ts ]; then
  fail "条件4: scripts/v11/check-line-sent.ts が存在しない（未実装）"
else
  if "${DENO_RUN[@]}" scripts/v11/check-line-sent.ts > /tmp/v11-cond4.log 2>&1; then
    pass "条件4: $(tail -1 /tmp/v11-cond4.log)"
  else
    fail "条件4: check-line-sent.ts が非ゼロ終了"
    tail -25 /tmp/v11-cond4.log
  fi
fi

# ---------------------------------------------------------------------------
# 条件4b: 配信頻度を上げても二重送信にならない
#   当日参加者の穴を塞ぐため確認配信を日中30分ごとに起動するようにした。
#   同じ参加者に何度も送らないことが構造的に保証されているかを測る。
# ---------------------------------------------------------------------------
head1 "条件4b: 配信頻度を上げても二重送信にならないか"
if [ ! -f scripts/v11/check-no-duplicate-confirm.ts ]; then
  fail "条件4b: scripts/v11/check-no-duplicate-confirm.ts が存在しない（未実装）"
else
  if "${DENO_RUN[@]}" scripts/v11/check-no-duplicate-confirm.ts > /tmp/v11-cond4b.log 2>&1; then
    pass "条件4b: $(tail -1 /tmp/v11-cond4b.log)"
  else
    fail "条件4b: check-no-duplicate-confirm.ts が非ゼロ終了"
    tail -25 /tmp/v11-cond4b.log
  fi
fi

# ---------------------------------------------------------------------------
# 条件4c: 確認配信を起動する cron ジョブが同一分に発火しない
#   条件4b（confirm_status フィルタ）は逐次実行の重複だけを防ぐ。
#   同時実行の競合は別問題なので、発火分の衝突を機械で見る。
# ---------------------------------------------------------------------------
head1 "条件4c: 配信ジョブの同一分衝突がないか"
if [ ! -f scripts/v11/check-cron-no-collision.ts ]; then
  fail "条件4c: scripts/v11/check-cron-no-collision.ts が存在しない（未実装）"
else
  if "${DENO_RUN[@]}" scripts/v11/check-cron-no-collision.ts > /tmp/v11-cond4c.log 2>&1; then
    pass "条件4c: $(tail -1 /tmp/v11-cond4c.log)"
  else
    fail "条件4c: check-cron-no-collision.ts が非ゼロ終了"
    tail -25 /tmp/v11-cond4c.log
  fi
fi

# ---------------------------------------------------------------------------
# 条件5: 既存が壊れていない（退行判定つき）
# ---------------------------------------------------------------------------
head1 "条件5: 既存の回帰チェック"

# admin の依存が無い環境（clean な git worktree など。node_modules は gitignore）でも
# 自己完結して走れるようにする。独立検証を worktree で行うと必ずここで詰まるため、
# 「環境が整っていない」を「ゴール未達」と誤判定しないように自分で用意する。
if [ ! -d admin/node_modules ]; then
  echo "  admin/node_modules が無いので依存をインストールします（初回のみ・数十秒かかります）"
  if [ -f admin/package-lock.json ]; then
    (cd admin && npm ci > /tmp/v11-npm.log 2>&1)
  else
    (cd admin && npm install > /tmp/v11-npm.log 2>&1)
  fi
  if [ ! -d admin/node_modules ]; then
    fail "条件5: admin の依存インストールに失敗した（/tmp/v11-npm.log を見ること）"
    tail -20 /tmp/v11-npm.log
  else
    echo "  依存インストール完了"
  fi
fi

# 5-1 admin vitest（件数がベースラインから減っていないことも見る）
if (cd admin && npx vitest run > /tmp/v11-vitest.log 2>&1); then
  n_tests="$(grep -oE 'Tests +[0-9]+ passed' /tmp/v11-vitest.log | grep -oE '[0-9]+' | head -1)"
  if [ -n "${n_tests:-}" ] && [ "$n_tests" -ge "$BASELINE_VITEST_TESTS" ]; then
    pass "条件5-1: admin vitest exit 0 / ${n_tests} tests passed（baseline ${BASELINE_VITEST_TESTS} 以上）"
  else
    fail "条件5-1: admin vitest は exit 0 だがテスト件数が ${n_tests:-不明}（baseline ${BASELINE_VITEST_TESTS} を下回る）"
  fi
else
  fail "条件5-1: admin vitest が失敗"
  tail -20 /tmp/v11-vitest.log
fi

# 5-2 admin eslint
if (cd admin && npx eslint > /tmp/v11-eslint.log 2>&1); then
  pass "条件5-2: admin eslint exit 0"
else
  fail "条件5-2: admin eslint が非ゼロ終了"
  tail -20 /tmp/v11-eslint.log
fi

# 5-3 admin next build
if (cd admin && npm run build > /tmp/v11-build.log 2>&1); then
  pass "条件5-3: admin next build exit 0"
else
  fail "条件5-3: admin next build が失敗"
  tail -20 /tmp/v11-build.log
fi

# 5-4 supabase/functions の型チェック
#
# なぜ独立したステップが要るか（PR #5 レビュー3 の指摘）:
#   `deno test` は**テストのモジュールグラフしか型検査しない**。
#   notifier.ts はどのテストからも import されていないため一度も型チェックされず、
#   オブジェクトリテラルのキー重複（TS1117）が全12項目PASSをすり抜けた。
#   値が同一だと実行時は無害（JSは後勝ち）で dev の実証も通り、
#   `supabase functions deploy` は esbuild でトランスパイルするだけなのでデプロイも通る。
#   = 「動くけどビルドが壊れている」状態を誰も検出できなかった。
#   admin 側は `next build` が型検査を兼ねているが、functions 側にその役目が無かった。
head1 "条件5-0: supabase/functions の型チェック"
FUNC_TS_FILES="$(find supabase/functions -name '*.ts' | sort | tr '\n' ' ')"
if [ -z "$FUNC_TS_FILES" ]; then
  fail "条件5-0: supabase/functions に .ts が見つからない"
elif deno check --config supabase/functions/deno.json $FUNC_TS_FILES > /tmp/v11-denocheck.log 2>&1; then
  n_files="$(printf '%s' "$FUNC_TS_FILES" | wc -w | tr -d ' ')"
  pass "条件5-0: deno check exit 0（${n_files} ファイル。テストから参照されないファイルも含む）"
else
  fail "条件5-0: deno check が失敗（型エラー）"
  grep -E "^(TS[0-9]+|error)" /tmp/v11-denocheck.log | head -10
fi

# 5-4 supabase/functions の deno test（件数がベースラインから減っていないことも見る）
if deno test --config supabase/functions/deno.json --allow-all supabase/functions/tests/ \
     > /tmp/v11-deno.log 2>&1; then
  n_passed="$(grep -oE 'ok \| [0-9]+ passed' /tmp/v11-deno.log | grep -oE '[0-9]+' | head -1)"
  if [ -n "${n_passed:-}" ] && [ "$n_passed" -ge "$BASELINE_DENO_PASSED" ]; then
    pass "条件5-4: deno test exit 0 / ${n_passed} passed（baseline ${BASELINE_DENO_PASSED} 以上）"
  else
    fail "条件5-4: deno test は exit 0 だが passed が ${n_passed:-不明}（baseline ${BASELINE_DENO_PASSED} を下回る）"
  fi
else
  fail "条件5-4: deno test が失敗"
  tail -30 /tmp/v11-deno.log
fi

# 5-5 検査の握りつぶしが新規に入っていないこと
head1 "握りつぶし検査（skip / eslint-disable / @ts-ignore の新規追加）"
MERGE_BASE="$(git merge-base main HEAD 2>/dev/null || echo '')"
if [ -z "$MERGE_BASE" ]; then
  fail "握りつぶし検査: main との merge-base が取れなかった"
else
  # スキャナ自身（このファイルはパターン文字列そのものを含む）と、
  # トークンを引用しうる Markdown は対象から外す。コードは全て対象に残す。
  SUPPRESS="$(git diff "${MERGE_BASE}..HEAD" -- . \
    ':(exclude)scripts/verify-v1.1.sh' ':(exclude)*.md' \
    | grep -E '^\+' \
    | grep -Ev '^\+\+\+' \
    | grep -E '\b(it|test|describe)\.skip\b|\b(it|test|describe)\.only\b|xfail|--passWithNoTests|eslint-disable|@ts-ignore|@ts-nocheck|biome-ignore|Deno\.test\(\{[^)]*ignore: *true' \
    || true)"
  if [ -z "$SUPPRESS" ]; then
    pass "握りつぶし検査: 新規追加なし"
  else
    fail "握りつぶし検査: 以下が新規追加されている"
    printf '%s\n' "$SUPPRESS" | head -20
  fi
fi

# ---------------------------------------------------------------------------
# 総合判定
# ---------------------------------------------------------------------------
head1 "総合判定"
for r in "${RESULTS[@]}"; do printf '  %s\n' "$r"; done
echo
if [ "$FAILED" -eq 0 ]; then
  echo "VERIFY-V1.1: PASS（5条件すべて満たした）"
  exit 0
else
  echo "VERIFY-V1.1: FAIL（上の FAIL 行を見ること）"
  exit 1
fi
