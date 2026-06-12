"use client";
// admin/components/events/event-form-dialog.tsx
// イベント作成/編集ダイアログ
// - react-hook-form + zodResolver(eventFormSchema)
// - on blur リアルタイム zod 検証
// - UI-SPEC Copywriting Contract 準拠
import { useState, useTransition } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, TrashIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from "@/components/ui/field";
import {
  eventFormSchema,
  extractTimeJst,
  type EventFormValues,
  CONFIRM_DAYS_OPTIONS,
} from "@/lib/schemas/event";
import { createEvent, updateEvent } from "@/lib/actions/events";
import type { PlatformUrlRow } from "@/lib/data/events";

// ダイアログに必要なイベント詳細の型
export interface EventDetailProp {
  id: string;
  title: string;
  event_date: string | null;
  meeting_at: string | null;
  meeting_place: string | null;
  fee: string | null;
  venue_info: string | null;
  confirm_days_before: number;
  platform_urls: PlatformUrlRow[];
}

interface EventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 編集モード: 既存イベント詳細を渡す */
  event?: EventDetailProp;
  /** 保存成功時コールバック */
  onSuccess?: () => void;
}

/** イベント詳細から EventFormValues を組み立てる */
// meeting_at は PostgREST が UTC で返すため extractTimeJst で JST に変換して
// HH:mm を取り出す（WR-01: 文字列直読みは -9h の往復破壊を起こす）
function eventToFormValues(event: EventDetailProp): EventFormValues {
  return {
    title: event.title,
    event_date: event.event_date ?? "",
    meeting_time: extractTimeJst(event.meeting_at),
    meeting_place: event.meeting_place ?? "",
    fee: event.fee ?? "",
    venue_info: event.venue_info ?? "",
    confirm_days_before: (
      CONFIRM_DAYS_OPTIONS.includes(event.confirm_days_before as (typeof CONFIRM_DAYS_OPTIONS)[number])
        ? event.confirm_days_before
        : 3
    ) as (typeof CONFIRM_DAYS_OPTIONS)[number],
    platform_urls: event.platform_urls.length > 0
      ? event.platform_urls.map((pu) => ({ platform: "twipla" as const, url: pu.url }))
      : [{ platform: "twipla" as const, url: "" }],
  };
}

const defaultValues: EventFormValues = {
  title: "",
  event_date: "",
  meeting_time: "",
  meeting_place: "",
  fee: "",
  venue_info: "",
  confirm_days_before: 3,
  platform_urls: [{ platform: "twipla", url: "" }],
};

