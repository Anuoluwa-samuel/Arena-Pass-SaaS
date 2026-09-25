import Link from "next/link"
import { CheckCircle2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shared/page-header"
import { confirmEmail } from "@/server/auth/email-verification"
import { AppError } from "@/server/http/errors"

export const dynamic = "force-dynamic"
export const metadata = { title: "Confirm your email" }

/**
 * Opened from the emailed link. The token is consumed here rather than by a
 * client fetch, so the address is confirmed even if the reader never gets as
 * far as a JavaScript bundle.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams

  let error: string | null = null
  let email: string | null = null
  if (!token) {
    error = "This link is missing its confirmation code."
  } else {
    try {
      const customer = await confirmEmail(token)
      email = customer.email
    } catch (err) {
      if (err instanceof AppError) error = err.message
      else throw err
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center sm:py-28">
      <div className="flex size-16 items-center justify-center rounded-full bg-secondary">
        {error ? <XCircle className="size-7 text-muted-foreground" /> : <CheckCircle2 className="size-7 text-primary" />}
      </div>
      <div className="mt-6">
        <PageHeader
          title={error ? "We couldn't confirm that link" : "Email confirmed"}
          description={error ?? `${email} is confirmed. Your tickets and session reminders will come to this address.`}
        />
      </div>
      <Button asChild className="mt-8">
        <Link href={error ? "/account/profile" : "/account"}>{error ? "Go to my profile" : "Go to my account"}</Link>
      </Button>
    </main>
  )
}
