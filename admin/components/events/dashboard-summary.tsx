// admin/components/events/dashboard-summary.tsx
// ログイン直後（イベント一覧トップ）の直近イベントサマリ。
// 4指標を大きな数字で表示する。サーバーで集計済みの値を受け取る presentational component。
import { Card, CardContent } from "@/components/ui/card";
import type { DashboardSummary } from "@/lib/data/dashboard";

function formatDate(date: string | null): string {
  if (!date) return "開催日未定";
  const d = new Date(date);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

interface StatProps {
  label: string;
  value: number;
  suffix?: string;
  accent?: boolean;
  sub?: string;
}

function Stat({ label, value, suffix = "人", accent = false, sub }: StatProps) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`mt-1 text-4xl font-semibold tabular-nums ${accent ? "text-primary" : ""}`}>
          {value}
          <span className="ml-1 text-base font-normal text-muted-foreground">{suffix}</span>
        </p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function DashboardSummary({ summary }: { summary: DashboardSummary }) {
  // 直近イベントが無い場合は何も出さない（一覧の空状態に任せる）
  if (!summary.event) return null;

  const { event, totalAttending, answeredCount, drinkCount, lateCount } = summary;
  const rate = totalAttending > 0 ? Math.round((answeredCount / totalAttending) * 100) : 0;

  return (
    <section className="space-y-3">
      <div>
        <p className="text-sm text-muted-foreground">直近のイベント</p>
        <h2 className="text-lg font-semibold">
          {event.title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {formatDate(event.event_date)}
          </span>
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="確定参加者（回答済み）"
          value={answeredCount}
          accent
          sub={`総数 ${totalAttending} 人中 / 確認率 ${rate}%`}
        />
        <Stat label="総人数（参加表明）" value={totalAttending} />
        <Stat label="アルコールあり" value={drinkCount} />
        <Stat label="遅刻予定" value={lateCount} />
      </div>
    </section>
  );
}
