import { Suspense } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { AdministratorsTable } from "@/components/admin/administrators-table"
import { FilterTabs, Pagination, SearchBox } from "@/components/admin/list-toolbar"
import { requireArenaPermission } from "@/server/auth/rbac"
import { listStaff } from "@/server/services/users"
import { ARENA_ROLE_KEYS, ROLE_LABELS } from "@/lib/domain/constants"

export const metadata = { title: "Administrators" }

export default async function AdministratorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, arena } = await requireArenaPermission("staff.view")
  const sp = await searchParams
  const result = await listStaff(arena.arenaId, { q: sp.q, roleKey: sp.roleKey, page: Number(sp.page ?? 1), pageSize: 25 })
  return (
    <div className="space-y-6">
      <PageHeader title="Staff" description={`People who can manage ${arena.arenaName}. Role changes and suspensions take effect immediately.`} />
      <Suspense>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <FilterTabs param="roleKey" options={[{ value: "all", label: "All roles" }, ...ARENA_ROLE_KEYS.map((k) => ({ value: k, label: ROLE_LABELS[k] }))]} />
          <SearchBox placeholder="Name or email" className="md:w-72" />
        </div>
      </Suspense>
      <AdministratorsTable
        users={result.items.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, isActive: u.isActive, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(), role: u.role }))}
        me={{ id: user.id, roleKey: arena.roleKey }}
        canManage={arena.permissions.includes("staff.update")}
      />
      <Suspense><Pagination page={result.meta.page} totalPages={result.meta.totalPages} total={result.meta.total} pageSize={result.meta.pageSize} /></Suspense>
    </div>
  )
}
