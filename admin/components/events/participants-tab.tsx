"use client";
// admin/components/events/participants-tab.tsx
// 参加者タブ（read-only）
// UI-SPEC: 列 = Twipla参加者名 | Xアカウント | 取得日時 | 紐付けステータス(badge)
// 空状態: 「参加者がいません」+ body copy
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ParticipantWithScrapeTime } from "@/lib/data/participants";

// UI-SPEC Status Badge Reference: linkStatusStyles
const linkStatusStyles = {
  linked: "bg-green-100 text-green-800 border-green-200",
  unlinked: "bg-orange-100 text-orange-700 border-orange-200",
} as const;

function formatDateTime(dt: string | null): string {
  if (!dt) return "—";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

interface ParticipantsTabProps {
  participants: ParticipantWithScrapeTime[];
}

export function ParticipantsTab({ participants }: ParticipantsTabProps) {
  if (participants.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        {/* UI-SPEC Copywriting Contract: empty state */}
        <p className="text-base font-semibold text-foreground">参加者がいません</p>
        <p className="mt-2 text-sm text-muted-foreground">
          「参加者を取得」ボタンを押してTwiplaから取得してください
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Twipla参加者名</TableHead>
            <TableHead>Xアカウント</TableHead>
            <TableHead>取得日時</TableHead>
            <TableHead>紐付けステータス</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {participants.map((p) => {
            const linkStatus = p.line_user_id ? "linked" : "unlinked";
            return (
              <TableRow key={p.id} className="h-10">
                <TableCell className="font-medium">{p.display_name}</TableCell>
                <TableCell>
                  {p.screen_name ? `@${p.screen_name}` : "—"}
                </TableCell>
                <TableCell>{formatDateTime(p.scraped_at)}</TableCell>
                <TableCell>
                  {/* UI-SPEC Status Badge Reference: linkStatusStyles */}
                  <Badge
                    variant="outline"
                    className={linkStatusStyles[linkStatus]}
                  >
                    {linkStatus === "linked" ? "紐付け済み" : "未紐付け"}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
