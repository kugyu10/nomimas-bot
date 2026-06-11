// 1問1答ステートマシン 純関数
// I/O・Date・乱数を一切使わない決定的な純関数（D-05準拠）
// 状態の永続化は呼び出し側（webhook）の責務

export type ConfirmStatus = "pending" | "sent" | "in_progress" | "completed";

export interface Question {
  id: string;
  text: string;
  options: string[];
}

export interface TransitionResult {
  nextStatus: ConfirmStatus;
  nextIndex: number;
  answer: {
    questionId: string;
    questionText: string;
    answer: string;
  } | null;
  reply: "next_question" | "completion" | "reprompt" | "none";
}

/**
 * 1問1答ステートマシンの状態遷移純関数。
 *
 * 遷移ルール:
 * 1. status が pending / completed → 即 none（D-07: 完了後は応答しない）
 * 2. questions が空 → 即 none（防御）
 * 3. input.questionId が questions[current.index] と一致:
 *    - optionIndex が有効範囲内 → answer 生成、index+1 が上限なら completed+completion、未満なら in_progress+next_question
 *    - optionIndex が範囲外 → answer=null + reprompt
 * 4. input.questionId が current.index より前の質問と一致（過去質問の再タップ）:
 *    - optionIndex が有効範囲内 → answer 生成（UPSERT上書き用）、index/status不変、reprompt
 *    - optionIndex が範囲外 → answer=null + reprompt
 * 5. それ以外（未知 id）→ answer=null + reprompt
 *
 * @param current 現在の参加者状態（確認ステータス + 現在質問インデックス）
 * @param questions イベントの全質問定義
 * @param input postback から取得した questionId と optionIndex
 * @returns 遷移結果
 */
export function transition(
  current: { status: ConfirmStatus; index: number },
  questions: Question[],
  input: { questionId: string; optionIndex: number },
): TransitionResult {
  // ルール 1: pending / completed は無視
  if (current.status === "pending" || current.status === "completed") {
    return {
      nextStatus: current.status,
      nextIndex: current.index,
      answer: null,
      reply: "none",
    };
  }

  // ルール 2: 空 questions は防御
  if (questions.length === 0) {
    return {
      nextStatus: current.status,
      nextIndex: current.index,
      answer: null,
      reply: "none",
    };
  }

  // ルール 3: 現在の質問と一致
  const currentQuestion = questions[current.index];
  if (currentQuestion && input.questionId === currentQuestion.id) {
    // optionIndex 範囲チェック
    if (
      input.optionIndex < 0 ||
      input.optionIndex >= currentQuestion.options.length
    ) {
      return {
        nextStatus: current.status,
        nextIndex: current.index,
        answer: null,
        reply: "reprompt",
      };
    }
    // 正常前進
    const nextIndex = current.index + 1;
    const isCompleted = nextIndex >= questions.length;
    return {
      nextStatus: isCompleted ? "completed" : "in_progress",
      nextIndex,
      answer: {
        questionId: currentQuestion.id,
        questionText: currentQuestion.text,
        answer: currentQuestion.options[input.optionIndex],
      },
      reply: isCompleted ? "completion" : "next_question",
    };
  }

  // ルール 4: 過去質問の再タップ（current.index より前に同一 id が存在するか検索）
  const pastQuestion = questions
    .slice(0, current.index)
    .find((q) => q.id === input.questionId);

  if (pastQuestion) {
    // optionIndex 範囲チェック
    if (
      input.optionIndex < 0 ||
      input.optionIndex >= pastQuestion.options.length
    ) {
      return {
        nextStatus: current.status,
        nextIndex: current.index,
        answer: null,
        reply: "reprompt",
      };
    }
    // 上書き用 answer を記録し、index / status は変えない（UPSERT先の責務）
    return {
      nextStatus: current.status,
      nextIndex: current.index,
      answer: {
        questionId: pastQuestion.id,
        questionText: pastQuestion.text,
        answer: pastQuestion.options[input.optionIndex],
      },
      reply: "reprompt",
    };
  }

  // ルール 5: 未知 questionId
  return {
    nextStatus: current.status,
    nextIndex: current.index,
    answer: null,
    reply: "reprompt",
  };
}
