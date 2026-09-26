import { Badge } from "@/components/ui/badge"
import type { SubscriptionStatus } from "@/lib/domain/constants"

/**
 * A subscription's standing. Deliberately its own component rather than the
 * shared status badge: subscription statuses and payment statuses read alike
 * and mean entirely different things, and one badge that took either would be
 * the place they first got confused.
 */
const TONE: Record<SubscriptionStatus, { label: string; className: string }> = {
  TRIALING: { label: "Trial", className: "bg-info/15 text-info-text border-transparent" },
  ACTIVE: { label: "Active", className: "bg-success/15 text-success-text border-transparent" },
  PAST_DUE: { label: "Past due", className: "bg-warning/15 text-warning-text border-transparent" },
  CANCELLED: { label: "Cancelled", className: "bg-muted text-muted-foreground border-transparent" },
  EXPIRED: { label: "Expired", className: "bg-destructive/15 text-danger-text border-transparent" },
}

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  const tone = TONE[status]
  return <Badge className={tone.className}>{tone.label}</Badge>
}
