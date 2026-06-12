// admin/app/(app)/events/[id]/page.tsx
// イベント詳細ページ（async RSC）
// - Next 16: const { id } = await props.params（params は Promise）
// - タイトル + 開催日 subtitle + 参加者を取得ボタン + 3タブ（参加者/回答状況/紐付け）
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getEvent } from "@/lib/data/events";
import { listParticipantsByEvent, getParticipantsWithAnswers, getLinkingLists } from "@/lib/data/participants";
import { listMyOas, resolveSelectedOaId, getOaSettings } from "@/lib/data/oa";
import { ScrapeButton } from "@/components/events/scrape-button";
import { ParticipantsTab } from "@/components/events/participants-tab";
import { AnswerStatusTab } from "@/components/events/answer-status-tab";
import { LinkingTab } from "@/components/events/linking-tab";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface EventDetailPageProps {
  params: Promise<{ id: string }>;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return dateStr.replace(/-/g, "/");
}

export default async function EventDetailPage({ params }: EventDetailPageProps) {
  // Next 16: params は Promise — await 必須（RESEARCH Pitfall 2）
  const { id } = await params;

  const supabase = await createClient();
  const event = await getEvent(supabase, id);
  if (!event) {
    notFound();
  }

  // OA スコープ解決（cookie → 自 OA 一覧と突合）
  const cookieStore = await cookies();
  const selectedOaCookie = cookieStore.get("nomimas_selected_oa_id")?.value;
  const myOas = await listMyOas(supabase);
  const selectedOaId = resolveSelectedOaId(selectedOaCookie, myOas);

  // 3タブ用データを並列取得
  const [participants, participantsWithAnswers, oaSettings, linkingLists] = await Promise.all([
    listParticipantsByEvent(supabase, id),
    getParticipantsWithAnswers(supabase, id),
    selectedOaId ? getOaSettings(supabase, selectedOaId) : Promise.resolve(null),
    selectedOaId ? getLinkingLists(supabase, id, selectedOaId) : Promise.resolve({
      unlinked: [],
      linked: [],
      lineUserCandidates: [],
    }),
  ]);

  // questions: OA設定から取得（null 安全）
  const questions = oaSettings?.questions ?? [];

  // 全LINE友だち一覧（紐付け解除後の候補復元用 — 紐付け済みを含む全員）
  const allLineUsers = [
    ...linkingLists.lineUserCandidates,
    ...linkingLists.linked.map((p) => ({
      id: p.line_user_id,
      display_name: p.line_display_name,
      line_user_id: p.line_user_id,
    })),
  ];

  return (
    <div className="space-y-4">
      {/* ページヘッダー */}
      <div className="space-y-1">
        {/* UI-SPEC Typography: Heading 20px/600 */}
        <h1 className="text-xl font-semibold">{event.title}</h1>
        {/* UI-SPEC: 開催日 subtitle muted 14px/400 */}
        {event.event_date && (
          <p className="text-sm text-muted-foreground">{formatDate(event.event_date)}</p>
        )}
      </div>

      {/* 参加者を取得ボタン（UI-SPEC: outline, below title） */}
      <ScrapeButton eventId={id} />

      {/* 3タブ: 参加者 | 回答状況 | 紐付け（UI-SPEC: タブ構造確定） */}
      <Tabs defaultValue="participants">
        <TabsList>
          <TabsTrigger value="participants">参加者</TabsTrigger>
          <TabsTrigger value="answers">回答状況</TabsTrigger>
          <TabsTrigger value="linking">紐付け</TabsTrigger>
        </TabsList>

        {/* 参加者タブ（03-03 実装済み — 変更なし） */}
        <TabsContent value="participants" className="mt-4">
          <ParticipantsTab participants={participants} />
        </TabsContent>

        {/* 回答状況タブ（ADMIN-01 — 03-05 実装） */}
        <TabsContent value="answers" className="mt-4">
          <AnswerStatusTab participants={participantsWithAnswers} questions={questions} />
        </TabsContent>

        {/* 紐付けタブ（ADMIN-02 — 03-05 実装） */}
        <TabsContent value="linking" className="mt-4">
          <LinkingTab
            eventId={id}
            initialUnlinked={linkingLists.unlinked}
            initialLinked={linkingLists.linked}
            lineUserCandidates={linkingLists.lineUserCandidates}
            allLineUsers={allLineUsers}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
