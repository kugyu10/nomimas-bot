"use client";
// admin/components/events/events-table.tsx
// イベント一覧テーブル（read-only）
// UI-SPEC: 列 = イベント名 | 開催日 | 参加者数 | 回答済み / 総数 | ステータス | 操作
// 行高 40px（compact: size="sm"）、破壊的操作なし
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EventListItem } from "@/lib/data/events";

interface EventsTableProps {
  events: EventListItem[];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  // YYYY-MM-DD → YYYY/MM/DD
  return dateStr.replace(/-/g, "/");
}

export function EventsTable({ events }: EventsTableProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        {/* UI-SPEC Copywriting Contract: empty state */}
        <p className="text-base font-semibold text-foreground">まだイベントがありません</p>
        <p className="mt-2 text-sm text-muted-foreground">
          右上の「+ イベントを作成」からイベントを追加してください
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      {/* UI-SPEC: size="sm" → row height 40px (compact) */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>イベント名</TableHead>
            <TableHead>開催日</TableHead>
            <TableHead className="text-right">参加者数</TableHead>
            <TableHead className="text-right">回答済み / 総数</TableHead>
            <TableHead>ステータス</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id} className="h-10">
              <TableCell className="font-medium">{event.title}</TableCell>
              <TableCell>{formatDate(event.event_date)}</TableCell>
              <TableCell className="text-right">{event.participant_count}</TableCell>
              <TableCell className="text-right">
                {event.answered_count} / {event.participant_count}
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">—</span>
              </TableCell>
              <TableCell className="text-right">
                {/* UI-SPEC: "詳細" link button size="sm" */}
                <Button asChild size="sm" variant="outline">
                  <Link href={`/events/${event.id}`}>詳細</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
