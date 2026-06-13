"use client";
// admin/components/events/send-confirmations-button.tsx
// 最終確認メッセージ手動配信ボタン（message-sender 手動モードをトリガー）
// - 押下で確認ダイアログ（誤配信防止 — 実LINE送信のため）
// - 確認後 sendEventConfirmations を呼び、結果を inline alert で表示
// - 既に送信済み(sent)の人には送られない（未確認者のみが対象）
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
import { sendEventConfirmations } from "@/lib/actions/events";

interface SendConfirmationsButtonProps {
  eventId: string;
}

export function SendConfirmationsButton({ eventId }: SendConfirmationsButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const router = useRouter();

  function handleConfirm() {
    setResult(null);
    startTransition(async () => {
      try {
        const res = await sendEventConfirmations(eventId);
        if (res.success) {
          const sent = res.sent ?? 0;
          const failed = res.failed ?? 0;
          setResult({
            success: true,
            message:
              failed > 0
                ? `${sent}件に配信しました（${failed}件は送信できませんでした）`
                : sent > 0
                  ? `${sent}件に最終確認メッセージを配信しました`
                  : "配信対象（未確認の紐付け済み参加者）がいませんでした",
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
    <div className="flex flex-col gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={isPending} className="w-fit">
            {isPending ? (
              <Loader2Icon className="size-4 mr-2 animate-spin" />
            ) : (
              <SendIcon className="size-4 mr-2" />
            )}
            最終確認を配信
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>最終確認メッセージを配信しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              このイベントの「参加表明あり・未確認・LINE紐付け済み」の参加者へ、
              LINEで最終確認メッセージを今すぐ送信します。すでに配信済みの人には送られません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>配信しない</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>最終確認を配信</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {result && (
        <Alert variant={result.success ? "default" : "destructive"}>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
