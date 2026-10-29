// LINE友だち → participants の自己申告紐付け（合言葉＝Xアカウント名）。issue #3 / 案B
// フロー: 「@name」を送る → 「◯◯さんですか？」クイックリプライ → はいで確定

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLinkClaimRejectedNotification, buildLinkedNotification } from "../notify/messages.ts";

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

// 該当なし／別のLINEに紐付き済みは同じ文言（紐付き済みかどうかを探らせない）
export const LINK_NOT_FOUND_MESSAGE = text(
  "参加者の中にそのXアカウントが見つかりませんでした。\nTwiplaで参加表明した @から始まるXアカウント名をもう一度お送りください。",
);
export const LINK_DONE_MESSAGE = text(
  "紐付けが完了しました。イベント前の確認連絡をお待ちください。",
);
export const LINK_CANCEL_MESSAGE = text(
  "承知しました。もう一度、@から始まるXアカウント名をお送りください。",
);
export const LINK_ALREADY_MESSAGE = text("すでに紐付いています。イベント前の確認連絡をお待ちください。");
export const LINK_LIMIT_MESSAGE = text(
  "このLINEはすでに別のXアカウントに紐付いています。変更したい場合は主催者にご連絡ください。",
);

export interface LinkReply {
  messages: object[];
  /** 主催者へ通知する文面（あれば） */
  ownerNotice?: string;
}

export interface LinkSender {
  /** line_users.id */
  id: string;
  displayName: string | null;
}

const lineName = (s: LinkSender) => s.displayName ?? "（表示名不明）";

type CandidateRow = { outcome: string; display_name: string | null };

/** メッセージ受信時: @形式のときだけ応答。対象外・RPC失敗は null（応答しない） */
export async function handleLinkMessage(
  supabase: SupabaseClient,
  oaConfigId: string,
  sender: LinkSender,
  messageText: string | null,
): Promise<LinkReply | null> {
  const screenName = normalizeScreenName(messageText);
  if (screenName === null) return null;
  const { data, error } = await supabase.rpc("find_link_candidate", {
    p_oa_config_id: oaConfigId,
    p_screen_name: screenName,
    p_line_user_id: sender.id,
  });
  if (error) {
    console.error(`webhook: find_link_candidate failed: ${error.message}`);
    return null;
  }
  const row = (data as CandidateRow[] | null)?.[0];
  switch (row?.outcome) {
    case "candidate":
      return { messages: [buildLinkConfirmMessage(row.display_name ?? "", screenName)] };
    case "already":
      return { messages: [LINK_ALREADY_MESSAGE] };
    case "limit":
      return { messages: [LINK_LIMIT_MESSAGE] };
    case "taken":
      return {
        messages: [LINK_NOT_FOUND_MESSAGE],
        ownerNotice: buildLinkClaimRejectedNotification(screenName, lineName(sender)),
      };
    default:
      return { messages: [LINK_NOT_FOUND_MESSAGE] };
  }
}

/** 確認postback受信時: はい → 紐付け確定、いいえ → やり直し案内。形式不一致・RPC失敗は null */
export async function handleLinkConfirm(
  supabase: SupabaseClient,
  oaConfigId: string,
  sender: LinkSender,
  data: string,
): Promise<LinkReply | null> {
  const payload = decodeLinkConfirmData(data);
  if (!payload) return null;
  if (!payload.accepted) return { messages: [LINK_CANCEL_MESSAGE] };
  const { data: count, error } = await supabase.rpc("link_by_screen_name", {
    p_oa_config_id: oaConfigId,
    p_line_user_id: sender.id,
    p_screen_name: payload.screenName,
  });
  if (error) {
    console.error(`webhook: link_by_screen_name failed: ${error.message}`);
    return null;
  }
  if ((count as number) > 0) {
    return {
      messages: [LINK_DONE_MESSAGE],
      ownerNotice: buildLinkedNotification(payload.screenName, lineName(sender)),
    };
  }
  return { messages: [LINK_NOT_FOUND_MESSAGE] };
}

export interface LinkDeps {
  supabase: SupabaseClient;
  oaConfigId: string;
  getToken: () => Promise<string | null>;
  reply: (token: string, replyToken: string, messages: object[]) => Promise<unknown>;
  notifyOwners: (text: string) => Promise<unknown>;
}

async function lookupSender(
  deps: LinkDeps,
  lineUserId: string,
): Promise<LinkSender | null> {
  const { data } = await deps.supabase
    .from("line_users")
    .select("id, display_name")
    .eq("oa_config_id", deps.oaConfigId)
    .eq("line_user_id", lineUserId)
    .single();
  const row = data as { id: string; display_name: string | null } | null;
  return row ? { id: row.id, displayName: row.display_name } : null;
}

async function respond(deps: LinkDeps, replyToken: string, r: LinkReply | null): Promise<void> {
  if (!r) return;
  const token = await deps.getToken();
  if (token) {
    try {
      await deps.reply(token, replyToken, r.messages);
    } catch (err) {
      console.error(`webhook: link reply failed: ${(err as Error).message}`);
    }
  }
  if (r.ownerNotice) {
    try {
      await deps.notifyOwners(r.ownerNotice);
    } catch (err) {
      console.error(`webhook: link owner notify failed: ${(err as Error).message}`);
    }
  }
}

/** webhook の message 分岐（進行中の1問1答が無いユーザー）から呼ぶ。LINEのuserId を受け取る */
export async function processLinkMessageEvent(
  deps: LinkDeps,
  ev: { userId: string; replyToken: string; text: string | null },
): Promise<void> {
  if (normalizeScreenName(ev.text) === null) return;
  const sender = await lookupSender(deps, ev.userId);
  if (!sender) return;
  await respond(deps, ev.replyToken, await handleLinkMessage(deps.supabase, deps.oaConfigId, sender, ev.text));
}

/** webhook の postback 分岐（k=link）から呼ぶ。LINEのuserId を受け取る */
export async function processLinkPostbackEvent(
  deps: LinkDeps,
  ev: { userId: string; replyToken: string; data: string },
): Promise<void> {
  const sender = await lookupSender(deps, ev.userId);
  if (!sender) return;
  await respond(deps, ev.replyToken, await handleLinkConfirm(deps.supabase, deps.oaConfigId, sender, ev.data));
}