export function EventFormDialog({
  open,
  onOpenChange,
  event,
  onSuccess,
}: EventFormDialogProps) {
  const isEdit = Boolean(event);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isValid },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: event ? eventToFormValues(event) : defaultValues,
    mode: "onBlur", // リアルタイム zod 検証 on blur（UI-SPEC 要件）
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "platform_urls",
  });

  function handleClose() {
    reset(event ? eventToFormValues(event) : defaultValues);
    setError(null);
    onOpenChange(false);
  }

  function onSubmit(values: EventFormValues) {
    setError(null);
    startTransition(async () => {
      try {
        let result;
        if (isEdit && event) {
          result = await updateEvent(event.id, values);
        } else {
          result = await createEvent(values);
        }
        if (!result.success) {
          setError(result.error ?? "保存に失敗しました。入力内容を確認してもう一度お試しください");
          return;
        }
        // 編集モードでは保存値を維持（defaultValues に戻すと再オープン時に空フォームになる）
        reset(isEdit ? values : defaultValues);
        onOpenChange(false);
        onSuccess?.();
      } catch {
        setError("保存に失敗しました。入力内容を確認してもう一度お試しください");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          {/* UI-SPEC Typography: Heading 20px/600 */}
          <DialogTitle className="text-xl font-semibold">
            {isEdit ? "イベントを編集" : "イベントを作成"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup className="gap-4 py-2">
            {/* イベント名（必須） */}
            <Field>
              <FieldLabel htmlFor="title">
                イベント名 <span className="text-destructive ml-1">*</span>
              </FieldLabel>
              <Input
                id="title"
                {...register("title")}
                placeholder="例: 第12回 渋谷もくもく会"
                aria-invalid={!!errors.title}
              />
              <FieldError errors={errors.title ? [errors.title] : []} />
            </Field>

            {/* 開催日（必須） */}
            <Field>
              <FieldLabel htmlFor="event_date">
                開催日 <span className="text-destructive ml-1">*</span>
              </FieldLabel>
              <Input
                id="event_date"
                type="date"
                {...register("event_date")}
                aria-invalid={!!errors.event_date}
              />
              <FieldError errors={errors.event_date ? [errors.event_date] : []} />
            </Field>

            {/* 集合時刻（任意） */}
            <Field>
              <FieldLabel htmlFor="meeting_time">集合時刻</FieldLabel>
              <Input
                id="meeting_time"
                type="time"
                {...register("meeting_time")}
              />
            </Field>

            {/* 場所（任意） */}
            <Field>
              <FieldLabel htmlFor="meeting_place">場所</FieldLabel>
              <Input
                id="meeting_place"
                {...register("meeting_place")}
                placeholder="例: 渋谷ヒカリエ 8F"
              />
            </Field>

            {/* 参加費（任意） */}
            <Field>
              <FieldLabel htmlFor="fee">参加費</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="fee"
                  {...register("fee")}
                  placeholder="例: 3000"
                  className="flex-1"
                />
                {/* UI-SPEC: suffix "円" */}
                <span className="text-sm text-muted-foreground">円</span>
              </div>
            </Field>

            {/* 店情報・備考（任意） */}
            <Field>
              <FieldLabel htmlFor="venue_info">店情報 / 備考</FieldLabel>
              <Textarea
                id="venue_info"
                {...register("venue_info")}
                placeholder="例: 地下1Fの居酒屋。靴を脱いで入ります"
                rows={3}
              />
            </Field>

            {/* confirm_days_before（select: 1日前/2日前/3日前/5日前/7日前, default 3日前） */}
            <Field>
              <FieldLabel htmlFor="confirm_days_before">最終確認送付タイミング</FieldLabel>
              <Controller
                control={control}
                name="confirm_days_before"
                render={({ field }) => (
                  <Select
                    value={String(field.value)}
                    onValueChange={(v) => field.onChange(Number(v))}
                  >
                    <SelectTrigger id="confirm_days_before">
                      <SelectValue placeholder="選択してください" />
                    </SelectTrigger>
                    <SelectContent>
                      {/* UI-SPEC Copywriting Contract: 1日前/2日前/3日前/5日前/7日前 */}
                      {CONFIRM_DAYS_OPTIONS.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d}日前
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError
                errors={
                  errors.confirm_days_before ? [errors.confirm_days_before] : []
                }
              />
            </Field>

            {/* プラットフォームURL（min 1, 繰り返しグループ） */}
            <Field>
              <FieldLabel>
                プラットフォームURL <span className="text-destructive ml-1">*</span>
              </FieldLabel>
              <div className="flex flex-col gap-2">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex gap-2 items-start">
                    {/* プラットフォーム種別 select（v1: twipla のみ） */}
                    <Controller
                      control={control}
                      name={`platform_urls.${index}.platform`}
                      render={({ field: f }) => (
                        <Select
                          value={f.value}
                          onValueChange={f.onChange}
                        >
                          <SelectTrigger className="w-28 shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="twipla">Twipla</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {/* URL input */}
                    <div className="flex-1 flex flex-col gap-1">
                      <Input
                        {...register(`platform_urls.${index}.url`)}
                        placeholder="https://twipla.jp/events/123456"
                        aria-invalid={!!errors.platform_urls?.[index]?.url}
                      />
                      {errors.platform_urls?.[index]?.url && (
                        <p className="text-xs text-destructive">
                          {errors.platform_urls[index].url.message}
                        </p>
                      )}
                    </div>
                    {/* 削除ボタン（min 1 を維持） */}
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => remove(index)}
                        className="shrink-0 text-muted-foreground"
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {/* + URL 追加ボタン */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-1 w-full"
                onClick={() => append({ platform: "twipla", url: "" })}
              >
                <PlusIcon className="size-4 mr-1" />
                +URL追加
              </Button>
              {errors.platform_urls?.root && (
                <p className="text-xs text-destructive">
                  {errors.platform_urls.root.message}
                </p>
              )}
              {/* min 1 エラー（配列レベル） */}
              {typeof errors.platform_urls?.message === "string" && (
                <p className="text-xs text-destructive">
                  {errors.platform_urls.message}
                </p>
              )}
            </Field>
          </FieldGroup>

          {/* フッター下エラー表示 */}
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* UI-SPEC Dialog footer: [閉じる(ghost)] [イベントを保存(accent)] */}
          <DialogFooter className="mt-6 gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isPending}
            >
              閉じる
            </Button>
            {/* UI-SPEC: "イベントを保存" disabled until form is valid */}
            <Button
              type="submit"
              disabled={!isValid || isPending}
              className="bg-zinc-900 text-white hover:bg-zinc-800"
            >
              {isPending ? "保存中..." : "イベントを保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
