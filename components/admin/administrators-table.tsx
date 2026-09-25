"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus, Trash2, UserX } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { ToneBadge } from "@/components/shared/status-badge"
import { DataTable } from "@/components/admin/data-table"
import { ConfirmDialog } from "@/components/admin/confirm-dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { api, ApiError, errorMessage, fieldErrors } from "@/lib/api-client"
import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from "@/lib/domain/constants"
import { formatDateTime, formatRelative } from "@/lib/format"

interface Row { id: string; name: string; email: string; phone: string | null; isActive: boolean; lastLoginAt: string | null; createdAt: string; role: { key: RoleKey; name: string } }
interface Form { name: string; email: string; phone: string; roleKey: RoleKey; password: string; isActive: boolean }

export function AdministratorsTable({ users, me, canManage }: { users: Row[]; me: { id: string; roleKey: RoleKey }; canManage: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Row | null | undefined>(undefined)
  const [form, setForm] = useState<Form>(blank())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const roleOptions = ROLE_KEYS.filter((k) => k !== "PLATFORM_OWNER" || me.roleKey === "PLATFORM_OWNER")

  function blank(): Form {
    return { name: "", email: "", phone: "", roleKey: "STAFF", password: "", isActive: true }
  }
  const open = (row: Row | null) => {
    setEditing(row)
    setErrors({})
    setForm(row ? { name: row.name, email: row.email, phone: row.phone ?? "", roleKey: row.role.key, password: "", isActive: row.isActive } : blank())
  }
  const save = async () => {
    setBusy(true)
    setErrors({})
    try {
      const payload = { ...form, password: form.password || undefined }
      if (editing) await api.patch(`/api/admin/users/${editing.id}`, payload)
      else await api.post("/api/admin/users", payload)
      toast.success(editing ? "Administrator updated" : "Administrator created")
      setEditing(undefined)
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError && err.code === "VALIDATION_ERROR") setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!deleting) return
    try {
      await api.delete(`/api/admin/users/${deleting.id}`)
      toast.success("Administrator removed")
      router.refresh()
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    }
  }

  return (
    <div className="space-y-4">
      {canManage && <div className="flex justify-end"><Button onClick={() => open(null)}><Plus className="mr-2 size-4" />Add administrator</Button></div>}
      <DataTable
        rows={users}
        rowKey={(u) => u.id}
        mobileTitle={(u) => u.name}
        empty={<EmptyState icon={UserX} title="No administrators match" />}
        columns={[
          { key: "name", header: "Name", hideOnMobile: true, cell: (u) => <div><p className="font-medium">{u.name}{u.id === me.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</p><p className="text-xs text-muted-foreground">{u.email}</p></div> },
          { key: "role", header: "Role", cell: (u) => <ToneBadge tone={u.role.key === "PLATFORM_OWNER" ? "warning" : "info"}>{u.role.name}</ToneBadge> },
          { key: "status", header: "Status", cell: (u) => (u.isActive ? <ToneBadge tone="success">Active</ToneBadge> : <ToneBadge tone="danger">Disabled</ToneBadge>) },
          { key: "login", header: "Last sign-in", cell: (u) => (u.lastLoginAt ? formatRelative(u.lastLoginAt) : "Never") },
          { key: "created", header: "Added", hideOnMobile: true, cell: (u) => formatDateTime(u.createdAt) },
          { key: "actions", header: "", className: "text-right", cell: (u) => canManage ? (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => open(u)} aria-label="Edit"><Pencil className="size-4" /></Button>
              {u.id !== me.id && <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={() => setDeleting(u)} aria-label="Remove"><Trash2 className="size-4" /></Button>}
            </div>
          ) : null },
        ]}
      />

      <Dialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit administrator" : "New administrator"}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); void save() }} className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="u-name">Full name</Label><Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />{errors.name && <p className="text-xs text-destructive">{errors.name}</p>}</div>
            <div className="space-y-1.5"><Label htmlFor="u-email">Email</Label><Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />{errors.email && <p className="text-xs text-destructive">{errors.email}</p>}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="u-phone">Phone</Label><Input id="u-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.roleKey} onValueChange={(v) => setForm({ ...form, roleKey: v as RoleKey })} disabled={editing?.id === me.id}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{roleOptions.map((k) => <SelectItem key={k} value={k}>{ROLE_LABELS[k]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="u-pass">{editing ? "New password (leave blank to keep)" : "Temporary password"}</Label><Input id="u-pass" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={10} required={!editing} autoComplete="new-password" />{errors.password && <p className="text-xs text-destructive">{errors.password}</p>}<p className="text-xs text-muted-foreground">At least 10 characters. Changing it signs the user out everywhere.</p></div>
            {editing && editing.id !== me.id && (
              <div className="flex items-center justify-between rounded-lg border border-border p-3"><span className="text-sm font-medium">Account active</span><Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} /></div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? <Spinner className="size-4" /> : editing ? "Save" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Remove ${deleting?.name}?`} description="Their account is disabled and every active session is signed out. Audit history is kept." confirmLabel="Remove" destructive onConfirm={remove} />
    </div>
  )
}
