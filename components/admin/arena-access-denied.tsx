import Link from "next/link"
import { ShieldAlert, LayoutGrid } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ArenaChooser, type ChoosableArena } from "@/components/admin/arena-chooser"
import { SignOutButton } from "@/components/admin/sign-out-button"

/**
 * Shown when a signed-in operator reaches an arena they cannot act in, or
 * belongs to several and has not said which. Being refused is a normal
 * outcome of a correct system, not an error: it gets a real screen rather
 * than an exception, and it never lists arenas the viewer has no part in.
 */
export function ArenaAccessDenied({
  reason,
  arenas,
  isPlatformStaff = false,
}: {
  reason: "no-access" | "choose" | "none"
  arenas: ChoosableArena[]
  /** Offers the platform dashboard, which is the right destination for them. */
  isPlatformStaff?: boolean
}) {
  const copy = {
    "no-access": {
      title: "You do not have access to this arena",
      body: "Your account is not a member of the arena at this address. Ask one of its owners for an invitation, or switch to an arena you belong to.",
    },
    choose: {
      title: "Choose an arena",
      body: "You manage more than one arena. Open the one you want to work on — you can switch at any time from the header.",
    },
    none: {
      title: "No arena yet",
      body: isPlatformStaff
        ? "Your account runs the platform rather than an arena. The platform dashboard is where your work lives."
        : "Your account is not a member of any arena. Ask an arena owner to invite you, or create your own.",
    },
  }[reason]

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-secondary">
        <ShieldAlert className="size-6 text-muted-foreground" />
      </div>
      <h1 className="mt-6 text-2xl font-bold">{copy.title}</h1>
      <p className="mt-2 text-muted-foreground">{copy.body}</p>

      {arenas.length > 0 && <ArenaChooser arenas={arenas} />}

      {isPlatformStaff && (
        <Button asChild variant={arenas.length > 0 ? "outline" : "default"} className="mt-4 w-full">
          <Link href="/platform">
            <LayoutGrid className="mr-2 size-4" />
            Platform dashboard
          </Link>
        </Button>
      )}

      <SignOutButton className="mt-6" />
    </main>
  )
}
