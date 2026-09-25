import { describe, it, expect, vi, beforeEach } from "vitest"
import { BlobStorageAdapter } from "@/server/storage/blob"
import { assertSafeBootstrapAdmin } from "@/server/db/baseline"

// vi.mock is hoisted above these imports, so the adapter sees the mocked SDK.

const put = vi.fn()
const del = vi.fn()
vi.mock("@vercel/blob", () => ({ put: (...a: unknown[]) => put(...a), del: (...a: unknown[]) => del(...a) }))


describe("BlobStorageAdapter", () => {
  beforeEach(() => {
    put.mockReset()
    del.mockReset()
  })

  it("uploads publicly under the given key with no random suffix and returns the CDN url", async () => {
    put.mockResolvedValue({ url: "https://abc123.public.blob.vercel-storage.com/content/f1.jpg", pathname: "content/f1.jpg" })
    const adapter = new BlobStorageAdapter("vercel_blob_rw_test")
    const out = await adapter.put("content/f1.jpg", Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg")
    expect(out).toEqual({ url: "https://abc123.public.blob.vercel-storage.com/content/f1.jpg" })
    const [key, body, opts] = put.mock.calls[0]
    expect(key).toBe("content/f1.jpg")
    expect(Buffer.isBuffer(body)).toBe(true)
    expect(opts).toMatchObject({ access: "public", contentType: "image/jpeg", token: "vercel_blob_rw_test", addRandomSuffix: false })
  })

  it("deletes by key and never claims a local path", async () => {
    const adapter = new BlobStorageAdapter("vercel_blob_rw_test")
    await adapter.delete("content/f1.jpg")
    expect(del).toHaveBeenCalledWith("content/f1.jpg", { token: "vercel_blob_rw_test" })
    expect(adapter.localPath()).toBeNull()
  })

  it("passes no token when none is configured, so the SDK can use Vercel's OIDC credentials", async () => {
    put.mockResolvedValue({ url: "https://abc123.public.blob.vercel-storage.com/content/f2.png" })
    const adapter = new BlobStorageAdapter(undefined)
    await adapter.put("content/f2.png", Buffer.from([0x89, 0x50]), "image/png")
    expect(put.mock.calls[0][2]).not.toHaveProperty("token")
    await adapter.delete("content/f2.png")
    expect(del).toHaveBeenCalledWith("content/f2.png", undefined)
  })
})

describe("first production admin", () => {
  it("refuses the development defaults and weak passwords", () => {
    expect(() => assertSafeBootstrapAdmin(undefined, "a-very-strong-password")).toThrow(/BOOTSTRAP_ADMIN_EMAIL/)
    expect(() => assertSafeBootstrapAdmin("admin@gameslots.local", "a-very-strong-password")).toThrow(/BOOTSTRAP_ADMIN_EMAIL/)
    expect(() => assertSafeBootstrapAdmin("owner@example.com", undefined)).toThrow(/BOOTSTRAP_ADMIN_PASSWORD/)
    expect(() => assertSafeBootstrapAdmin("owner@example.com", "ChangeMe123!")).toThrow(/BOOTSTRAP_ADMIN_PASSWORD/)
    expect(() => assertSafeBootstrapAdmin("owner@example.com", "short1!")).toThrow(/BOOTSTRAP_ADMIN_PASSWORD/)
  })
  it("accepts a real email and a strong password", () => {
    expect(() => assertSafeBootstrapAdmin("owner@example.com", "correct-horse-battery-staple")).not.toThrow()
  })
})
