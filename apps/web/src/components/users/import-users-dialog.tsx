import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UploadCloud, CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/toast'
import { queryKeys } from '@/lib/query-keys'
import {
  importUsers,
  getImportReport,
  userKeys,
  type ImportReport,
} from '@/services/users'

const POLL_MS = 1500

interface ImportUsersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportUsersDialog({ open, onOpenChange }: ImportUsersDialogProps) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)

  // Reset everything on each open.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setFile(null)
    setReportId(null)
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  const start = useMutation({
    mutationFn: () => importUsers(file as File),
    onSuccess: (res) => setReportId(res.reportId),
  })

  const report = useQuery({
    queryKey: userKeys.importReport(reportId ?? ''),
    queryFn: () => getImportReport(reportId as string),
    enabled: reportId != null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'DONE' || status === 'FAILED' ? false : POLL_MS
    },
  })

  const done =
    report.data?.status === 'DONE' || report.data?.status === 'FAILED'

  function close() {
    // Refresh the table so freshly imported users show up.
    queryClient.invalidateQueries({ queryKey: queryKeys.users })
    onOpenChange(false)
  }

  function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      notify.message('Choose a file first')
      return
    }
    start.mutate()
  }

  const busy = start.isPending || (reportId != null && !done)

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk import users</DialogTitle>
          <DialogDescription>
            Upload a CSV or XLSX of users. Rows are processed in the background.
          </DialogDescription>
        </DialogHeader>

        {reportId == null ? (
          <form onSubmit={handleUpload} className="flex flex-col gap-4">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm transition-colors hover:bg-muted">
              <UploadCloud className="size-6 text-muted-foreground" />
              <span className="font-medium">
                {file ? file.name : 'Click to choose a file'}
              </span>
              <span className="text-xs text-muted-foreground">CSV or XLSX</span>
              <input
                type="file"
                accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={!file || start.isPending}>
                {start.isPending ? 'Uploading…' : 'Start import'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <ImportProgress report={report.data} done={done} />
            <DialogFooter>
              <Button type="button" onClick={close} disabled={busy}>
                {done ? 'Done' : 'Processing…'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ImportProgress({
  report,
  done,
}: {
  report?: ImportReport
  done: boolean
}) {
  if (!report) {
    return <p className="text-sm text-muted-foreground">Starting…</p>
  }
  const failed = report.status === 'FAILED'
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        {done ? (
          failed ? (
            <AlertTriangle className="size-5 text-destructive" />
          ) : (
            <CheckCircle2 className="size-5 text-success" />
          )
        ) : (
          <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
        )}
        <span className="font-medium">
          {failed
            ? 'Import failed'
            : done
              ? 'Import complete'
              : 'Processing rows…'}
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        <Stat label="Total" value={report.totalRows} />
        <Stat label="Imported" value={report.successRows} tone="success" />
        <Stat label="Errors" value={report.errorRows} tone="error" />
      </dl>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'success' | 'error'
}) {
  const color =
    tone === 'success'
      ? 'text-success'
      : tone === 'error' && value > 0
        ? 'text-destructive'
        : 'text-foreground'
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-data text-lg font-semibold tabular-nums ${color}`}>
        {value}
      </div>
    </div>
  )
}
