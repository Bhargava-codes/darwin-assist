/** Shown while the app loads the employee's HR data from Lovable Cloud. */
export function LoadingPanel({ label = "Loading your HR data…" }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-3 px-4 pb-6 pt-6" aria-busy="true">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-2xl border border-border bg-muted/40"
        />
      ))}
    </div>
  );
}
