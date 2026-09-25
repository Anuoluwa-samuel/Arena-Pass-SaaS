"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api-client"

/** Mirrors the server's slug rule so the address preview cannot mislead. */
function toSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

export function RegisterArenaForm({ rootDomain, signedInAs }: { rootDomain: string; signedInAs: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    name: "",
    email: signedInAs ?? "",
    password: "",
    organizationName: "",
    arenaName: "",
    slug: "",
    city: "",
  })
  // Typed by hand once, then left alone: an owner who edits the address owns it.
  const [slugTouched, setSlugTouched] = useState(false)
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  const onArenaName = (value: string) => {
    setForm((f) => ({ ...f, arenaName: value, slug: slugTouched ? f.slug : toSlug(value), organizationName: f.organizationName || value }))
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const res = await api
      .post<{ nextUrl: string }>("/api/arenas/register", { ...form, slug: toSlug(form.slug) })
      .catch((err: Error) => err)
    setBusy(false)
    if (res instanceof Error) {
      toast.error(res.message)
      return
    }
    router.push(res.data.nextUrl)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset className="space-y-4" disabled={busy}>
        <legend className="sr-only">Your arena</legend>
        <div className="space-y-1.5">
          <Label htmlFor="arenaName">Arena name</Label>
          <Input id="arenaName" required value={form.arenaName} onChange={(e) => onArenaName(e.target.value)} placeholder="Lekki Football Arena" autoComplete="organization" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="slug">Web address</Label>
          <div className="flex items-center gap-1.5">
            <Input
              id="slug"
              required
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true)
                set("slug")(e.target.value)
              }}
              placeholder="lekki"
              className="max-w-[12rem]"
              aria-describedby="slug-hint"
            />
            <span id="slug-hint" className="truncate text-sm text-muted-foreground">
              .{rootDomain}
            </span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">City <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="city" value={form.city} onChange={(e) => set("city")(e.target.value)} placeholder="Lagos" autoComplete="address-level2" />
        </div>
      </fieldset>

      <fieldset className="space-y-4" disabled={busy}>
        <legend className="sr-only">Your account</legend>
        <div className="space-y-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" required value={form.name} onChange={(e) => set("name")(e.target.value)} autoComplete="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={form.email} onChange={(e) => set("email")(e.target.value)} autoComplete="email" />
        </div>
        {!signedInAs && (
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={10} value={form.password} onChange={(e) => set("password")(e.target.value)} autoComplete="new-password" />
            <p className="text-xs text-muted-foreground">At least 10 characters.</p>
          </div>
        )}
      </fieldset>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Spinner className="size-4" /> : "Create my arena"}
      </Button>
    </form>
  )
}
