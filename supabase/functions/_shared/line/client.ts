/**
 * _shared/line/client.ts
 * LINE Messaging API 送信クライアント（push / reply）
 *
 * 設計方針（RESEARCH Pattern 4, RESEARCH Code Examples）:
 *  - messages.length が 1..5 以外は即 throw（LINE 上限: 1リクエスト≤5）
 *  - LINE_DRY_RUN === "1" のとき fetch せず構造化ログのみ（D-14 / E2E 機械検証）
 *  - isDryRun() は try/catch で包み、env 権限なし実行時も false に倒れる（安全側）
 *  - 実送信で非 2xx → status のみ含む Error を throw（レスポンスボディ・トークン・フル userId をログしない — T-02-08）
 *  - X-Line-Retry-Key は pushMessage にのみ付与（reply は仕様上不要）
 *
 * 依存:
 *  - Web Crypto / fetch（Deno 組み込み — 追加インストール不要）
 */

/** LINE API のメッセージ上限（1 リクエスト最大 5 バブル） */
const MAX_MESSAGES = 5;
const MIN_MESSAGES = 1;

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";
const LINE_PROFILE_ENDPOINT = "https://api.line.me/v2/bot/profile";

/**
 * LINE_DRY_RUN === "1" かどうかを判定する。
 * Deno.env.get が PermissionDenied を投げる環境（--allow-env なし）では
 * 安全側（false）に倒れる。
 */
function isDryRun(): boolean {
  try {
    return Deno.env.get("LINE_DRY_RUN") === "1";
  } catch {
    // env アクセス権限がない場合は安全側（false）に倒れる
    return false;
  }
}

/**
 * メッセージ数を検証する。1..5 の範囲外は Error を throw。
 */
function assertMessageCount(messages: object[]): void {
  if (messages.length < MIN_MESSAGES || messages.length > MAX_MESSAGES) {
    throw new Error(
      `messages の件数は ${MIN_MESSAGES}..${MAX_MESSAGES} である必要があります（現在: ${messages.length} 件）`,
    );
  }
}

/**
 * DRY_RUN モードの構造化ログ出力。
 * 宛先は末尾 6 字のみ（T-02-08: フル userId をログしない）。
 */
function logDryRun(
  type: "push" | "reply",
  to: string,
  messages: object[],
): void {
  const toMasked = to.length > 6 ? `***${to.slice(-6)}` : to;
  const messageTypes = messages.map((m) =>
    typeof (m as Record<string, unknown>)["type"] === "string"
      ? (m as Record<string, unknown>)["type"] as string
      : "unknown"
  );
  console.log(
    JSON.stringify({
      dryRun: true,
      action: type,
      to: toMasked,
      messageCount: messages.length,
      messageTypes,
    }),
  );
}

/**
 * LINE push メッセージを送信する。
 *
 * @param token - ステートレスチャネルアクセストークン（値をログしないこと）
 * @param to    - 送信先 LINE userId（"U..." 形式、line_users.line_user_id）
 * @param messages - 送信メッセージ（1..5 件）
 * @throws messages が 1..5 件以外の場合
 * @throws 非 2xx レスポンス（status コードのみ含む Error）
 */
export async function pushMessage(
  token: string,
  to: string,
  messages: object[],
): Promise<void> {
  // 1. メッセージ数 assert
  assertMessageCount(messages);

  // 2. DRY_RUN チェック（fetch 呼び出しより前）
  if (isDryRun()) {
    logDryRun("push", to, messages);
    return;
  }

  // 3. 実送信
  const res = await fetch(LINE_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "X-Line-Retry-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ to, messages }),
  });

  if (!res.ok) {
    // レスポンスボディ・トークン・フル userId はログしない（T-02-08）
    throw new Error(`LINE push failed: ${res.status}`);
  }
}

/**
 * LINE reply メッセージを送信する。
 *
 * @param token      - ステートレスチャネルアクセストークン（値をログしないこと）
 * @param replyToken - LINE replyToken（1 回限り・約 1 分有効）
 * @param messages   - 送信メッセージ（1..5 件）
 * @throws messages が 1..5 件以外の場合
 * @throws 非 2xx レスポンス（status コードのみ含む Error）
 */
export async function replyMessage(
  token: string,
  replyToken: string,
  messages: object[],
): Promise<void> {
  // 1. メッセージ数 assert
  assertMessageCount(messages);

  // 2. DRY_RUN チェック（fetch 呼び出しより前）
  if (isDryRun()) {
    logDryRun("reply", replyToken, messages);
    return;
  }

  // 3. 実送信（reply は X-Line-Retry-Key 不要）
  const res = await fetch(LINE_REPLY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!res.ok) {
    // レスポンスボディ・トークン値はログしない（T-02-08）
    throw new Error(`LINE reply failed: ${res.status}`);
  }
}

/** LINE プロフィール（表示名・アイコン）。取得できない場合は null。 */
export interface LineProfile {
  displayName: string;
  pictureUrl: string | null;
}

/**
 * LINE Profile API でフォロワーの表示名を取得する。
 *
 * follow webhook イベントには userId しか含まれないため、表示名は別途この
 * エンドポイント（GET /v2/bot/profile/{userId}）で取得する必要がある（ADMIN-02:
 * 管理者が人間として紐付けるには表示名が必須）。
 *
 * リゾルバとして使うため throw しない設計 — 失敗時は null を返し、呼び出し側
 * （follow ハンドラ）は表示名なしで line_users 行を作る（CR-02: null 上書きはしない）。
 *
 * @param token  ステートレスチャネルアクセストークン（値をログしない）
 * @param userId 取得対象の LINE userId（"U..."）
 * @returns 表示名を含む LineProfile、取得失敗時は null
 */
export async function getLineProfile(
  token: string,
  userId: string,
): Promise<LineProfile | null> {
  // 注: DRY_RUN ゲートはここには無い。DRY_RUN は「実ユーザーへの送信を止める」ための
  // フラグであり、プロフィール取得は副作用のない読み取り。dev でも実名を取得して
  // ADMIN-02 の紐付けを使えるようにする必要がある（ユニットテストは fetch をスタブ）。
  try {
    const res = await fetch(`${LINE_PROFILE_ENDPOINT}/${encodeURIComponent(userId)}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) {
      // ボディ・トークン・フル userId はログしない（T-02-08）
      console.error(`LINE profile fetch failed: ${res.status}`);
      return null;
    }
    const data = await res.json() as { displayName?: unknown; pictureUrl?: unknown };
    if (typeof data.displayName !== "string" || data.displayName.length === 0) {
      return null;
    }
    return {
      displayName: data.displayName,
      pictureUrl: typeof data.pictureUrl === "string" ? data.pictureUrl : null,
    };
  } catch (err) {
    console.error(`LINE profile fetch error: ${(err as Error).message}`);
    return null;
  }
}
