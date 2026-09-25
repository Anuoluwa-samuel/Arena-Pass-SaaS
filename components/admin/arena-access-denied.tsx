import Link from "next/link"
import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Shown when a signed-in operator reaches an arena they cannot act in, or
 * belongs to several and has not said which. Being refused is a normal
 * outcome of a correct system, not an error: it gets a real screen rather
 * than an exception, and it never lists arenas the viewer has no part in.
 */
export function ArenaAccessDenied({
  reason,
  arenas,
}: {
  reason: "no-access" | "choose" | "none"
  arenas: { arenaId: string; arenaName: string; arenaSlug: string }[]
}) {
  const copy = {
    "no-access": {
      title: "You do not have access to this arena",
      body: "Your account is not a member of the arena at this address. Ask one of its owners for an invitation, or switch to an arena you belong to.",
    },
    choose: {
      title: "Choose an arena",
      body: "You manage more than one arena. Open the one you want to work on.",
    },
    none: {
      title: "No arena yet",
      body: "Your account is not a member of any arena. Ask an arena owner to invite you, or create your own.",
    },
  }[reason]

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-secondary">
        <ShieldAlert className="size-6 text-muted-foreground" />
      </div>
      <h1 className="mt-6 text-2xl font-bold">{copy.title}</h1>
      <p className="mt-2 text-muted-foreground">{copy.body}</p>

      {arenas.length > 0 && (
        <ul className="mt-8 w-full space-y-2">
          {arenas.map((a) => (
            <li key={a.arenaId}>
              <Button asChild variant="outline" className="w-full justify-between">
                <Link href={`/admin?arena=${a.arenaSlug}`}>
                  <span>{a.arenaName}</span>
                  <span className="text-xs text-muted-foreground">{a.arenaSlug}</span>
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button asChild variant="ghost" className="mt-6">
        <Link href="/api/auth/logout">Sign out</Link>
      </Button>
    </main>
  )
}
