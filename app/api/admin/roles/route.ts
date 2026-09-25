import { ok } from "@/server/http/response"
import { platformRoute } from "@/server/http/admin"
import { listRolesWithPermissions } from "@/server/services/users"
import { PERMISSIONS } from "@/lib/domain/constants"

export const GET = platformRoute("platform.roles.manage", async () =>
  ok({ roles: await listRolesWithPermissions(), permissions: PERMISSIONS })
)
