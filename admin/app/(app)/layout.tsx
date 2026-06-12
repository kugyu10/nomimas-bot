import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { listMyOas, resolveSelectedOaId } from "@/lib/data/oa";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user) {
    redirect("/login");
  }

  const myOas = await listMyOas(supabase);
  if (myOas.length === 0) {
    redirect("/no-access");
  }

  // OA セレクタの選択値を cookie から読む
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get("nomimas_selected_oa_id")?.value;
  const selectedOaId = resolveSelectedOaId(cookieValue, myOas);

  // 表示名: X の screen_name か email フォールバック（UI-SPEC: @{screen_name}）
  const screenName =
    user.user_metadata?.user_name ??
    user.user_metadata?.preferred_username ??
    user.email ??
    "User";
  const displayName = user.user_metadata?.user_name ? `@${screenName}` : screenName;

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader
            myOas={myOas}
            selectedOaId={selectedOaId}
            displayName={displayName}
          />
          {/* UI-SPEC Shell: main content padding 24px (lg) */}
          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
