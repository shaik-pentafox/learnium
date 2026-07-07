import { useState } from "react";
import { createFileRoute, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Drama, Rocket, Mic } from "lucide-react";
import { listMyPersonas, personaKeys, type PersonaSummary } from "@/services/personas";
import { startSession } from "@/services/roleplay";
import { ErrorState } from "@/components/ui/error-state";
import { useAuthStore } from "@/stores/auth";
import { personaOrbColors } from "@/lib/persona-color";
import { notify } from "@/lib/toast";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const LANG_DISPLAY = new Intl.DisplayNames(["en"], { type: "language" });
function langLabel(code: string): string {
  try {
    return LANG_DISPLAY.of(code) ?? code;
  } catch {
    return code;
  }
}

export const Route = createFileRoute("/_auth/personas/")({
  beforeLoad: () => {
    // Persona authoring is trainer + admin (personas:write); trainees bounce.
    if (useAuthStore.getState().user?.role === "USER") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: PersonasListPage,
});

function PersonasListPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: personaKeys.mine(),
    queryFn: listMyPersonas,
  });

  // Owner "Test" = a simulation session against this persona (draft or published).
  // Chat test opens a text session; voice test opens the same session in voice
  // mode (?voice=<lang>) — a dry-run of the persona's configured voice roleplay.
  const [voicePicker, setVoicePicker] = useState<PersonaSummary | null>(null);
  const [launchingId, setLaunchingId] = useState<number | null>(null);

  const start = useMutation({
    mutationFn: (personaId: number) => startSession(personaId, { simulation: true }),
  });

  async function launchChat(personaId: number) {
    setLaunchingId(personaId);
    try {
      const { uid } = await start.mutateAsync(personaId);
      await navigate({ to: "/session/$uid", params: { uid } });
    } catch (err) {
      notify.error(err);
    } finally {
      setLaunchingId(null);
    }
  }

  async function launchVoice(persona: PersonaSummary, langCode: string) {
    setVoicePicker(null);
    setLaunchingId(persona.id);
    try {
      const { uid } = await start.mutateAsync(persona.id);
      await navigate({ to: "/session/$uid", params: { uid }, search: { voice: langCode } });
    } catch (err) {
      notify.error(err);
    } finally {
      setLaunchingId(null);
    }
  }

  function onVoiceClick(persona: PersonaSummary) {
    const langs = persona.languages ?? [];
    if (langs.length === 0) return;
    if (langs.length === 1) void launchVoice(persona, langs[0]!);
    else setVoicePicker(persona);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Personas</h1>
          <p className="text-sm text-muted-foreground">The characters your trainees roleplay against.</p>
        </div>
        <Link to="/personas/new" className={buttonVariants()}>
          <Plus />
          New persona
        </Link>
      </header>

      {isPending && <ListSkeleton />}
      {isError && <ErrorState title="Couldn’t load personas" onRetry={() => refetch()} />}

      {data && data.personas.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-10 text-center">
          <Drama className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No personas yet. Create one to get started.</p>
          <Link to="/personas/new" className={buttonVariants({ className: "mt-4" })}>
            <Plus />
            New persona
          </Link>
        </div>
      )}

      {data && data.personas.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.personas.map((p) => (
            <PersonaCard
              key={p.id}
              persona={p}
              testing={launchingId === p.id}
              onChat={() => launchChat(p.id)}
              onVoice={() => onVoiceClick(p)}
            />
          ))}
        </ul>
      )}

      {/* Language picker for a voice test against a multi-language persona */}
      <Dialog open={voicePicker !== null} onOpenChange={(v) => { if (!v) setVoicePicker(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose language</DialogTitle>
            <DialogDescription>
              Pick the language for this voice test session.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            {(voicePicker?.languages ?? []).map((code) => (
              <Button
                key={code}
                variant="secondary"
                className="h-11 justify-start gap-3"
                onClick={() => voicePicker && launchVoice(voicePicker, code)}
              >
                <Mic className="size-4 shrink-0 text-muted-foreground" />
                <span>{langLabel(code)}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{code}</span>
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVoicePicker(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PersonaCard({
  persona,
  testing,
  onChat,
  onVoice,
}: {
  persona: PersonaSummary;
  testing: boolean;
  onChat: () => void;
  onVoice: () => void;
}) {
  // Voice is testable only when the persona actually enables the voice call
  // (channels includes 'audio') AND has ≥1 language to run it in.
  const voiceEnabled = persona.templateData?.channels?.includes("audio") ?? false;
  const canVoice = voiceEnabled && (persona.languages?.length ?? 0) > 0;
  return (
    <li className="group relative flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:border-primary/40">
      <div className="mb-3 flex items-start gap-3">
        <PersonaBadge color={persona.color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{persona.name}</span>
            <PublishBadge published={persona.isPublished} />
            {persona.readonly && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Shared</span>}
          </div>
          {persona.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{persona.description}</p>}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2">
        {!persona.readonly && (
          <Link to="/personas/$id" params={{ id: String(persona.id) }} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <Pencil className="size-4" />
            Edit
          </Link>
        )}
        <Button size="sm" onClick={onChat} disabled={testing}>
          <Rocket className="size-4" />
          {testing ? "Starting…" : canVoice ? "Test chat" : "Test"}
        </Button>
        {canVoice && (
          <Button size="sm" variant="secondary" onClick={onVoice} disabled={testing}>
            <Mic className="size-4" />
            {testing ? "Starting…" : "Test voice"}
          </Button>
        )}
      </div>
    </li>
  );
}

/** Published vs draft pill — drafts are hidden from trainees. */
function PublishBadge({ published }: { published?: boolean }) {
  return (
    <span
      className={
        published ? "shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary" : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
      }
    >
      {published ? "Published" : "Draft"}
    </span>
  );
}

/** Persona-colored orb badge (CSS gradient — cheap for long lists). */
function PersonaBadge({ color }: { color?: string | null }) {
  const [base, light] = personaOrbColors(color);
  return (
    <div
      className="size-10 shrink-0 rounded-full ring-1 ring-border"
      style={{
        background: `radial-gradient(circle at 32% 28%, ${light}, ${base} 72%)`,
      }}
    />
  );
}

function ListSkeleton() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex flex-col rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-start gap-3">
            {/* Avatar */}
            <div className="size-10 animate-pulse rounded-full bg-muted" />

            <div className="min-w-0 flex-1 space-y-2">
              {/* Name + badge */}
              <div className="flex items-center gap-2">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
              </div>

              {/* Description */}
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            </div>
          </div>

          {/* Actions */}
          <div className="mt-auto flex items-center gap-2">
            <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
            <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
