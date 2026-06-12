/**
 * admin/tests/unit/template-schema.test.ts
 * templateSchema の unit テスト（TDD RED）
 *
 * 検証:
 * - name 必須（空/101字拒否）
 * - questions の id 重複拒否
 * - 有効入力 pass
 * - oaSettingsSchema との検証同一性（同一不正 questions が両方で reject）
 */
import { describe, it, expect } from "vitest";
import { templateSchema } from "@/lib/schemas/template";
import { oaSettingsSchema, questionsSchema } from "@/lib/schemas/oa";

const validQuestions = [
  { id: "q1", text: "質問1", options: ["A", "B"] },
];

// ===========================================================
// templateSchema テスト
// ===========================================================
describe("templateSchema", () => {
  it("valid な入力を accept する", () => {
    const result = templateSchema.safeParse({
      name: "テストテンプレート",
      questions: validQuestions,
    });
    expect(result.success).toBe(true);
  });

  it("name が空文字の場合 reject する", () => {
    const result = templateSchema.safeParse({
      name: "",
      questions: validQuestions,
    });
    expect(result.success).toBe(false);
  });

  it("name が 101 文字の場合 reject する", () => {
    const result = templateSchema.safeParse({
      name: "あ".repeat(101),
      questions: validQuestions,
    });
    expect(result.success).toBe(false);
  });

  it("name が 100 文字なら accept する", () => {
    const result = templateSchema.safeParse({
      name: "あ".repeat(100),
      questions: validQuestions,
    });
    expect(result.success).toBe(true);
  });

  it("questions の id が重複している場合 reject する", () => {
    const result = templateSchema.safeParse({
      name: "テストテンプレート",
      questions: [
        { id: "q_dup", text: "質問1", options: ["A"] },
        { id: "q_dup", text: "質問2", options: ["B"] },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === "質問IDが重複しています"),
      ).toBe(true);
    }
  });

  it("questions が 20件は accept、21件は reject する（LINE 上限）", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `q${i + 1}`,
        text: `質問${i + 1}`,
        options: ["A"],
      }));

    expect(
      templateSchema.safeParse({ name: "テスト", questions: make(20) }).success,
    ).toBe(true);
    expect(
      templateSchema.safeParse({ name: "テスト", questions: make(21) }).success,
    ).toBe(false);
  });

  it("name が欠落している場合 reject する", () => {
    const result = templateSchema.safeParse({
      questions: validQuestions,
    });
    expect(result.success).toBe(false);
  });
});

// ===========================================================
// oaSettingsSchema との検証同一性テスト
// questionsSchema が切り出された export であること
// ===========================================================
describe("questionsSchema — oaSettingsSchema との同一性", () => {
  it("questionsSchema が oa.ts から export されている", () => {
    expect(questionsSchema).toBeDefined();
  });

  it("同一の不正 questions（id 重複）が questionsSchema と oaSettingsSchema の両方で reject される", () => {
    const invalidQuestions = [
      { id: "q_age", text: "質問1", options: ["A"] },
      { id: "q_age", text: "質問2", options: ["B"] },
    ];

    // questionsSchema 単体で reject
    const qResult = questionsSchema.safeParse(invalidQuestions);
    expect(qResult.success).toBe(false);

    // oaSettingsSchema でも reject（templateSchema と同一バリデーション）
    const oaResult = oaSettingsSchema.safeParse({
      name: "テストOA",
      admin_twitter_id: "user1",
      questions: invalidQuestions,
    });
    expect(oaResult.success).toBe(false);

    // templateSchema でも reject
    const tResult = templateSchema.safeParse({
      name: "テストテンプレート",
      questions: invalidQuestions,
    });
    expect(tResult.success).toBe(false);
  });

  it("同一の不正 questions（LINE 上限超過 21件）が questionsSchema と oaSettingsSchema の両方で reject される", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `q${i + 1}`,
        text: `質問${i + 1}`,
        options: ["A"],
      }));
    const tooMany = make(21);

    const qResult = questionsSchema.safeParse(tooMany);
    expect(qResult.success).toBe(false);

    const oaResult = oaSettingsSchema.safeParse({
      name: "テストOA",
      admin_twitter_id: "user1",
      questions: tooMany,
    });
    expect(oaResult.success).toBe(false);

    const tResult = templateSchema.safeParse({
      name: "テストテンプレート",
      questions: tooMany,
    });
    expect(tResult.success).toBe(false);
  });

  it("有効な questions が questionsSchema と oaSettingsSchema の両方で accept される", () => {
    const valid = [
      { id: "q1", text: "質問1", options: ["A", "B"] },
      { id: "q2", text: "質問2", options: ["C"] },
    ];

    const qResult = questionsSchema.safeParse(valid);
    expect(qResult.success).toBe(true);

    const oaResult = oaSettingsSchema.safeParse({
      name: "テストOA",
      admin_twitter_id: "user1",
      questions: valid,
    });
    expect(oaResult.success).toBe(true);

    const tResult = templateSchema.safeParse({
      name: "テストテンプレート",
      questions: valid,
    });
    expect(tResult.success).toBe(true);
  });
});
