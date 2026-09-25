import { z } from "zod"
import { ok } from "@/server/http/response"
import { parseJson } from "@/server/http/request"
import { adminRoute, actorFrom } from "@/server/http/admin"
import { listPaymentAccounts, savePaymentAccount } from "@/server/payments/accounts"

/**
 * An arena's own payment credentials. Secrets are write-only: the response
 * says whether one is stored, never what it is.
 */
export const GET = adminRoute("settings.view", async (_req, _ctx, _user, arena) => ok(await listPaymentAccounts(arena.arenaId)))

const accountSchema = z.object({
  provider: z.enum(["paystack", "mock"]),
  secretKey: z.string().trim().min(8).max(200).optional(),
  publicKey: z.string().trim().max(200).nullable().optional(),
  webhookSecret: z.string().trim().max(200).nullable().optional(),
  providerAccountId: z.string().trim().max(120).nullable().optional(),
  status: z.enum(["PENDING", "ACTIVE", "DISABLED"]).optional(),
})

export const PUT = adminRoute("settings.manage", async (req, _ctx, user, arena) => {
  const input = await parseJson(req, accountSchema)
  const saved = await savePaymentAccount(arena.arenaId, input, { actor: actorFrom(user, req) })
  return ok(saved, { message: "Payment account saved" })
})
