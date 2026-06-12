// admin/app/(app)/events/page.tsx
// イベント一覧ページ（async RSC）
// UI-SPEC: ページタイトル「イベント一覧」20px/600、右上「+ イベントを作成」accent ボタン
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { listMyOas, resolveSelectedOaId } from "@/lib/data/oa";
import { listEvents } from "@/lib/data/events";
import { EventsPageClient } from "@/components/events/events-page-client";

export default async function EventsPage() {
  const supabase = await createClient();
  const myOas = await listMyOas(supabase);

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get("nomimas_selected_oa_id")?.value;
  const selectedOaId = resolveSelectedOaId(cookieValue, myOas);

  const events = selectedOaId ? await listEvents(supabase, selectedOaId) : [];

  return <EventsPageClient events={events} />;
}
