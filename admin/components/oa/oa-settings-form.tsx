"use client";
/**
 * admin/components/oa/oa-settings-form.tsx
 * OA設定フォーム（クライアントコンポーネント）
 * 3カード構成:
 *   (a) 基本情報: OA名 / チャンネルID(read-only) / 管理者TwitterID(s)
 *   (b) 定型文: 最終確認メッセージ冒頭 / 完了メッセージ
 *   (c) 質問設定: question-list-editor
 *
 * フッター: 「設定を保存」 accent ボタン（desktop 右寄せ / mobile full-width）
 */
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { QuestionListEditor } from "@/components/oa/question-list-editor";
import { oaSettingsSchema, type OaSettingsInput } from "@/lib/schemas/oa";
import { saveOaSettings } from "@/lib/actions/oa";
import { saveQuestionTemplate } from "@/lib/actions/templates";
import type { OaConfigDetail } from "@/lib/data/oa";
import type { QuestionTemplate } from "@/lib/data/templates";

interface OaSettingsFormProps {
  oaConfig: OaConfigDetail;
  templates?: QuestionTemplate[];
}

export function OaSettingsForm({ oaConfig, templates }: OaSettingsFormProps) {
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<OaSettingsInput>({
    resolver: zodResolver(oaSettingsSchema),
    defaultValues: {
      name: oaConfig.name ?? "",
      admin_twitter_id: oaConfig.admin_twitter_id ?? "",
      greeting_message: oaConfig.greeting_message ?? "",
      completion_message: oaConfig.completion_message ?? "",
      questions: Array.isArray(oaConfig.questions) ? oaConfig.questions : [],
    },
  });

  const onSubmit = async (data: OaSettingsInput) => {
    setIsSaving(true);
    setSaveResult(null);
    try {
      const result = await saveOaSettings(oaConfig.id, data);
      if (result.success) {
        setSaveResult({ success: true, message: "設定を保存しました" });
      } else {
        setSaveResult({
          success: false,
          message: result.error ?? "保存に失敗しました。入力内容を確認してもう一度お試しください",
        });
      }
    } catch {
      setSaveResult({
        success: false,
        message: "保存に失敗しました。入力内容を確認してもう一度お試しください",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* ============================================================
          カード (a): 基本情報
          UI-SPEC: OA名 / チャンネルID(read-only, monospace 12px/400) / 管理者TwitterID
      ============================================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">基本情報</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            OAの基本設定を管理します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* OA名 */}
          <div className="space-y-1.5">
            <Label htmlFor="name">OA名</Label>
            <Input
              id="name"
              {...register("name")}
              placeholder="OA名を入力してください"
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* チャンネルID (read-only, monospace 12px/400) */}
          <div className="space-y-1.5">
            <Label htmlFor="channel-id">チャンネルID</Label>
            <Input
              id="channel-id"
              value={oaConfig.line_channel_id ?? "（未設定）"}
              readOnly
              className="font-mono text-xs text-muted-foreground bg-muted cursor-not-allowed"
            />
          </div>

          {/* 管理者TwitterID(s) */}
          <div className="space-y-1.5">
            <Label htmlFor="admin_twitter_id">管理者TwitterID(s)</Label>
            <Input
              id="admin_twitter_id"
              {...register("admin_twitter_id")}
              placeholder="例: @alice,@bob（カンマ区切り）"
            />
            <p className="text-xs text-muted-foreground">
              カンマ区切りで複数入力できます。@ は自動で除去されます。
            </p>
            {errors.admin_twitter_id && (
              <p className="text-xs text-destructive">{errors.admin_twitter_id.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ============================================================
          カード (b): 定型文
          UI-SPEC: 最終確認メッセージ冒頭 (greeting_message) / 完了メッセージ (completion_message)
      ============================================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">定型文</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            参加者への送信メッセージのテンプレートを設定します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 最終確認メッセージ冒頭 */}
          <div className="space-y-1.5">
            <Label htmlFor="greeting_message">最終確認メッセージ冒頭</Label>
            <Textarea
              id="greeting_message"
              {...register("greeting_message")}
              placeholder="最終確認の冒頭文を入力してください"
              rows={3}
            />
            {errors.greeting_message && (
              <p className="text-xs text-destructive">{errors.greeting_message.message}</p>
            )}
          </div>

          {/* 完了メッセージ */}
          <div className="space-y-1.5">
            <Label htmlFor="completion_message">完了メッセージ</Label>
            <Textarea
              id="completion_message"
              {...register("completion_message")}
              placeholder="回答完了時のメッセージを入力してください"
              rows={3}
            />
            {errors.completion_message && (
              <p className="text-xs text-destructive">{errors.completion_message.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ============================================================
          カード (c): 質問設定
          UI-SPEC: ordered list of question items + drag reorder + add/remove
      ============================================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">質問設定</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            参加者への確認質問を設定します。ドラッグまたは上下ボタンで並び替えができます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Controller
            name="questions"
            control={control}
            render={({ field }) => (
              <QuestionListEditor
                value={field.value ?? []}
                onChange={field.onChange}
                oaConfigId={oaConfig.id}
                templates={templates}
                saveTemplateAction={saveQuestionTemplate}
              />
            )}
          />
          {errors.questions && (
            <p className="text-xs text-destructive mt-2">
              {Array.isArray(errors.questions)
                ? errors.questions.map((e) => e?.text?.message || e?.options?.message).filter(Boolean).join("; ")
                : (errors.questions as { message?: string })?.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* フィードバック */}
      {saveResult && (
        <Alert variant={saveResult.success ? "default" : "destructive"}>
          <AlertDescription>{saveResult.message}</AlertDescription>
        </Alert>
      )}

      {/* ============================================================
          フッター: 「設定を保存」 accent ボタン
          UI-SPEC: desktop 右寄せ / mobile full-width
      ============================================================ */}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isSaving}
          className="w-full sm:w-auto"
        >
          {isSaving ? "保存中..." : "設定を保存"}
        </Button>
      </div>
    </form>
  );
}
