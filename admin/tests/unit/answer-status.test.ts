/**
 * admin/tests/unit/answer-status.test.ts
 * 回答状況合成の純関数 buildAnswerStatusRows のユニットテスト（TDD RED フェーズ）
 *
 * フィクスチャ（seed.sql より）:
 *   questions: q_age / q_drink / q_late の3問
 *   participant …0005: q_age のみ回答済み / confirm_status='pending'
 */
import { describe, it, expect } from "vitest";
import { buildAnswerStatusRows } from "../../lib/answer-status";
import type { QuestionDef, ParticipantWithAnswers, AnswerStatusRow } from "../../lib/answer-status";

// テスト用フィクスチャ
const QUESTIONS: QuestionDef[] = [
  { id: "q_age",   text: "年齢確認です。あなたは20歳以上ですか？",  options: ["20歳以上です", "未成年です"] },
  { id: "q_drink", text: "飲酒予定はありますか？",                  options: ["飲む", "飲まない"] },
  { id: "q_late",  text: "遅刻・早退の予定はありますか？",           options: ["なし", "遅刻予定", "早退予定"] },
];

const PARTICIPANT_BASE = {
  id: "00000000-0000-0000-0000-000000000005",
  display_name: "devテスト参加者",
  screen_name: null as string | null,
  line_user_id: null as string | null,
  line_user: null as { display_name: string | null } | null,
};

describe("buildAnswerStatusRows", () => {
  // ケース1: 回答0件 — 全 Q が「—」、全体ステータスは confirm_status のマッピング
  it("回答0件のとき全Qセルが「—」になり confirm_status がステータスにマップされる", () => {
    const participant: ParticipantWithAnswers = {
      ...PARTICIPANT_BASE,
      confirm_status: "pending",
      answers: [],
    };
    const rows = buildAnswerStatusRows([participant], QUESTIONS);

    expect(rows).toHaveLength(1);
    const row = rows[0];

    // 全3問が「—」
    expect(row.answerCells).toHaveLength(3);
    expect(row.answerCells.every((c) => c.value === "—")).toBe(true);

    // pending → 未配信
    expect(row.statusLabel).toBe("未配信");
    expect(row.statusKey).toBe("pending");
  });

  // ケース2: 一部回答（q_age のみ）
  it("q_age のみ回答済みのとき q_age セルに回答値、他は「—」", () => {
    const participant: ParticipantWithAnswers = {
      ...PARTICIPANT_BASE,
      confirm_status: "sent",
      answers: [
        { question_key: "q_age", answer: "20歳以上です", answered_at: "2026-06-12T00:00:00Z" },
      ],
    };
    const rows = buildAnswerStatusRows([participant], QUESTIONS);

    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.answerCells[0].questionKey).toBe("q_age");
    expect(row.answerCells[0].value).toBe("20歳以上です");
    expect(row.answerCells[1].value).toBe("—");
    expect(row.answerCells[2].value).toBe("—");

    // sent → 配信済み
    expect(row.statusLabel).toBe("配信済み");
    expect(row.statusKey).toBe("sent");
  });

  // ケース3: 全問回答済み
  it("全問回答済みのとき全セルに回答値が入り statusLabel=回答済み", () => {
    const participant: ParticipantWithAnswers = {
      ...PARTICIPANT_BASE,
      confirm_status: "completed",
      answers: [
        { question_key: "q_age",   answer: "20歳以上です",  answered_at: "2026-06-12T00:00:00Z" },
        { question_key: "q_drink", answer: "飲まない",      answered_at: "2026-06-12T00:01:00Z" },
        { question_key: "q_late",  answer: "なし",          answered_at: "2026-06-12T00:02:00Z" },
      ],
    };
    const rows = buildAnswerStatusRows([participant], QUESTIONS);

    const row = rows[0];
    expect(row.answerCells[0].value).toBe("20歳以上です");
    expect(row.answerCells[1].value).toBe("飲まない");
    expect(row.answerCells[2].value).toBe("なし");

    // completed → 回答済み
    expect(row.statusLabel).toBe("回答済み");
    expect(row.statusKey).toBe("completed");
  });

  // ケース4: questions が空配列
  it("questions が空配列のとき answerCells が空配列になる", () => {
    const participant: ParticipantWithAnswers = {
      ...PARTICIPANT_BASE,
      confirm_status: "in_progress",
      answers: [
        { question_key: "q_age", answer: "20歳以上です", answered_at: "2026-06-12T00:00:00Z" },
      ],
    };
    const rows = buildAnswerStatusRows([participant], []);

    const row = rows[0];
    expect(row.answerCells).toHaveLength(0);

    // in_progress → 回答中
    expect(row.statusLabel).toBe("回答中");
    expect(row.statusKey).toBe("in_progress");
  });

  // 補足: 複数参加者のとき rows の順序が participants と同じになる
  it("複数参加者のとき participants の順序で rows が生成される", () => {
    const p1: ParticipantWithAnswers = {
      id: "p1",
      display_name: "参加者A",
      screen_name: null,
      line_user_id: null,
      line_user: null,
      confirm_status: "pending",
      answers: [],
    };
    const p2: ParticipantWithAnswers = {
      id: "p2",
      display_name: "参加者B",
      screen_name: null,
      line_user_id: null,
      line_user: null,
      confirm_status: "completed",
      answers: [],
    };
    const rows = buildAnswerStatusRows([p1, p2], QUESTIONS);
    expect(rows[0].participantId).toBe("p1");
    expect(rows[1].participantId).toBe("p2");
  });
});
