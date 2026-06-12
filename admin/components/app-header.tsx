import { signOut } from "@/lib/actions/auth";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OaSelector } from "@/components/oa-selector";

interface OaConfig {
  id: string;
  name: string;
}

interface AppHeaderProps {
  myOas: OaConfig[];
  selectedOaId: string | null;
  displayName: string;
}

export function AppHeader({ myOas, selectedOaId, displayName }: AppHeaderProps) {
  // UI-SPEC: header 48px sticky top-0, z-50, bg-background, border-b
  return (
    <header className="sticky top-0 z-50 flex h-12 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <div className="flex flex-1 items-center gap-4">
        <OaSelector myOas={myOas} selectedOaId={selectedOaId} />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="hidden sm:inline-block max-w-[120px] truncate">
              {displayName}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <form action={signOut}>
              <button type="submit" className="w-full text-left">
                ログアウト
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
