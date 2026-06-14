"use client";
// admin/components/events/send-participant-button.tsx
// 個別最終確認 送信ボタン（紐付けタブ「紐付け済み」リストの各行）
// - 押下で確認ダイアログ（実LINE送信のため誤配信防止）
// - confirm_status / status に関係なく送信し、既存回答を消して1問目からクリーン再開
// - 結果は inline alert で表示
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { sendParticipantConfirmation } from "@/lib/actions/events";

interface SendParticipantButtonProps {
  participantId: string;
  eventId: string;
  participantName: string;
}

export function SendParticipantButton({
  participantId,
  eventId,
  participantName,
}: SendParticipantButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const router = useRouter();

  function handleConfirm() {
    setResult(null);
    startTransition(async () => {
      try {
        const res = await sendParticipantConfirmation(participantId, eventId);
        if (res.success) {
          setResult({
            success: (res.sent ?? 0) > 0,
            message:
              (res.sent ?? 0) > 0
                ? "最終確認メッセージを送信しました"
                : "送信できませんでした（紐付けを確認してください）",
          });
          router.refresh();
        } else {
          setResult({
            success: false,
            message: res.error ?? "配信に失敗しました。時間をおいてもう一度お試しください",
          });
        }
      } catch {
        setResult({
          success: false,
          message: "配信に失敗しました。時間をおいてもう一度お試しください",
        });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={isPending}>
            {isPending ? (
              <Loader2Icon className="size-4 mr-1 animate-spin" />
            ) : (
              <SendIcon className="size-4 mr-1" />
            )}
            送信
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>最終確認メッセージを送信しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {participantName} さんへ、LINEで最終確認メッセージを今すぐ送信します。
              送信済み・回答済みの場合も、これまでの回答を消して1問目から送り直します。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>送信しない</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>送信する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {result && (
        <Alert variant={result.success ? "default" : "destructive"} className="py-1.5">
          <AlertDescription className="text-xs">{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
