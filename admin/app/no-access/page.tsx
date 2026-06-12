import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function NoAccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8">
        <Alert variant="destructive">
          <AlertTitle>アクセス権限がありません</AlertTitle>
          <AlertDescription>
            このOAへのアクセス権限がありません
          </AlertDescription>
        </Alert>

        <p className="text-sm text-muted-foreground text-center">
          管理者にお問い合わせいただくか、別のアカウントでログインしてください。
        </p>

        <form action={signOut}>
          <Button type="submit" variant="outline" className="w-full">
            ログアウト
          </Button>
        </form>
      </div>
    </div>
  );
}
