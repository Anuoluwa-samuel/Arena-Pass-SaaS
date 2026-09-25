import type { ErrorCode } from "@/lib/domain/constants"

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_DISABLED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ARENA_NOT_FOUND: 404,
  ARENA_UNAVAILABLE: 503,
  ARENA_SELECTION_REQUIRED: 409,
  SESSION_NOT_FOUND: 404,
  BOOKING_NOT_FOUND: 404,
  TICKET_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  SESSION_FULL: 409,
  DUPLICATE_BOOKING: 409,
  TICKET_ALREADY_USED: 409,
  BOOKING_ALREADY_CONFIRMED: 409,
  EMAIL_TAKEN: 409,
  INVALID_RESET_TOKEN: 400,
  OAUTH_FAILED: 400,
  RATE_LIMITED: 429,
  PAYMENT_PROVIDER_ERROR: 502,
  INTERNAL_ERROR: 500,
}

/**
 * The one error type services throw. Route handlers translate it into the
 * uniform `{ success:false, code, message }` envelope; anything else is a
 * 500 with details hidden from the client.
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, options?: { status?: number; details?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause })
    this.name = "AppError"
    this.code = code
    this.status = options?.status ?? STATUS_BY_CODE[code] ?? 400
    this.details = options?.details
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`)
export const forbidden = (message = "You do not have permission to perform this action") =>
  new AppError("FORBIDDEN", message)
export const unauthorized = (message = "Authentication required") => new AppError("UNAUTHORIZED", message)

type PgLikeError = { code?: string; constraint_name?: string; constraint?: string; message?: string; cause?: unknown }

function pgError(err: unknown): PgLikeError | undefined {
  const e = err as PgLikeError
  if (!e) return undefined
  if (e.code && /^\d{5}$/.test(e.code)) return e
  if (e.cause) return pgError(e.cause)
  return undefined
}

export function isUniqueViolation(err: unknown, constraint?: string) {
  const e = pgError(err)
  if (!e || e.code !== "23505") return false
  if (!constraint) return true
  return (e.constraint_name ?? e.constraint ?? e.message ?? "").includes(constraint)
}

export function isCheckViolation(err: unknown, constraint?: string) {
  const e = pgError(err)
  if (!e || e.code !== "23514") return false
  if (!constraint) return true
  return (e.constraint_name ?? e.constraint ?? e.message ?? "").includes(constraint)
}
