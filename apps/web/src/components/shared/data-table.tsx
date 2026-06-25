import { useState } from 'react'
import {
  type ColumnDef,
  type SortingState,
  type PaginationState,
  type OnChangeFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Search,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  isLoading?: boolean
  /** Show a global text search box (client-side filter). */
  searchable?: boolean
  searchPlaceholder?: string
  emptyMessage?: string
  pageSizeOptions?: number[]
  /** Server-driven pagination: controls supplied by the caller. When set, the
   *  table renders the given page verbatim and reports page changes upward. */
  manualPagination?: {
    pageIndex: number
    pageSize: number
    pageCount: number
    rowCount: number
    onPaginationChange: OnChangeFn<PaginationState>
  }
  /** Extra controls on the toolbar's left (after the search box). */
  toolbar?: React.ReactNode
  /** Controls pinned to the toolbar's right side (e.g. a date filter). */
  toolbarRight?: React.ReactNode
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  searchable = false,
  searchPlaceholder = 'Search…',
  emptyMessage = 'No results.',
  pageSizeOptions = [10, 20, 50, 100],
  manualPagination,
  toolbar,
  toolbarRight,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSizeOptions[0] ?? 10,
  })

  const isManual = manualPagination != null
  const paginationState: PaginationState = isManual
    ? { pageIndex: manualPagination.pageIndex, pageSize: manualPagination.pageSize }
    : pagination

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      pagination: paginationState,
      ...(searchable && !isManual ? { globalFilter } : {}),
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: isManual
      ? manualPagination.onPaginationChange
      : setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(isManual
      ? { manualPagination: true, pageCount: manualPagination.pageCount }
      : { getPaginationRowModel: getPaginationRowModel() }),
  })

  const colCount = table.getAllLeafColumns().length
  const rowCount = isManual
    ? manualPagination.rowCount
    : table.getFilteredRowModel().rows.length

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Toolbar — search + filters left, pinned controls right */}
      {(searchable || toolbar || toolbarRight) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {searchable && !isManual && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-8 w-52 pl-7 text-xs"
                />
                {globalFilter && (
                  <button
                    type="button"
                    onClick={() => setGlobalFilter('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
            {toolbar}
          </div>
          {toolbarRight && (
            <div className="flex items-center gap-2">{toolbarRight}</div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-ml-1.5 flex items-center gap-1.5 rounded px-1.5 py-1 hover:text-foreground [&_svg]:size-3.5 [&_svg]:text-muted-foreground/70"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sorted === 'desc' ? (
                            <ChevronDown />
                          ) : sorted === 'asc' ? (
                            <ChevronUp />
                          ) : (
                            <ChevronsUpDown />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: paginationState.pageSize }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: colCount }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="h-24 text-center">
                  <span className="text-sm text-muted-foreground">
                    {emptyMessage}
                  </span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <Pagination
        pageIndex={paginationState.pageIndex}
        pageSize={paginationState.pageSize}
        pageCount={table.getPageCount() || 1}
        rowCount={rowCount}
        canPrev={table.getCanPreviousPage()}
        canNext={table.getCanNextPage()}
        pageSizeOptions={pageSizeOptions}
        onFirst={() => table.setPageIndex(0)}
        onPrev={() => table.previousPage()}
        onNext={() => table.nextPage()}
        onLast={() => table.setPageIndex(table.getPageCount() - 1)}
        onPageSize={(s) => {
          table.setPageSize(s)
          table.setPageIndex(0)
        }}
      />
    </div>
  )
}

interface PaginationProps {
  pageIndex: number
  pageSize: number
  pageCount: number
  rowCount: number
  canPrev: boolean
  canNext: boolean
  pageSizeOptions: number[]
  onFirst: () => void
  onPrev: () => void
  onNext: () => void
  onLast: () => void
  onPageSize: (size: number) => void
}

function Pagination({
  pageIndex,
  pageSize,
  pageCount,
  rowCount,
  canPrev,
  canNext,
  pageSizeOptions,
  onFirst,
  onPrev,
  onNext,
  onLast,
  onPageSize,
}: PaginationProps) {
  const from = rowCount === 0 ? 0 : pageIndex * pageSize + 1
  const to = Math.min((pageIndex + 1) * pageSize, rowCount)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs tabular-nums text-muted-foreground">
        {rowCount === 0
          ? 'No rows'
          : `${from}–${to} of ${rowCount} row${rowCount !== 1 ? 's' : ''}`}
      </p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Rows</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-16 text-xs" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((s) => (
                <SelectItem key={s} value={String(s)} className="text-xs">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <IconBtn onClick={onFirst} disabled={!canPrev} label="First page">
            <ChevronsLeft className="size-4" />
          </IconBtn>
          <IconBtn onClick={onPrev} disabled={!canPrev} label="Previous page">
            <ChevronLeft className="size-4" />
          </IconBtn>
          <span className="px-1 text-xs tabular-nums text-muted-foreground">
            {pageIndex + 1} / {pageCount}
          </span>
          <IconBtn onClick={onNext} disabled={!canNext} label="Next page">
            <ChevronRight className="size-4" />
          </IconBtn>
          <IconBtn onClick={onLast} disabled={!canNext} label="Last page">
            <ChevronsRight className="size-4" />
          </IconBtn>
        </div>
      </div>
    </div>
  )
}

function IconBtn({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <Button
      variant="secondary"
      size="icon"
      className={cn('size-8')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {children}
    </Button>
  )
}
