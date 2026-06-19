/**
 * admin/lib/answer-status.ts
 * 回答状況合成の純関数（ADMIN-01）
 *
 * participants × answers × questions を受け取り、
 * Q1..Qn 列 + 全体ステータス（バッジ契約）を持つ AnswerStatusRow[] を返す。
 *
 * 設計方針:
 * - 純関数（副作用なし・ネット不要）— vitest unit env のみで検証可
 * - 20字 truncate は描画側の責務（この関数に含めない — UI-SPEC Interaction Contract）
 * - 全体ステータスマッピングは UI-SPEC Status Badge Reference に準拠
 */

/** oa_configs.questions 配列の要素 */
export interface QuestionDef {
  id: string;
  text: string;
  options: string[];
}

/** PostgREST ネスト埋め込み結果の answers 要素 */
export interface AnswerCell {
  questionKey: string;
  value: string; // 回答テキスト、未回答なら "—"
}

/** UI-SPEC Status Badge Reference のステータスキー */
export type ConfirmStatusKey = "pending" | "sent" | "in_progress" | "completed";

/** 各ステータスの日本語表示ラベル（UI-SPEC 準拠） */
const STATUS_LABEL: Record<ConfirmStatusKey, string> = {
  pending:     "未配信",
  sent:        "配信済み",
  in_progress: "回答中",
  completed:   "回答済み",
} as const;

/** buildAnswerStatusRows の入力: participants 1行分 */
export interface ParticipantWithAnswers {
  id: string;
  display_name: string;
  screen_name: string | null;
  line_user_id: string | null;
  line_user: { display_name: string | null } | null;
  confirm_status: string;
  answers: Array<{
    question_key: string;
    answer: string | null;
    answered_at: string;
  }>;
}

/** buildAnswerStatusRows の出力: テーブル1行分 */
export interface AnswerStatusRow {
  participantId: string;
  participantName: string;
  lineDisplayName: string | null;
  /** LINE 紐付け済み（line_user_id 非null）か。個別送信ボタンの出し分けに使う */
  isLinked: boolean;
  answerCells: AnswerCell[];
  statusKey: ConfirmStatusKey;
  statusLabel: string;
}

/**
 * 参加者リストと質問定義から回答状況行を合成する。
 *
 * @param participants - answers ネスト込みの参加者配列（Pattern 7 クエリ結果）
 * @param questions    - oa_configs.questions JSONB を parse した QuestionDef 配列
 * @returns AnswerStatusRow[] — participants と同じ順序・同じ長さ
 */
export function buildAnswerStatusRows(
  participants: ParticipantWithAnswers[],
  questions: QuestionDef[],
): AnswerStatusRow[] {
  return participants.map((p) => {
    // answers を question_key → answer のマップに変換（O(1) 検索）
    const answerMap = new Map<string, string>(
      p.answers.map((a) => [a.question_key, a.answer ?? "—"]),
    );

    // questions の順で answerCells を生成
    const answerCells: AnswerCell[] = questions.map((q) => ({
      questionKey: q.id,
      value: answerMap.get(q.id) ?? "—",
    }));

    // confirm_status を ConfirmStatusKey に正規化（未知値は pending 扱い）
    const statusKey: ConfirmStatusKey =
      Object.keys(STATUS_LABEL).includes(p.confirm_status)
        ? (p.confirm_status as ConfirmStatusKey)
        : "pending";

    return {
      participantId: p.id,
      participantName: p.display_name,
      lineDisplayName: p.line_user?.display_name ?? null,
      isLinked: p.line_user_id != null,
      answerCells,
      statusKey,
      statusLabel: STATUS_LABEL[statusKey],
    };
  });
}
