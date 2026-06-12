"use client";
// admin/components/events/event-edit-button.tsx
// イベント詳細ページの「編集」ボタン + 編集ダイアログ（WR-02: edit パスの配線）
// - EventFormDialog を edit モードで開く
// - 保存成功時: router.refresh() で RSC を再フェッチ + 成功 alert（4秒）
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  EventFormDialog,
  type EventDetailProp,
} from "@/components/events/event-form-dialog";

interface EventEditButtonProps {
  event: EventDetailProp;
}

export function EventEditButton({ event }: EventEditButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const router = useRouter();

  function handleSuccess() {
    // UI-SPEC Interaction Contract: 成功 → ダイアログ閉鎖 + 再取得 + alert
    setSuccessMessage("イベントを保存しました");
    router.refresh();
    setTimeout(() => setSuccessMessage(null), 4000);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setDialogOpen(true)}
      >
        <PencilIcon className="size-4 mr-1" />
        編集
      </Button>

      {successMessage && (
        <Alert>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <EventFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={event}
        onSuccess={handleSuccess}
      />
    </>
  );
}
