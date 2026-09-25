import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { AppError } from "./errors"
import { logger, serializeError } from "@/server/observability/logger"

export type ApiSuccess<T> = { success: true; data: T; message?: string; meta?: Record<string, unknown> }
export type ApiFailure = { success: false; message: string; code: string; details?: unknown }
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

export function ok<T>(data: T, init?: { message?: string; status?: number; meta?: Record<string, unknown>; headers?: HeadersInit }) {
  const body: ApiSuccess<T> = { success: true, data }
  if (init?.message) body.message = init.message
  if (init?.meta) body.meta = init.meta
  return NextResponse.json(body, { status: init?.status ?? 200, headers: init?.headers })
}

/**
 * Failures are never cached. A denial can depend on who asked, which arena
 * they asked about, and whether they were signed in at the time — none of
 * which belongs in a shared cache, and a stored 403 is a confusing thing to
 * serve back to someone who would now be allowed.
 */
export function fail(error: AppError, headers?: HeadersInit) {
  const body: ApiFailure = { success: false, message: error.message, code: error.code }
  if (error.details !== undefined) body.details = error.details
  const merged = new Headers(headers)
  if (!merged.has("Cache-Control")) merged.set("Cache-Control", "private, no-store")
  return NextResponse.json(body, { status: error.status, headers: merged })
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof ZodError) {
    return new AppError("VALIDATION_ERROR", "Please check the highlighted fields", {
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    })
  }
  return new AppError("INTERNAL_ERROR", "Something went wrong. Please try again.", { cause: err })
}

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>

/**
 * Wraps a route handler so every failure becomes the standard envelope and
 * unexpected errors are logged with a request id but never leaked.
 */
export function route<Ctx = { params: Promise<Record<string, string>> }>(handler: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    const started = Date.now()
    try {
      return await handler(req, ctx)
    } catch (err) {
      const appError = toAppError(err)
      if (appError.code === "INTERNAL_ERROR") {
        logger.error("http.unhandled", { method: req.method, url: req.url, error: serializeError(err) })
      } else {
        logger.debug("http.error", { method: req.method, url: req.url, code: appError.code, ms: Date.now() - started })
      }
      return fail(appError)
    }
  }
}
