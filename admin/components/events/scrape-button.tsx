"use client";
// admin/components/events/scrape-button.tsx
// 参加者を取得ボタン（scraper Edge Function トリガー）
// UI-SPEC Interaction Contract: 参加者を取得
// - 実行中 disabled + スピナー
// - 成功: 「参加者の取得が完了しました（{n}件）」inline alert
// - 失敗: 「参加者の取得に失敗しました。URLを確認してもう一度お試しください」
// - 応答後に再有効化
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { triggerScrape } from "@/lib/actions/events";

interface ScrapeButtonProps {
  eventId: string;
}

export function ScrapeButton({ eventId }: ScrapeButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { success: boolean; message: string } | null
  >(null);
  const router = useRouter();

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      try {
        const res = await triggerScrape(eventId);
        if (res.success) {
          // UI-SPEC: 「参加者の取得が完了しました（{n}件）」
          setResult({
            success: true,
            message: `参加者の取得が完了しました（${res.count ?? 0}件）`,
          });
          router.refresh();
        } else {
          setResult({
            success: false,
            // UI-SPEC Copywriting Contract: error — scrape failed
            message:
              res.error ??
              "参加者の取得に失敗しました。URLを確認してもう一度お試しください",
          });
        }
      } catch {
        setResult({
          success: false,
          message:
            "参加者の取得に失敗しました。URLを確認してもう一度お試しください",
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {/* UI-SPEC: "参加者を取得" outline button */}
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={isPending}
        className="w-fit"
      >
        {isPending && <Loader2Icon className="size-4 mr-2 animate-spin" />}
        参加者を取得
      </Button>
      {result && (
        <Alert variant={result.success ? "default" : "destructive"}>
          <AlertDescription>{result.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
