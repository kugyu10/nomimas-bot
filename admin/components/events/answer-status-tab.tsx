// admin/components/events/answer-status-tab.tsx
// 回答状況タブ（ADMIN-01）— read-only RSC 互換（純粋な表示コンポーネント）
// UI-SPEC: 回答状況タブ（Table: 参加者名 | LINE表示名 | Q1..Qn | 全体ステータス badge）
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { buildAnswerStatusRows } from "@/lib/answer-status";
import type { ParticipantWithAnswers, QuestionDef, ConfirmStatusKey } from "@/lib/answer-status";
import { SendParticipantButton } from "@/components/events/send-participant-button";

// UI-SPEC Status Badge Reference — confirm_status → className
const confirmStatusStyles: Record<ConfirmStatusKey, string> = {
  pending:     "bg-yellow-100 text-yellow-800 border-yellow-200",
  sent:        "bg-blue-100 text-blue-800 border-blue-200",
  in_progress: "bg-purple-100 text-purple-800 border-purple-200",
  completed:   "bg-green-100 text-green-800 border-green-200",
};

interface AnswerStatusTabProps {
  participants: ParticipantWithAnswers[];
  questions: QuestionDef[];
  /** 個別最終確認の送信ボタン用（紐付け済み参加者の行に表示） */
  eventId: string;
}

/** 回答テキストを 20 字で truncate する（tooltip で全文表示） */
function truncate(text: string, max = 20): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

export function AnswerStatusTab({ participants, questions, eventId }: AnswerStatusTabProps) {
  // 参加者が1人もいないときのみ空状態。回答0件でも表は出す
  // （ここから個別に最終確認を送信できるようにするため — 未回答者にこそ送りたい）
  if (participants.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-sm text-muted-foreground">参加者がいません</p>
      </div>
    );
  }

  const rows = buildAnswerStatusRows(participants, questions);

  return (
    <TooltipProvider>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>参加者名</TableHead>
              <TableHead>LINE表示名</TableHead>
              {questions.map((q, i) => (
                <TableHead key={q.id}>Q{i + 1}</TableHead>
              ))}
              <TableHead>全体ステータス</TableHead>
              <TableHead className="text-right">最終確認</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.participantId}>
                <TableCell className="font-medium">{row.participantName}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.lineDisplayName ?? "—"}
                </TableCell>
                {row.answerCells.map((cell) => (
                  <TableCell key={cell.questionKey}>
                    {cell.value === "—" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : cell.value.length > 20 ? (
                      // 20字超はツールチップで全文表示
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default underline decoration-dotted">
                            {truncate(cell.value)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-sm">{cell.value}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      cell.value
                    )}
                  </TableCell>
                ))}
                <TableCell>
                  <Badge
                    variant="outline"
                    className={confirmStatusStyles[row.statusKey]}
                    aria-label={row.statusLabel}
                  >
                    {row.statusLabel}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {row.isLinked ? (
                    <SendParticipantButton
                      participantId={row.participantId}
                      eventId={eventId}
                      participantName={row.participantName}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">未紐付け</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
