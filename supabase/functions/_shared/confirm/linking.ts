// LINE友だち → participants の自己申告紐付け（合言葉＝Xアカウント名）。issue #3 / 案B
// フロー: 「@name」を送る → 「◯◯さんですか？」クイックリプライ → はいで確定

import type { SupabaseClient } from "@supabase/supabase-js";

const SCREEN_NAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const URL_PATTERN = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#\s]+)/i;

/**
 * 「@name」または x.com / twitter.com のURLからXアカウント名を取り出す。
 * 普通の会話（@も URL も無い）を拾わないよう、明示的な形のときだけ非nullを返す。
 */
export function normalizeScreenName(text: string | null): string | null {
  if (text === null) return null;
  const t = text.normalize("NFKC").trim();
  let candidate: string | null = null;
  const url = URL_PATTERN.exec(t);
  if (url) {
    candidate = url[1].replace(/^@/, "");
  } else if (t.startsWith("@")) {
    candidate = t.slice(1);
  }
  if (candidate === null || !SCREEN_NAME_PATTERN.test(candidate)) return null;
  return candidate;
}

export interface LinkConfirmPayload {
  screenName: string;
  accepted: boolean;
}

export function encodeLinkConfirmData(p: LinkConfirmPayload): string {
  return new URLSearchParams({
    k: "link",
    s: p.screenName,
    y: p.accepted ? "1" : "0",
  }).toString();
}

export function decodeLinkConfirmData(data: string): LinkConfirmPayload | null {
  const params = new URLSearchParams(data);
  if (params.get("k") !== "link") return null;
  const s = params.get("s");
  const y = params.get("y");
  if (s === null || !SCREEN_NAME_PATTERN.test(s)) return null;
  if (y !== "1" && y !== "0") return null;
  return { screenName: s, accepted: y === "1" };
}

export function buildLinkConfirmMessage(
  displayName: string,
  screenName: string,
): object {
  return {
    type: "text",
    text: `「${displayName}」さん（@${screenName}）でよろしいですか？`,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "はい",
            displayText: "はい",
            data: encodeLinkConfirmData({ screenName, accepted: true }),
          },
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "いいえ",
            displayText: "いいえ",
            data: encodeLinkConfirmData({ screenName, accepted: false }),
          },
        },
      ],
    },
  };
}

const text = (t: string) => ({ type: "text", text: t });

// 該当なし／すでに別のLINEに紐付き済みは区別せず同じ文言（他人の参加状況を探らせない）
export const LINK_NOT_FOUND_MESSAGE = text(
  "参加者の中にそのXアカウントが見つかりませんでした。\nTwiplaで参加表明した @から始まるXアカウント名をもう一度お送りください。",
);
export const LINK_DONE_MESSAGE = text(
  "紐付けが完了しました。イベント前の確認連絡をお待ちください。",
);
export const LINK_CANCEL_MESSAGE = text(
  "承知しました。もう一度、@から始まるXアカウント名をお送りください。",
);

/** メッセージ受信時: 紐付け候補があれば確認、@形式で候補なしなら案内。対象外は null（応答しない） */
export async function handleLinkMessage(
  supabase: SupabaseClient,
  oaConfigId: string,
  messageText: string | null,
): Promise<object[] | null> {
  const screenName = normalizeScreenName(messageText);
  if (screenName === null) return null;
  const { data, error } = await supabase.rpc("find_link_candidate", {
    p_oa_config_id: oaConfigId,
    p_screen_name: screenName,
  });
  if (error) {
    console.error(`webhook: find_link_candidate failed: ${error.message}`);
    return null;
  }
  const row = (data as { display_name: string }[] | null)?.[0];
  if (!row) return [LINK_NOT_FOUND_MESSAGE];
  return [buildLinkConfirmMessage(row.display_name, screenName)];
}

/** 確認postback受信時: はい → 紐付け確定、いいえ → やり直し案内。形式不一致は null */
export async function handleLinkConfirm(
  supabase: SupabaseClient,
  oaConfigId: string,
  lineUserUuid: string,
  data: string,
): Promise<object[] | null> {
  const payload = decodeLinkConfirmData(data);
  if (!payload) return null;
  if (!payload.accepted) return [LINK_CANCEL_MESSAGE];
  const { data: count, error } = await supabase.rpc("link_by_screen_name", {
    p_oa_config_id: oaConfigId,
    p_line_user_id: lineUserUuid,
    p_screen_name: payload.screenName,
  });
  if (error) {
    console.error(`webhook: link_by_screen_name failed: ${error.message}`);
    return null;
  }
  return (count as number) > 0 ? [LINK_DONE_MESSAGE] : [LINK_NOT_FOUND_MESSAGE];
}
