// LINE署名検証ユニットテスト
// 公式テストベクタ出典: developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
// テスト内のシークレットは公式公開テストベクタのみ（実チャネルシークレット不使用）

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateLineSignature } from "../_shared/line/signature.ts";

// 公式テストベクタ（公開ドキュメント値のためコミット可）
const TEST_BODY =
  '{"destination":"U8e742f61d673b39c7fff3cecb7536ef0","events":[]}';
const TEST_SECRET = "8c570fa6dd201bb328f1c1eac23a96d8";
const TEST_SIG = "GhRKmvmHys4Pi8DxkF4+EayaH0OqtJtaZxgTD9fMDLs=";

Deno.test(
  "validateLineSignature: 公式テストベクタで true を返す",
  async () => {
    const result = await validateLineSignature(TEST_BODY, TEST_SECRET, TEST_SIG);
    assertEquals(result, true);
  },
);

Deno.test(
  "validateLineSignature: 署名の1文字を変えると false",
  async () => {
    // TEST_SIGの先頭1文字をずらす
    const badSig = "HhRKmvmHys4Pi8DxkF4+EayaH0OqtJtaZxgTD9fMDLs=";
    const result = await validateLineSignature(TEST_BODY, TEST_SECRET, badSig);
    assertEquals(result, false);
  },
);

Deno.test(
  "validateLineSignature: 長さの異なる署名で false（例外を出さない）",
  async () => {
    const shortSig = "GhRKmvmHys4Pi8Dx=";
    const result = await validateLineSignature(TEST_BODY, TEST_SECRET, shortSig);
    assertEquals(result, false);
  },
);

Deno.test(
  "validateLineSignature: bodyを1文字変えると false（raw body改変検知）",
  async () => {
    // bodyの末尾に空白を追加
    const modifiedBody = TEST_BODY + " ";
    const result = await validateLineSignature(
      modifiedBody,
      TEST_SECRET,
      TEST_SIG,
    );
    assertEquals(result, false);
  },
);

Deno.test(
  "validateLineSignature: 空署名・空bodyで例外を出さず false",
  async () => {
    const result = await validateLineSignature("", TEST_SECRET, "");
    assertEquals(result, false);
  },
);
