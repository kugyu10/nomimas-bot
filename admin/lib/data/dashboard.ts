// admin/lib/data/dashboard.ts
// ログイン直後（イベント一覧トップ）に表示する直近イベントのサマリ集計。
//
// 直近イベント = 選択中OAの「開催日が今日以降で最も近いイベント」。
// 無ければ「最も新しい過去イベント」にフォールバック。
//
// 指標:
//  - totalAttending : 参加表明あり（status='attending'）の総数
//  - answeredCount  : うち最終確認 完了（confirm_status='completed'）= 確定参加者
//  - drinkCount     : 飲酒質問に「飲む」相当で回答した人数
//  - lateCount      : 遅刻早退質問に「遅刻予定」相当で回答した人数
//
// アルコール/遅刻の質問は oa_configs.questions から特定する（id 固定値に依存せず、
// 質問文のキーワードで判定 — 標準質問「飲酒」「遅刻・早退」に追従）。
// 全クエリはユーザーJWTクライアント経由（RLS スコープ）。
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DashboardSummary {
  event: { id: string; title: string; event_date: string | null } | null;
  totalAttending: number;
  answeredCount: number;
  drinkCount: number;
  lateCount: number;
}

interface QuestionDef {
  id: string;
  text: string;
  options: string[];
}

/** 飲酒質問とその「あり」選択肢を特定（質問文に「飲」を含む） */
function resolveDrinkQuestion(questions: QuestionDef[]): { id: string; affirmative: string } | null {
  const q = questions.find((x) => x.text.includes("飲"));
  if (!q) return null;
  // 「飲む」系（否定「飲まない」を除外）を「あり」とみなす
  const affirmative = q.options.find((o) => o.includes("飲") && !o.includes("飲ま")) ?? "飲む";
  return { id: q.id, affirmative };
}

/** 遅刻質問とその「遅刻」選択肢を特定（質問文に「遅刻」を含む） */
function resolveLateQuestion(questions: QuestionDef[]): { id: string; affirmative: string } | null {
  const q = questions.find((x) => x.text.includes("遅刻"));
  if (!q) return null;
  const affirmative = q.options.find((o) => o.includes("遅刻")) ?? "遅刻予定";
  return { id: q.id, affirmative };
}

export async function getDashboardSummary(
  supabase: SupabaseClient,
  oaConfigId: string,
): Promise<DashboardSummary> {
  const empty: DashboardSummary = {
    event: null,
    totalAttending: 0,
    answeredCount: 0,
    drinkCount: 0,
    lateCount: 0,
  };

  // 1. 直近イベントを決定（開催日が今日以降で最も近い → 無ければ最新の過去）
  const today = new Date().toISOString().slice(0, 10);
  const { data: upcoming } = await supabase
    .from("events")
    .select("id, title, event_date")
    .eq("oa_config_id", oaConfigId)
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  let event = upcoming ?? null;
  if (!event) {
    const { data: past } = await supabase
      .from("events")
      .select("id, title, event_date")
      .eq("oa_config_id", oaConfigId)
      .order("event_date", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    event = past ?? null;
  }
  if (!event) return empty;

  // 2. このイベントの「参加表明あり」参加者を取得（id + confirm_status）
  const { data: participants } = await supabase
    .from("participants")
    .select("id, confirm_status, event_platform_urls!inner(event_id)")
    .eq("event_platform_urls.event_id", event.id)
    .eq("status", "attending");

  const rows = participants ?? [];
  const totalAttending = rows.length;
  const answeredCount = rows.filter((r) => r.confirm_status === "completed").length;

  if (totalAttending === 0) {
    return { event, totalAttending, answeredCount: 0, drinkCount: 0, lateCount: 0 };
  }

  // 3. 飲酒/遅刻の質問定義を OA から特定
  const { data: oa } = await supabase
    .from("oa_configs")
    .select("questions")
    .eq("id", oaConfigId)
    .maybeSingle();
  const questions = (oa?.questions ?? []) as QuestionDef[];
  const drinkQ = resolveDrinkQuestion(questions);
  const lateQ = resolveLateQuestion(questions);

  // 4. 参加者の回答を一括取得して JS で集計（規模が小さいため in 句で十分）
  const participantIds = rows.map((r) => r.id);
  const { data: answers } = await supabase
    .from("answers")
    .select("participant_id, question_key, answer")
    .in("participant_id", participantIds);

  const answerRows = answers ?? [];
  const drinkCount = drinkQ
    ? answerRows.filter((a) => a.question_key === drinkQ.id && a.answer === drinkQ.affirmative).length
    : 0;
  const lateCount = lateQ
    ? answerRows.filter((a) => a.question_key === lateQ.id && a.answer === lateQ.affirmative).length
    : 0;

  return { event, totalAttending, answeredCount, drinkCount, lateCount };
}
