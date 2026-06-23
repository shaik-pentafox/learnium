import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDashboardSummary, dashboardKeys } from "@/services/dashboard";
import { useAuthStore } from "@/stores/auth";
import { DashboardSkeleton, DashboardError } from "@/components/dashboard/primitives";
import { TraineeDashboard } from "@/components/dashboard/trainee-dashboard";
import { TrainerDashboard } from "@/components/dashboard/trainer-dashboard";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";

export const Route = createFileRoute("/_auth/dashboard")({
  component: DashboardPage,
});

const SUBTITLE: Record<string, string> = {
  USER: "Your recent training activity.",
  TRAINER: "How your team is progressing.",
  SUPER_ADMIN: "Platform activity and LLM usage.",
};

function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { data, isPending, isError, refetch } = useQuery({
    // Scope by user id so switching accounts/roles never serves the previous
    // user's cached summary.
    queryKey: dashboardKeys.summary(user?.id),
    queryFn: getDashboardSummary,
  });

  const firstName = data?.firstName ?? user?.name.split(" ")[0] ?? "";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back
          {firstName ? (
            <>
              , <span className="text-primary">{firstName}</span>
            </>
          ) : null}
        </h1>

        <p className="text-sm text-muted-foreground">{SUBTITLE[user?.role ?? "USER"] ?? SUBTITLE.USER}</p>
      </header>

      {isPending && <DashboardSkeleton />}
      {isError && <DashboardError onRetry={() => refetch()} />}

      {data?.role === "USER" && <TraineeDashboard data={data} />}
      {data?.role === "TRAINER" && <TrainerDashboard data={data} />}
      {data?.role === "SUPER_ADMIN" && <AdminDashboard data={data} />}
    </div>
  );
}
