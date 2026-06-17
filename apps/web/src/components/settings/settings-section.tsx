interface SettingsSectionProps {
  id: string
  title: string
  description: string
  /** Optional header-right slot (e.g. an action button). */
  action?: React.ReactNode
  children: React.ReactNode
}

/** Card with a header bar — the repeating shell for each settings group. */
export function SettingsSection({
  id,
  title,
  description,
  action,
  children,
}: SettingsSectionProps) {
  return (
    <section
      id={id}
      className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="flex flex-col gap-3 border-b border-border bg-muted/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
