/**
 * admin/app/(app)/oa/settings/page.tsx
 * OA設定ページ（async RSC）
 *
 * UI-SPEC:
 * - タイトル「OA設定」(20px/600)
 * - 現在OA名 subtitle（ヘッダ OA セレクタ駆動 — cookie の選択 OA を resolveSelectedOaId で解決）
 * - 3カード: 基本情報 / 定型文 / 質問設定
 */
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { listMyOas, resolveSelectedOaId, getOaSettings } from "@/lib/data/oa";
import { listQuestionTemplates } from "@/lib/data/templates";
import { OaSettingsForm } from "@/components/oa/oa-settings-form";

export default async function OaSettingsPage() {
  const supabase = await createClient();
  const myOas = await listMyOas(supabase);

  // OA セレクタの選択値を cookie から解決
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get("nomimas_selected_oa_id")?.value;
  const selectedOaId = resolveSelectedOaId(cookieValue, myOas);

  if (!selectedOaId) {
    return (
      <div className="space-y-4">
        {/* UI-SPEC Typography: Heading 20px/600 */}
        <h1 className="text-xl font-semibold">OA設定</h1>
        <p className="text-sm text-muted-foreground">
          OAが見つかりません。ヘッダーのOAセレクターで対象OAを選択してください。
        </p>
      </div>
    );
  }

  const [oaConfig, templates] = await Promise.all([
    getOaSettings(supabase, selectedOaId),
    listQuestionTemplates(supabase),
  ]);

  if (!oaConfig) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">OA設定</h1>
        <p className="text-sm text-destructive">
          データの取得に失敗しました。ページを再読み込みしてください。
        </p>
      </div>
    );
  }

  // 選択中の OA 名を subtitle として表示
  const selectedOaName = myOas.find((oa) => oa.id === selectedOaId)?.name ?? oaConfig.name;

  return (
    <div className="space-y-4 max-w-3xl">
      {/* UI-SPEC Typography: Heading 20px/600 */}
      <div>
        <h1 className="text-xl font-semibold">OA設定</h1>
        {/* OA名 subtitle — ヘッダ OA セレクタ駆動 */}
        <p className="text-sm text-muted-foreground mt-1">{selectedOaName}</p>
      </div>

      <OaSettingsForm oaConfig={oaConfig} templates={templates} />
    </div>
  );
}
