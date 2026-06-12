"use client";

import { useRouter } from "next/navigation";
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

  function handleChange(value: string) {
    // cookie に書き込む（path=/ で全ルートに適用）
    document.cookie = `${COOKIE_KEY}=${value}; path=/; max-age=31536000; SameSite=Lax`;
    // localStorage にも書き込む（UI-SPEC Interaction Contract）
    localStorage.setItem(COOKIE_KEY, value);
    // RSC の再フェッチを起動（UI-SPEC: router.refresh()）
    router.refresh();
  }

  return (
    <Select value={selectedOaId ?? undefined} onValueChange={handleChange}>
      <SelectTrigger className="max-w-[280px]">
        <SelectValue placeholder="OAを選択..." />
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
