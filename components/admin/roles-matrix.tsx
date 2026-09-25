"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { api, errorMessage } from "@/lib/api-client"
import type { Permission, RoleKey } from "@/lib/domain/constants"

interface Role { key: RoleKey; name: string; permissions: Permission[]; userCount: number }

export function RolesMatrix({ roles, permissions, canManage }: { roles: Role[]; permissions: Permission[]; canManage: boolean }) {
  const router = useRouter()
  const [state, setState] = useState<Record<RoleKey, Set<Permission>>>(() => Object.fromEntries(roles.map((r) => [r.key, new Set(r.permissions)])) as Record<RoleKey, Set<Permission>>)
  const [dirty, setDirty] = useState<Set<RoleKey>>(new Set())
  const [saving, setSaving] = useState<RoleKey | null>(null)
  const groups = Array.from(new Set(permissions.map((p) => p.split(".")[0])))

  const toggle = (role: RoleKey, perm: Permission) => {
    setState((s) => {
      const next = new Set(s[role])
      if (next.has(perm)) next.delete(perm)
      else next.add(perm)
      return { ...s, [role]: next }
    })
    setDirty((d) => new Set(d).add(role))
  }

  const save = async (role: RoleKey) => {
    setSaving(role)
    try {
      await api.put(`/api/admin/roles/${role}/permissions`, { permissions: Array.from(state[role]) })
      toast.success(`${roles.find((r) => r.key === role)?.name} permissions saved`)
      setDirty((d) => { const n = new Set(d); n.delete(role); return n })
      router.refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 bg-card p-3 text-left font-medium">Permission</th>
            {roles.map((r) => (
              <th key={r.key} className="p-3 text-center align-bottom font-medium">
                <div>{r.name}</div>
                <div className="text-xs font-normal text-muted-foreground">{r.userCount} user{r.userCount === 1 ? "" : "s"}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g} group={g} perms={permissions.filter((p) => p.startsWith(g + "."))} roles={roles} state={state} canManage={canManage} toggle={toggle} />
          ))}
        </tbody>
        {canManage && (
          <tfoot>
            <tr className="border-t border-border">
              <td className="sticky left-0 bg-card p-3 text-xs text-muted-foreground">Super admin always has every permission.</td>
              {roles.map((r) => (
                <td key={r.key} className="p-3 text-center">
                  {r.key !== "PLATFORM_OWNER" && <Button size="sm" variant={dirty.has(r.key) ? "default" : "outline"} disabled={!dirty.has(r.key) || saving !== null} onClick={() => save(r.key)}>{saving === r.key ? <Spinner className="size-3.5" /> : "Save"}</Button>}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function GroupRows({ group, perms, roles, state, canManage, toggle }: { group: string; perms: Permission[]; roles: Role[]; state: Record<RoleKey, Set<Permission>>; canManage: boolean; toggle: (r: RoleKey, p: Permission) => void }) {
  return (
    <>
      <tr className="bg-secondary/40"><td colSpan={roles.length + 1} className="sticky left-0 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</td></tr>
      {perms.map((p) => (
        <tr key={p} className="border-b border-border/60 last:border-0">
          <td className="sticky left-0 bg-card p-3"><code className="text-xs">{p}</code></td>
          {roles.map((r) => (
            <td key={r.key} className="p-3 text-center">
              <Checkbox checked={state[r.key].has(p)} onCheckedChange={() => toggle(r.key, p)} disabled={!canManage || r.key === "PLATFORM_OWNER"} aria-label={`${r.name}: ${p}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
