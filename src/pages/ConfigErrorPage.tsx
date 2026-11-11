/**
 * Shown instead of the app when the build is missing required environment
 * variables. Names the variables, never their values.
 */
export function ConfigErrorPage({ problems }: { problems: string[] }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <div role="alert" className="w-full max-w-lg space-y-3 rounded-xl border bg-background p-6 shadow-sm">
        <h1 className="text-lg font-semibold">The application is not configured</h1>
        <p className="text-sm text-muted-foreground">
          The build is missing required settings. Copy <code>.env.example</code> to <code>.env.local</code>, fill
          it in and rebuild.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
