import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { User, Cpu, type LucideIcon } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import { AccountSection } from "@/components/settings/account-section";
import { ModelsSection } from "@/components/settings/models-section";

export const Route = createFileRoute("/_auth/settings")({
  component: SettingsPage,
});

type TabId = "account" | "models";

interface NavItem {
  id: TabId;
  label: string;
  icon: LucideIcon;
  superAdmin?: boolean;
}

const NAV: NavItem[] = [
  { id: "account", label: "Account", icon: User },
  { id: "models", label: "Model Master", icon: Cpu, superAdmin: true },
];

function SettingsPage() {
  const isSuperAdmin = useAuthStore((s) => s.user?.role === "SUPER_ADMIN");
  const items = NAV.filter((i) => !i.superAdmin || isSuperAdmin);
  const [active, setActive] = useState<TabId>("account");

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account and platform configuration.</p>
      </header>

      <div className="flex flex-col gap-8 md:flex-row md:items-start">
        <aside className="shrink-0 md:sticky md:top-6 md:w-56">
          <h2 className="mb-3 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Configuration</h2>
          <nav className="flex gap-1 overflow-x-auto pb-2 md:flex-col md:overflow-visible md:pb-0">
            {items.map((item) => {
              const selected = item.id === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
                    selected ? "border border-border bg-surface font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1">
          {active === "account" && <AccountSection />}
          {active === "models" && isSuperAdmin && <ModelsSection />}
        </div>
      </div>
    </div>
  );
}
