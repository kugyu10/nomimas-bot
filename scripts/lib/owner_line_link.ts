// 主催者(oa_members)と LINE(line_users) を紐付ける計画を立てる純関数。DB には触らない。

export interface MemberRow {
  id: string;
  oa_config_id: string;
  auth_user_id: string;
  role: string;
  line_user_id: string | null;
}

export interface LineUserRow {
  oa_config_id: string;
  line_user_id: string;
}

export interface LinkRequest {
  oaConfigId: string;
  authUserId: string;
  lineUserId: string;
}

export interface LinkPlan {
  updates: { memberId: string; request: LinkRequest }[];
  errors: string[];
}

const LINE_USER_ID_RE = /^U[0-9a-f]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `--link <oa_config_id>:<auth_user_id>:<line_user_id>` を繰り返し指定する。 */
export function parseLinkArgs(args: string[]): { requests: LinkRequest[]; errors: string[] } {
  const requests: LinkRequest[] = [];
  const errors: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--link") {
      errors.push(`不明な引数: ${args[i]}`);
      continue;
    }
    const value = args[++i] ?? "";
    const [oaConfigId, authUserId, lineUserId, ...rest] = value.split(":");
    if (rest.length > 0 || !UUID_RE.test(oaConfigId ?? "") || !UUID_RE.test(authUserId ?? "")) {
      errors.push(`--link の形式が不正: '${value}'（<oa_config_id>:<auth_user_id>:<line_user_id>）`);
    } else if (!LINE_USER_ID_RE.test(lineUserId ?? "")) {
      errors.push(`LINE userId の形式が不正（U + 32桁の16進）: '${lineUserId}'`);
    } else {
      requests.push({ oaConfigId, authUserId, lineUserId });
    }
  }
  return { requests, errors };
}

/**
 * 紐付け要求を検証する。他OAの line_users や、同じ OA の別メンバーが使用中の
 * LINE userId を誤って紐付けないよう、すべて明示的に弾く。
 */
export function planLinks(
  requests: LinkRequest[],
  members: MemberRow[],
  lineUsers: LineUserRow[],
): LinkPlan {
  const plan: LinkPlan = { updates: [], errors: [] };
  const claimed = new Map<string, string>(); // "oa:lineUserId" -> auth_user_id

  for (const m of members) {
    if (m.line_user_id) claimed.set(`${m.oa_config_id}:${m.line_user_id}`, m.auth_user_id);
  }

  for (const r of requests) {
    const label = `oa=${r.oaConfigId} user=${r.authUserId}`;
    const member = members.find((m) =>
      m.oa_config_id === r.oaConfigId && m.auth_user_id === r.authUserId
    );
    if (!member) {
      plan.errors.push(`${label}: oa_members に該当行がない`);
      continue;
    }
    const known = lineUsers.some((l) =>
      l.oa_config_id === r.oaConfigId && l.line_user_id === r.lineUserId
    );
    if (!known) {
      plan.errors.push(`${label}: ${r.lineUserId} はこの OA の line_users に存在しない`);
      continue;
    }
    const owner = claimed.get(`${r.oaConfigId}:${r.lineUserId}`);
    if (owner && owner !== r.authUserId) {
      plan.errors.push(`${label}: ${r.lineUserId} は別メンバー(${owner})に紐付け済み`);
      continue;
    }
    claimed.set(`${r.oaConfigId}:${r.lineUserId}`, r.authUserId);
    plan.updates.push({ memberId: member.id, request: r });
  }
  return plan;
}
