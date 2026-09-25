import Link from "next/link"
import { Check, ExternalLink } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shared/page-header"
import { LaunchArenaButton } from "@/components/admin/launch-arena-button"
import { requireArenaPermission } from "@/server/auth/rbac"
import { recordOnboardingProgress } from "@/server/services/onboarding"

export const metadata = { title: "Set up your arena" }

/**
 * The resumable setup checklist.
 *
 * Progress is derived from what exists, not from a stored cursor, so an owner
 * who created a session from the sessions screen sees that step already
 * ticked. Nothing here blocks the rest of the dashboard — an arena can be
 * explored before it is finished.
 */
export default async function OnboardingPage() {
  const { arena } = await requireArenaPermission("settings.view")
  const state = await recordOnboardingProgress(arena.arenaId)

  return (
    <div className="space-y-6">
      <PageHeader
        title={state.launched ? `${arena.arenaName} is live` : `Set up ${arena.arenaName}`}
        description={
          state.launched
            ? "Your storefront is open to the public. Everything below can still be changed."
            : "Finish these and open your doors. You can leave and come back — nothing is lost."
        }
      />

      {!state.launched && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Setup progress</span>
            <span className="font-semibold">{state.percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={state.percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${state.percent}%` }} />
          </div>
        </div>
      )}

      <ol className="space-y-3">
        {state.tasks.map((task) => (
          <li key={task.step}>
            <Card variant="glass">
              <CardContent className="flex items-start gap-4 p-5">
                <span
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                    task.done ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
                  }`}
                  aria-hidden
                >
                  {task.done ? <Check className="size-3.5" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{task.title}</h2>
                    {!task.required && <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">Optional</span>}
                    <span className="sr-only">{task.done ? "Done" : "Not done yet"}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                </div>
                <Button asChild variant={task.done ? "ghost" : "outline"} size="sm">
                  <Link href={task.href}>{task.done ? "Review" : "Set up"}</Link>
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <Card variant="glass">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-semibold">{state.launched ? "Your storefront" : "Open your arena"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.launched
                ? "Customers can browse sessions and book."
                : "Until you launch, only your team can see this arena. Customers get a “not found” page."}
            </p>
          </div>
          {state.launched ? (
            <Button asChild variant="outline">
              <Link href="/" target="_blank">
                Visit storefront <ExternalLink className="ml-1.5 size-3.5" />
              </Link>
            </Button>
          ) : (
            <LaunchArenaButton canLaunch={state.canLaunch} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
