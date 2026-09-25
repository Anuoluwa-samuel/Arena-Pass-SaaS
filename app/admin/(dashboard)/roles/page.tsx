import { PageHeader } from "@/components/shared/page-header"
import { RolesMatrix } from "@/components/admin/roles-matrix"
import { requirePlatformPermission } from "@/server/auth/rbac"
import { listRolesWithPermissions } from "@/server/services/users"
import { PERMISSIONS } from "@/lib/domain/constants"

export const metadata = { title: "Roles & permissions" }

export default async function RolesPage() {
  const { platform } = await requirePlatformPermission("platform.roles.manage")
  const roles = await listRolesWithPermissions()
  return (
    <div className="space-y-6">
      <PageHeader title="Roles & permissions" description="What each role is allowed to do, across every arena. Enforced by the API on every request, not just in the interface." />
      <RolesMatrix roles={roles.map((r) => ({ key: r.key, name: r.name, permissions: r.permissions, userCount: r.userCount }))} permissions={[...PERMISSIONS]} canManage={platform.permissions.includes("platform.roles.manage")} />
    </div>
  )
}
