"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, ExternalLink, KeyRound, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { api, errorMessage } from "@/lib/api-client"

export interface PaymentAccountView {
  id: string
  provider: string
  status: "PENDING" | "ACTIVE" | "DISABLED"
  publicKey: string | null
  secretKeySet: boolean
  webhookSecretSet: boolean
}

/**
 * Where an arena connects its own provider account, so bookings are paid
 * directly to it.
 *
 * Secrets are write-only. The server never sends a stored key back — the form
 * shows only whether one is set — and an empty secret field on save means
 * "leave the stored one alone", so an operator can correct a public key
 * without re-typing the secret they no longer have to hand.
 */
export function PaymentAccountForm({
  account,
  provider,
  canManage,
}: {
  account: PaymentAccountView | null
  provider: string
  canManage: boolean
}) {
  const router = useRouter()
  const [secretKey, setSecretKey] = useState("")
  const [publicKey, setPublicKey] = useState(account?.publicKey ?? "")
  const [webhookSecret, setWebhookSecret] = useState("")
  const [busy, setBusy] = useState(false)

  const connected = Boolean(account?.secretKeySet && account.status === "ACTIVE")
  const isMock = provider === "mock"

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.put("/api/admin/payments/accounts", {
        provider,
        // Omitted rather than sent empty: an empty string would clear a stored
        // secret, and clearing is not what leaving a field blank means here.
        ...(secretKey ? { secretKey } : {}),
        ...(webhookSecret ? { webhookSecret } : {}),
        publicKey: publicKey || null,
        status: secretKey || account?.secretKeySet ? "ACTIVE" : "PENDING",
      })
      setSecretKey("")
      setWebhookSecret("")
      toast.success("Payment details saved")
      router.refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">Getting paid</CardTitle>
          <CardDescription>
            Your own {isMock ? "provider" : "Paystack"} account. Money from bookings goes straight to you — Game
            Slots never holds it.
          </CardDescription>
        </div>
        {connected ? (
          <Badge className="border-transparent bg-success/15 text-success-text">
            <CheckCircle2 className="mr-1 size-3.5" />
            Connected
          </Badge>
        ) : (
          <Badge className="border-transparent bg-warning/15 text-warning-text">Not connected</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-5">
        {!connected && (
          <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
            <p className="text-muted-foreground">
              Until this is connected your customers cannot pay, so sessions cannot be booked.
            </p>
          </div>
        )}

        {isMock ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            This deployment runs the mock provider, which takes no real money. Keys are not needed.
          </p>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <fieldset disabled={!canManage} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="secretKey">Secret key</Label>
                <Input
                  id="secretKey"
                  type="password"
                  autoComplete="off"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={account?.secretKeySet ? "Stored — leave blank to keep it" : "sk_live_…"}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Encrypted before it is stored, and never shown again.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="publicKey">Public key</Label>
                <Input
                  id="publicKey"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder="pk_live_…"
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="webhookSecret">Webhook secret</Label>
                <Input
                  id="webhookSecret"
                  type="password"
                  autoComplete="off"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={account?.webhookSecretSet ? "Stored — leave blank to keep it" : "Optional"}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Optional. Without it, your secret key is used to verify webhooks.
                </p>
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!canManage || busy}>
                {busy && <Spinner className="mr-2 size-4" />}
                <KeyRound className="mr-2 size-4" />
                Save payment details
              </Button>
              <a
                href="https://dashboard.paystack.com/#/settings/developers"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Where to find these
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
