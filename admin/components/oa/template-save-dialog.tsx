"use client";
/**
 * admin/components/oa/template-save-dialog.tsx
 * テンプレート保存 Dialog（04-UI-SPEC §1 準拠）
 *
 * トリガー: 「テンプレートとして保存」ボタン（questions 0件時 disabled + Tooltip）
 * Dialog: テンプレート名入力 → saveQuestionTemplate server action → 成功/失敗フィードバック
 */
import { useState } from "react";
import { BookmarkPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { QuestionItem } from "@/components/oa/question-list-editor";
import type { saveQuestionTemplate } from "@/lib/actions/templates";

interface TemplateSaveDialogProps {
  oaConfigId: string;
  questions: QuestionItem[];
  onSaveSuccess: () => void;
  saveAction: typeof saveQuestionTemplate;
}

export function TemplateSaveDialog({
  oaConfigId,
  questions,
  onSaveSuccess,
  saveAction,
}: TemplateSaveDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isDisabled = questions.length === 0;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!isSaving) {
      setOpen(nextOpen);
      if (!nextOpen) {
        // reset state on close
        setName("");
        setSaveError(null);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSaving) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const result = await saveAction(oaConfigId, { name: name.trim(), questions });
      if (result.success) {
        setOpen(false);
        setName("");
        setSaveError(null);
        onSaveSuccess();
      } else {
        setSaveError(
          result.error ?? "テンプレートの保存に失敗しました。もう一度お試しください",
        );
      }
    } catch {
      setSaveError("テンプレートの保存に失敗しました。もう一度お試しください");
    } finally {
      setIsSaving(false);
    }
  };

  const triggerButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isDisabled}
      onClick={() => !isDisabled && setOpen(true)}
      aria-disabled={isDisabled}
    >
      <BookmarkPlus className="h-4 w-4 mr-1" />
      テンプレートとして保存
    </Button>
  );

  return (
    <>
      {isDisabled ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{triggerButton}</TooltipTrigger>
            <TooltipContent>質問がありません</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        triggerButton
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent aria-label="テンプレートを保存するダイアログ">
          <DialogHeader>
            <DialogTitle>テンプレートとして保存</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="template-name" className="text-xs">
                テンプレート名
              </Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 歓迎会の定型質問セット"
                autoFocus
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">
                現在の質問 {questions.length} 件を保存します
              </p>
            </div>

            {saveError && (
              <p className="text-sm text-destructive">{saveError}</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={isSaving}
              >
                保存しない
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || isSaving}
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                テンプレートとして保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
