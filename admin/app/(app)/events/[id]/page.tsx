// admin/app/(app)/events/[id]/page.tsx
// イベント詳細ページ（async RSC）
// - Next 16: const { id } = await props.params（params は Promise）
// - タイトル + 開催日 subtitle + 参加者を取得ボタン + 3タブ（参加者/回答状況/紐付け）
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEvent } from "@/lib/data/events";
import { listParticipantsByEvent } from "@/lib/data/participants";
import { ScrapeButton } from "@/components/events/scrape-button";
import { ParticipantsTab } from "@/components/events/participants-tab";
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

  const participants = await listParticipantsByEvent(supabase, id);

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

      {/* 3タブ: 参加者 | 回答状況 | 紐付け（UI-SPEC: タブ構造と URL は本タスクで確定） */}
      <Tabs defaultValue="participants">
        <TabsList>
          <TabsTrigger value="participants">参加者</TabsTrigger>
          <TabsTrigger value="answers">回答状況</TabsTrigger>
          <TabsTrigger value="linking">紐付け</TabsTrigger>
        </TabsList>

        {/* 参加者タブ */}
        <TabsContent value="participants" className="mt-4">
          <ParticipantsTab participants={participants} />
        </TabsContent>

        {/* 回答状況タブ: 03-05 が実装。プレースホルダ */}
        <TabsContent value="answers" className="mt-4">
          <div className="rounded-md border p-8 text-center">
            {/* UI-SPEC Copywriting Contract: empty state — 回答状況タブ */}
            <p className="text-sm text-muted-foreground">まだ回答がありません</p>
          </div>
        </TabsContent>

        {/* 紐付けタブ: 03-05 が実装。プレースホルダ */}
        <TabsContent value="linking" className="mt-4">
          <div className="rounded-md border p-8 text-center">
            {/* UI-SPEC: Table — no rows fallback */}
            <p className="text-sm text-muted-foreground">データがありません</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
