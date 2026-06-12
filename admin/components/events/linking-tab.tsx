"use client";
// admin/components/events/linking-tab.tsx
// 手動紐付けタブ（ADMIN-02）— client component
// UI-SPEC: 2カラム（左=未紐付け / 右=紐付け済み）
// 紐付け: Combobox（Popover+Command） + 「紐付け」accent ボタン
// 解除: 「紐付けを解除」destructive/outline → AlertDialog 確認
// 楽観的更新 + 失敗時巻き戻し（UI-SPEC Interaction Contract）
import { useState, useTransition } from "react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { linkParticipant, unlinkParticipant } from "@/lib/actions/linking";
import type { UnlinkedParticipant, LinkedParticipant, LineUserCandidate } from "@/lib/data/participants";

interface LinkingTabProps {
  eventId: string;
  initialUnlinked: UnlinkedParticipant[];
  initialLinked: LinkedParticipant[];
  lineUserCandidates: LineUserCandidate[]; // 紐付け済みを除いた全 LINE 友だち候補
  allLineUsers: LineUserCandidate[];       // 全 LINE 友だち（紐付け解除後の候補復元用）
}

export function LinkingTab({
  eventId,
  initialUnlinked,
  initialLinked,
  lineUserCandidates,
  allLineUsers,
}: LinkingTabProps) {
  // 楽観的更新用 state
  const [unlinked, setUnlinked] = useState<UnlinkedParticipant[]>(initialUnlinked);
  const [linked, setLinked] = useState<LinkedParticipant[]>(initialLinked);
  // 既に紐付け済みの line_user_id セット（コンボボックスの除外に使用）
  const [linkedLineUserIds, setLinkedLineUserIds] = useState<Set<string>>(
    new Set(initialLinked.map((p) => p.line_user_id))
  );

  // 各未紐付け参加者に対して選択中の line_user_id を管理
  const [selectedLineUser, setSelectedLineUser] = useState<Record<string, string>>({});
  // コンボボックスの open 状態
  const [comboboxOpen, setComboboxOpen] = useState<Record<string, boolean>>({});

  // エラー表示
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});

  const [isPending, startTransition] = useTransition();

  // 利用可能な LINE 友だち候補（紐付け済みを除外 — リアルタイム反映）
  const availableCandidates = allLineUsers.filter((lu) => !linkedLineUserIds.has(lu.id));

  // 紐付けアクション
  function handleLink(participantId: string) {
    const lineUserId = selectedLineUser[participantId];
    if (!lineUserId) return;

    // 選択した LINE 友だちの情報を取得
    const lineUser = allLineUsers.find((lu) => lu.id === lineUserId);
    if (!lineUser) return;

    // 楽観的更新: 未紐付けから紐付け済みへ移動
    const participant = unlinked.find((p) => p.id === participantId);
    if (!participant) return;

    const optimisticLinked: LinkedParticipant = {
      id: participant.id,
      display_name: participant.display_name,
      screen_name: participant.screen_name,
      line_user_id: lineUserId,
      line_display_name: lineUser.display_name,
    };

    setUnlinked((prev) => prev.filter((p) => p.id !== participantId));
    setLinked((prev) => [...prev, optimisticLinked]);
    setLinkedLineUserIds((prev) => new Set([...prev, lineUserId]));
    setSelectedLineUser((prev) => {
      const next = { ...prev };
      delete next[participantId];
      return next;
    });
    setErrorMap((prev) => {
      const next = { ...prev };
      delete next[participantId];
      return next;
    });

    startTransition(async () => {
      const result = await linkParticipant(participantId, lineUserId, eventId);
      if (!result.success) {
        // 失敗時巻き戻し（UI-SPEC Interaction Contract）
        setLinked((prev) => prev.filter((p) => p.id !== participantId));
        setUnlinked((prev) => [...prev, participant]);
        setLinkedLineUserIds((prev) => {
          const next = new Set(prev);
          next.delete(lineUserId);
          return next;
        });
        setErrorMap((prev) => ({
          ...prev,
          [participantId]: result.error ?? "保存に失敗しました。入力内容を確認してもう一度お試しください",
        }));
      }
    });
  }

  // 解除アクション（AlertDialog confirmed）
  function handleUnlink(participantId: string) {
    const participant = linked.find((p) => p.id === participantId);
    if (!participant) return;

    const lineUserId = participant.line_user_id;

    // 楽観的更新: 紐付け済みから未紐付けへ移動
    const restoredUnlinked: UnlinkedParticipant = {
      id: participant.id,
      display_name: participant.display_name,
      screen_name: participant.screen_name,
    };

    setLinked((prev) => prev.filter((p) => p.id !== participantId));
    setUnlinked((prev) => [...prev, restoredUnlinked]);
    setLinkedLineUserIds((prev) => {
      const next = new Set(prev);
      next.delete(lineUserId);
      return next;
    });

    startTransition(async () => {
      const result = await unlinkParticipant(participantId, eventId);
      if (!result.success) {
        // 失敗時巻き戻し
        setUnlinked((prev) => prev.filter((p) => p.id !== participantId));
        setLinked((prev) => [...prev, participant]);
        setLinkedLineUserIds((prev) => new Set([...prev, lineUserId]));
        setErrorMap((prev) => ({
          ...prev,
          [participantId]: result.error ?? "保存に失敗しました。入力内容を確認してもう一度お試しください",
        }));
      }
    });
  }

  // 全員紐付け済みの空状態
  if (unlinked.length === 0 && linked.length > 0) {
    return (
      <Alert className="border-green-200 bg-green-50 text-green-800">
        <AlertDescription>全員の紐付けが完了しています</AlertDescription>
      </Alert>
    );
  }

  // 参加者がいない場合
  if (unlinked.length === 0 && linked.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-sm text-muted-foreground">参加者がいません</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 未紐付けありの案内 */}
      {unlinked.length > 0 && (
        <Alert className="border-orange-200 bg-orange-50 text-orange-800">
          <AlertDescription>
            紐付けされていない参加者がいます。LINEアカウントと紐付けてください
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 左カラム: 未紐付け参加者リスト */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">未紐付け</h3>
          {unlinked.length === 0 ? (
            <p className="text-sm text-muted-foreground">なし</p>
          ) : (
            <div className="space-y-3">
              {unlinked.map((participant) => (
                <div key={participant.id} className="rounded-md border p-3 space-y-2">
                  <p className="text-sm font-medium">{participant.display_name}</p>

                  {/* エラー表示 */}
                  {errorMap[participant.id] && (
                    <Alert variant="destructive" className="py-2">
                      <AlertDescription className="text-xs">
                        {errorMap[participant.id]}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="flex items-center gap-2">
                    {/* LINE友だち選択コンボボックス（UI-SPEC: Combobox Popover+Command） */}
                    <Popover
                      open={comboboxOpen[participant.id] ?? false}
                      onOpenChange={(open) =>
                        setComboboxOpen((prev) => ({ ...prev, [participant.id]: open }))
                      }
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={comboboxOpen[participant.id] ?? false}
                          className="w-[200px] justify-between text-sm"
                        >
                          {selectedLineUser[participant.id]
                            ? (availableCandidates.find(
                                (lu) => lu.id === selectedLineUser[participant.id]
                              )?.display_name ?? "LINE友だちを選択...")
                            : "LINE友だちを選択..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[320px] p-0" style={{ maxHeight: "280px" }}>
                        <Command>
                          <CommandInput placeholder="LINE友だちを検索..." />
                          <CommandList style={{ maxHeight: "220px", overflowY: "auto" }}>
                            {/* UI-SPEC: no results 文言 */}
                            <CommandEmpty>該当するLINE友だちが見つかりません</CommandEmpty>
                            <CommandGroup>
                              {availableCandidates.map((lu) => (
                                <CommandItem
                                  key={lu.id}
                                  value={lu.display_name ?? lu.line_user_id}
                                  onSelect={() => {
                                    setSelectedLineUser((prev) => ({
                                      ...prev,
                                      [participant.id]:
                                        prev[participant.id] === lu.id ? "" : lu.id,
                                    }));
                                    setComboboxOpen((prev) => ({
                                      ...prev,
                                      [participant.id]: false,
                                    }));
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedLineUser[participant.id] === lu.id
                                        ? "opacity-100"
                                        : "opacity-0"
                                    )}
                                  />
                                  {lu.display_name ?? lu.line_user_id}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {/* 紐付けボタン（UI-SPEC: accent — zinc-900 primary） */}
                    <Button
                      size="sm"
                      className="bg-zinc-900 text-white hover:bg-zinc-700"
                      disabled={!selectedLineUser[participant.id] || isPending}
                      onClick={() => handleLink(participant.id)}
                    >
                      紐付け
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右カラム: 紐付け済みリスト */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">紐付け済み</h3>
          {linked.length === 0 ? (
            <p className="text-sm text-muted-foreground">なし</p>
          ) : (
            <div className="space-y-3">
              {linked.map((participant) => (
                <div
                  key={participant.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{participant.display_name}</p>
                    <p className="text-xs text-muted-foreground">
                      → {participant.line_display_name ?? "（表示名なし）"}
                    </p>
                    {/* エラー表示 */}
                    {errorMap[participant.id] && (
                      <p className="text-xs text-destructive">{errorMap[participant.id]}</p>
                    )}
                  </div>

                  {/* 解除ボタン → AlertDialog */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      {/* UI-SPEC: destructive/outline — red-600 */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={isPending}
                      >
                        紐付けを解除
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        {/* UI-SPEC Copywriting Contract: AlertDialog title */}
                        <AlertDialogTitle>紐付けを解除しますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                          この操作は元に戻せません。「紐付けを解除」を押すと紐付けが削除されます
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        {/* UI-SPEC: cancel = 解除しない */}
                        <AlertDialogCancel>解除しない</AlertDialogCancel>
                        {/* UI-SPEC: confirm = 紐付けを解除（red-600） */}
                        <AlertDialogAction
                          className="bg-red-600 text-white hover:bg-red-700"
                          onClick={() => handleUnlink(participant.id)}
                        >
                          紐付けを解除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
