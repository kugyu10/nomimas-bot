"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const COOKIE_KEY = "nomimas_selected_oa_id";

interface OaConfig {
  id: string;
  name: string;
}

interface OaSelectorProps {
  myOas: OaConfig[];
  selectedOaId: string | null;
}

export function OaSelector({ myOas, selectedOaId }: OaSelectorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    // cookie に書き込む（path=/ で全ルートに適用。https では Secure を付与 — IN-03）
    // 注: localStorage への複製は読み手が存在しない dead write だったため削除（IN-03）
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_KEY}=${value}; path=/; max-age=31536000; SameSite=Lax${secure}`;
    // RSC の再フェッチを起動（useTransition で包み isPending 中スピナー表示）
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <Select value={selectedOaId ?? undefined} onValueChange={handleChange}>
      <SelectTrigger
        className="max-w-[280px]"
        aria-busy={isPending}
        aria-label={isPending ? "OAを切替中..." : undefined}
      >
        <SelectValue placeholder="OAを選択..." />
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 opacity-50" />
        )}
      </SelectTrigger>
      <SelectContent>
        {myOas.map((oa) => (
          <SelectItem key={oa.id} value={oa.id}>
            {oa.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
