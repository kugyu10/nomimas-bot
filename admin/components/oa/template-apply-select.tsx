"use client";
/**
 * admin/components/oa/template-apply-select.tsx
 * テンプレート適用 Select + AlertDialog（04-UI-SPEC §2 準拠）
 *
 * - Select: アクセス可能な全OAのテンプレート一覧（RLS がスコープ）
 * - 「テンプレートを適用」ボタンで AlertDialog 確認
 * - Confirm: クライアント側 questions 置換のみ（サーバー呼び出しなし — UI-SPEC Locked）
 * - Cancel: 選択保持
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { QuestionItem } from "@/components/oa/question-list-editor";
import type { QuestionTemplate } from "@/lib/data/templates";

interface TemplateApplySelectProps {
  templates: QuestionTemplate[];
  currentQuestions: QuestionItem[];
  onApply: (questions: QuestionItem[]) => void;
}

export function TemplateApplySelect({
  templates,
  currentQuestions,
  onApply,
}: TemplateApplySelectProps) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [alertOpen, setAlertOpen] = useState(false);

  const selectedTemplate = templates.find((t) => t.id === selectedId) ?? null;

  const handleApplyClick = () => {
    if (!selectedTemplate) return;
    setAlertOpen(true);
  };

  const handleConfirm = () => {
    if (!selectedTemplate) return;
    // クライアント側 questions 置換のみ（サーバー呼び出しなし — UI-SPEC Locked）
    onApply(selectedTemplate.questions as QuestionItem[]);
    setAlertOpen(false);
    setSelectedId(""); // Select をリセット
  };

  const handleCancel = () => {
    // 選択保持のまま AlertDialog を閉じる
    setAlertOpen(false);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">テンプレートを適用</p>
      <div className="flex items-center gap-2">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="max-w-[280px]">
            <SelectValue placeholder="テンプレートを選択..." />
          </SelectTrigger>
          <SelectContent>
            {templates.length === 0 ? (
              <SelectItem value="__empty__" disabled>
                保存済みテンプレートがありません
              </SelectItem>
            ) : (
              templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}（{t.questions.length}件の質問）
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!selectedTemplate}
          onClick={handleApplyClick}
        >
          テンプレートを適用
        </Button>
      </div>

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>現在の質問を上書きしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{selectedTemplate?.name}」を適用すると、現在の質問{" "}
              {currentQuestions.length} 件がすべて削除され、テンプレートの質問に置き換わります。
              この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" onClick={handleCancel}>
                適用しない
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="default" onClick={handleConfirm}>
                テンプレートを適用
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
