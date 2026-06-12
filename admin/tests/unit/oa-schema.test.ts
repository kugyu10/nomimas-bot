/**
 * admin/tests/unit/oa-schema.test.ts
 * OA設定スキーマ（oaSettingsSchema, questionSchema）の unit テスト
 */
import { describe, it, expect } from "vitest";
import { questionSchema, oaSettingsSchema } from "@/lib/schemas/oa";

// ===========================================================
// questionSchema テスト
// ===========================================================
describe("questionSchema", () => {
  it("valid な質問を accept する", () => {
    const result = questionSchema.safeParse({
      id: "q_age",
      text: "年齢確認です",
      options: ["20歳以上", "未成年"],
    });
    expect(result.success).toBe(true);
  });

  it("id が空文字の場合 reject する", () => {
    const result = questionSchema.safeParse({
      id: "",
      text: "テスト",
      options: ["a"],
    });
    expect(result.success).toBe(false);
  });

  it("text が空文字の場合 reject する", () => {
    const result = questionSchema.safeParse({
      id: "q1",
      text: "",
      options: ["a"],
    });
    expect(result.success).toBe(false);
  });

  it("options が空配列の場合 reject する", () => {
    const result = questionSchema.safeParse({
      id: "q1",
      text: "質問",
      options: [],
    });
    expect(result.success).toBe(false);
  });

  it("options 内に空文字がある場合 reject する", () => {
    const result = questionSchema.safeParse({
      id: "q1",
      text: "質問",
      options: ["a", ""],
    });
    expect(result.success).toBe(false);
  });

  it("options が欠落している場合 reject する", () => {
    const result = questionSchema.safeParse({
      id: "q1",
      text: "質問",
    });
    expect(result.success).toBe(false);
  });
});

// ===========================================================
// oaSettingsSchema テスト
// ===========================================================
describe("oaSettingsSchema", () => {
  const validInput = {
    name: "テストOA",
    admin_twitter_id: "user1",
    greeting_message: "最終確認です",
    completion_message: "回答ありがとうございました",
    questions: [
      { id: "q1", text: "質問1", options: ["A", "B"] },
    ],
  };

  it("valid な入力を accept する", () => {
    const result = oaSettingsSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("name が空の場合 reject する", () => {
    const result = oaSettingsSchema.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("admin_twitter_id の @ 前置を除去する", () => {
    const result = oaSettingsSchema.safeParse({
      ...validInput,
      admin_twitter_id: "@alice,@bob",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.admin_twitter_id).toBe("alice,bob");
    }
  });

  it("admin_twitter_id の空白をトリムする", () => {
    const result = oaSettingsSchema.safeParse({
      ...validInput,
      admin_twitter_id: " alice , bob ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.admin_twitter_id).toBe("alice,bob");
    }
  });

  it("admin_twitter_id の空要素を除去する", () => {
    const result = oaSettingsSchema.safeParse({
      ...validInput,
      admin_twitter_id: "@a, b ,, ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.admin_twitter_id).toBe("a,b");
    }
  });

  it("admin_twitter_id が空文字の場合、空文字を返す", () => {
    const result = oaSettingsSchema.safeParse({
      ...validInput,
      admin_twitter_id: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.admin_twitter_id).toBe("");
    }
  });

  it("admin_twitter_id がスペースのみの場合、空文字を返す", () => {
    const result = oaSettingsSchema.safeParse({
      ...validInput,
      admin_twitter_id: "  ,  ,  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.admin_twitter_id).toBe("");
    }
  });

  it("greeting_message は null を accept する", () => {
    const result = oaSettingsSchema.safeParse({
      ...validInput,
      greeting_message: null,
    });
    expect(result.success).toBe(true);
  });

  it("completion_message は null を accept する", () => {
    const result = oaSettingsSchema.safeParse({
      ...validInput,
      completion_message: null,
    });
    expect(result.success).toBe(true);
  });

  it("questions が空配列でも accept する（0件設定を許容）", () => {
    const result = oaSettingsSchema.safeParse({
      ...validInput,
      questions: [],
    });
    expect(result.success).toBe(true);
  });

  it("questions 内に不正形がある場合 reject する", () => {
    const result = oaSettingsSchema.safeParse({
      ...validInput,
      questions: [
        { id: "q1", text: "質問1", options: [] }, // options 空配列
      ],
    });
    expect(result.success).toBe(false);
  });
});
