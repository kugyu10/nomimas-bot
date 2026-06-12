"use client";
/**
 * admin/components/oa/question-list-editor.tsx
 * 質問設定エディタコンポーネント
 * - HTML5 drag&drop による並び替え
 * - キーボード代替（上下移動ボタン）
 * - 質問の追加・削除
 * - 選択肢の追加・削除・編集
 * - テンプレート保存 Dialog（04-UI-SPEC §1）
 * - テンプレート適用 Select + AlertDialog（04-UI-SPEC §2）
 */
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GripVertical, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { TemplateSaveDialog } from "@/components/oa/template-save-dialog";
import { TemplateApplySelect } from "@/components/oa/template-apply-select";
import type { saveQuestionTemplate } from "@/lib/actions/templates";
import type { QuestionTemplate } from "@/lib/data/templates";

export interface QuestionItem {
  id: string;
  text: string;
  options: string[];
}

interface QuestionListEditorProps {
  value: QuestionItem[];
  onChange: (questions: QuestionItem[]) => void;
  oaConfigId?: string;
  templates?: QuestionTemplate[];
  saveTemplateAction?: typeof saveQuestionTemplate;
}

function generateId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function QuestionListEditor({
  value,
  onChange,
  oaConfigId,
  templates,
  saveTemplateAction,
}: QuestionListEditorProps) {
  const questions = value;
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  const addQuestion = useCallback(() => {
    onChange([
      ...questions,
      { id: generateId(), text: "", options: [""] },
    ]);
  }, [questions, onChange]);

  const removeQuestion = useCallback(
    (index: number) => {
      onChange(questions.filter((_, i) => i !== index));
    },
    [questions, onChange],
  );

  const updateQuestion = useCallback(
    (index: number, updated: Partial<QuestionItem>) => {
      onChange(questions.map((q, i) => (i === index ? { ...q, ...updated } : q)));
    },
    [questions, onChange],
  );

  const moveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      const next = [...questions];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      onChange(next);
    },
    [questions, onChange],
  );

  const moveDown = useCallback(
    (index: number) => {
      if (index === questions.length - 1) return;
      const next = [...questions];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      onChange(next);
    },
    [questions, onChange],
  );

  // HTML5 drag&drop handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.dataTransfer.setData("text/plain", String(index));
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
      e.preventDefault();
      const dragIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (isNaN(dragIndex) || dragIndex === dropIndex) return;
      const next = [...questions];
      const [removed] = next.splice(dragIndex, 1);
      next.splice(dropIndex, 0, removed);
      onChange(next);
    },
    [questions, onChange],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  // Option management
  const addOption = useCallback(
    (qIndex: number) => {
      const q = questions[qIndex];
      updateQuestion(qIndex, { options: [...q.options, ""] });
    },
    [questions, updateQuestion],
  );

  const removeOption = useCallback(
    (qIndex: number, oIndex: number) => {
      const q = questions[qIndex];
      updateQuestion(qIndex, { options: q.options.filter((_, i) => i !== oIndex) });
    },
    [questions, updateQuestion],
  );

  const updateOption = useCallback(
    (qIndex: number, oIndex: number, val: string) => {
      const q = questions[qIndex];
      const newOptions = q.options.map((o, i) => (i === oIndex ? val : o));
      updateQuestion(qIndex, { options: newOptions });
    },
    [questions, updateQuestion],
  );

  const handleSaveSuccess = useCallback(() => {
    setSaveSuccessMessage("テンプレートを保存しました");
    setTimeout(() => setSaveSuccessMessage(null), 4000);
  }, []);

  const handleApplyTemplate = useCallback(
    (newQuestions: QuestionItem[]) => {
      onChange(newQuestions);
    },
    [onChange],
  );

  return (
    <div className="space-y-4">
      {/* テンプレート適用 Select（04-UI-SPEC §2 — 質問リスト上部） */}
      {templates !== undefined && (
        <TemplateApplySelect
          templates={templates}
          currentQuestions={questions}
          onApply={handleApplyTemplate}
        />
      )}

      {/* テンプレート保存成功 Alert（4秒 auto-dismiss） */}
      {saveSuccessMessage && (
        <Alert variant="default">
          <AlertDescription>{saveSuccessMessage}</AlertDescription>
        </Alert>
      )}

      {questions.map((q, qIndex) => (
        <div
          key={q.id}
          className="rounded-md border bg-card p-4 space-y-3"
          draggable
          onDragStart={(e) => handleDragStart(e, qIndex)}
          onDrop={(e) => handleDrop(e, qIndex)}
          onDragOver={handleDragOver}
        >
          {/* Question header: drag handle + index + move buttons + delete */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="cursor-grab text-muted-foreground hover:text-foreground touch-none"
              aria-label="ドラッグして並び替え"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-muted-foreground min-w-[2rem]">
              Q{qIndex + 1}
            </span>
            <div className="flex gap-1 ml-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => moveUp(qIndex)}
                disabled={qIndex === 0}
                aria-label="上に移動"
                className="h-7 w-7 p-0"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => moveDown(qIndex)}
                disabled={qIndex === questions.length - 1}
                aria-label="下に移動"
                className="h-7 w-7 p-0"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeQuestion(qIndex)}
                aria-label="質問を削除"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Question text */}
          <div className="space-y-1.5">
            <Label className="text-xs">質問テキスト</Label>
            <Input
              value={q.text}
              onChange={(e) => updateQuestion(qIndex, { text: e.target.value })}
              placeholder="質問を入力してください"
            />
          </div>

          {/* Options */}
          <div className="space-y-2">
            <Label className="text-xs">選択肢</Label>
            {q.options.map((opt, oIndex) => (
              <div key={oIndex} className="flex gap-2 items-center">
                <Input
                  value={opt}
                  onChange={(e) => updateOption(qIndex, oIndex, e.target.value)}
                  placeholder={`選択肢 ${oIndex + 1}`}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeOption(qIndex, oIndex)}
                  disabled={q.options.length <= 1}
                  aria-label="選択肢を削除"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addOption(qIndex)}
              className="mt-1"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              選択肢を追加
            </Button>
          </div>
        </div>
      ))}

      {/* アクションエリア: 「質問を追加」と「テンプレートとして保存」を同列 flex gap-2 */}
      <div className="flex gap-2 flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addQuestion}
        >
          <Plus className="h-4 w-4 mr-1" />
          質問を追加
        </Button>

        {/* テンプレート保存トリガー（04-UI-SPEC §1） */}
        {oaConfigId && saveTemplateAction && (
          <TemplateSaveDialog
            oaConfigId={oaConfigId}
            questions={questions}
            onSaveSuccess={handleSaveSuccess}
            saveAction={saveTemplateAction}
          />
        )}
      </div>
    </div>
  );
}
