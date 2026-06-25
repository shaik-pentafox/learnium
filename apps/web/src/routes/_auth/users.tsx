import { useMemo, useRef, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, Upload, Search } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { queryKeys } from "@/lib/query-keys";
import { notify } from "@/lib/toast";
import { listUsers, deleteUser, userKeys, type UserListItem } from "@/services/users";
import { listRoles, roleKeys, roleLabel } from "@/services/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { UserFormDialog } from "@/components/users/user-form-dialog";
import { ImportUsersDialog } from "@/components/users/import-users-dialog";
import { DataTable } from "@/components/shared/data-table";
import { FacetFilter } from "@/components/shared/facet-filter";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const usersSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().optional(),
  roleId: z.coerce.number().int().optional(),
});
type UsersSearch = z.infer<typeof usersSearchSchema>;

export const Route = createFileRoute("/_auth/users")({
  validateSearch: (search): UsersSearch => usersSearchSchema.parse(search),
  beforeLoad: () => {
    const role = useAuthStore.getState().user?.role;
    if (role !== "SUPER_ADMIN" && role !== "TRAINER") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: UsersPage,
});

function UsersPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const isSuperAdmin = useAuthStore((s) => s.user?.role === "SUPER_ADMIN");

  const params = {
    page: search.page,
    limit: PAGE_SIZE,
    q: search.q,
    roleId: search.roleId,
  };
  const users = useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => listUsers(params),
    placeholderData: keepPreviousData,
  });

  const roles = useQuery({
    queryKey: roleKeys.all(),
    queryFn: listRoles,
    enabled: isSuperAdmin,
    staleTime: Infinity,
  });

  const [editing, setEditing] = useState<{ user: UserListItem | null } | null>(null);
  const [deleting, setDeleting] = useState<UserListItem | null>(null);
  const [importing, setImporting] = useState(false);

  function patchSearch(patch: Partial<typeof search>) {
    navigate({ search: (prev) => ({ ...prev, ...patch }) });
  }

  // Debounced text search → URL.
  const [qInput, setQInput] = useState(search.q ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function onSearchChange(value: string) {
    setQInput(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => patchSearch({ q: value || undefined, page: 1 }), SEARCH_DEBOUNCE_MS);
  }

  const data = users.data;
  const totalPages = data?.totalPages ?? 1;

  const columns = useMemo<ColumnDef<UserListItem>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            <div className="font-medium">
              {row.original.firstName} {row.original.lastName}
            </div>
            <div className="font-data text-xs text-muted-foreground">{row.original.employeeId}</div>
          </div>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        enableSorting: false,
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue() as string}</span>
        ),
      },
      {
        id: "role",
        header: "Role",
        enableSorting: false,
        cell: ({ row }) => <RolePill name={row.original.role.name} />,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setEditing({ user: row.original })}
              aria-label={`Edit ${row.original.firstName} ${row.original.lastName}`}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={() => setDeleting(row.original)}
              aria-label={`Delete ${row.original.firstName} ${row.original.lastName}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{isSuperAdmin ? "Users" : "My Trainees"}</h1>
          <p className="text-sm text-muted-foreground">{isSuperAdmin ? "Manage members, roles, and supervisor assignments." : "Manage the trainees assigned to you."}</p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
              <Upload />
              Import
            </Button>
          )}
          <Button size="sm" onClick={() => setEditing({ user: null })}>
            <Plus />
            {isSuperAdmin ? "Add user" : "Add trainee"}
          </Button>
        </div>
      </header>

      {/* Table */}
      {users.isError ? (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <span className="text-destructive">Couldn’t load users.</span>{" "}
          <button type="button" onClick={() => users.refetch()} className="text-primary hover:underline">
            Retry
          </button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={data?.users ?? []}
          isLoading={users.isPending}
          emptyMessage={search.q || search.roleId ? "No users match your filters." : "No users yet."}
          pageSizeOptions={[PAGE_SIZE]}
          toolbar={
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={qInput}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search name, email, ID…"
                  className="h-8 w-56 pl-7 text-xs"
                />
              </div>
              {isSuperAdmin && (
                <FacetFilter
                  title="Role"
                  single
                  options={(roles.data ?? []).map((r) => ({
                    label: roleLabel(r.name),
                    value: String(r.id),
                  }))}
                  selected={search.roleId != null ? [String(search.roleId)] : []}
                  onChange={(vals) =>
                    patchSearch({
                      roleId: vals[0] ? Number(vals[0]) : undefined,
                      page: 1,
                    })
                  }
                />
              )}
            </>
          }
          manualPagination={{
            pageIndex: search.page - 1,
            pageSize: PAGE_SIZE,
            pageCount: totalPages,
            rowCount: data?.total ?? 0,
            onPaginationChange: (updater) => {
              const next =
                typeof updater === "function"
                  ? updater({ pageIndex: search.page - 1, pageSize: PAGE_SIZE })
                  : updater;
              patchSearch({ page: next.pageIndex + 1 });
            },
          }}
        />
      )}

      <UserFormDialog
        open={editing != null}
        user={editing?.user ?? null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <DeleteUserDialog
        user={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
      {isSuperAdmin && <ImportUsersDialog open={importing} onOpenChange={setImporting} />}
    </div>
  );
}

function RolePill({ name }: { name: string }) {
  const style = name === "SUPER_ADMIN" ? "bg-primary/10 text-primary" : name === "TRAINER" ? "bg-info/15 text-info" : "bg-muted text-muted-foreground";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${style}`}>{roleLabel(name)}</span>;
}

function DeleteUserDialog({ user, onOpenChange }: { user: UserListItem | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
      notify.success("User removed");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={user != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove user</DialogTitle>
          <DialogDescription>{user ? `Remove ${user.firstName} ${user.lastName}? They’ll lose access immediately. This can be undone by an admin.` : ""}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => user && mutation.mutate(user.id)} disabled={mutation.isPending}>
            {mutation.isPending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

