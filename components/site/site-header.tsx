import { Navbar } from "@/components/navbar"
import { getCurrentCustomer } from "@/server/auth/session"

/** Server wrapper: resolves the customer session once, hands it to the client navbar. */
export async function SiteHeader({ siteName, logoUrl = null }: { siteName: string; logoUrl?: string | null }) {
  const customer = await getCurrentCustomer()
  return <Navbar customer={customer ? { name: customer.name } : null} siteName={siteName} logoUrl={logoUrl} />
}
