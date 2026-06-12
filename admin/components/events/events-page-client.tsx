"use client";
// admin/components/events/events-page-client.tsx
// イベント一覧ページのクライアントコンポーネント（Dialog 状態管理）
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EventsTable } from "@/components/events/events-table";
import { EventFormDialog } from "@/components/events/event-form-dialog";
import type { EventListItem } from "@/lib/data/events";

interface EventsPageClientProps {
  events: EventListItem[];
}

export function EventsPageClient({ events }: EventsPageClientProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const router = useRouter();

  function handleSuccess() {
    // UI-SPEC Interaction Contract: 成功 → ダイアログ閉鎖 + 一覧再取得 + alert
    setSuccessMessage("イベントを作成しました");
    router.refresh();
    setTimeout(() => setSuccessMessage(null), 4000);
  }

  return (
    <div className="space-y-4">
      {/* ページヘッダー: タイトル・イベントを作成ボタン */}
      <div className="flex items-center justify-between">
        {/* UI-SPEC Typography: Heading 20px/600 */}
        <h1 className="text-xl font-semibold">イベント一覧</h1>
        {/* UI-SPEC: "イベントを作成" CTA button */}
        <Button
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon className="size-4 mr-1" />
          イベントを作成
        </Button>
      </div>

      {/* 成功 alert */}
      {successMessage && (
        <Alert>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      {/* イベントテーブル（空状態テキスト含む） */}
      <EventsTable events={events} />

      {/* 作成ダイアログ */}
      <EventFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
