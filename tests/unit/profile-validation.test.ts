import { describe, it, expect } from "vitest"
import { isValidBirthDate, profileSchema } from "@/lib/validation/profile"

const today = new Date(2026, 8, 17) // 17 Sep 2026, local time

describe("date of birth", () => {
  it("accepts real past dates, including leap days and today", () => {
    expect(isValidBirthDate("1998-04-12", today)).toBe(true)
    expect(isValidBirthDate("2000-02-29", today)).toBe(true)
    expect(isValidBirthDate("2026-09-17", today)).toBe(true)
  })
  it("rejects impossible, future, too-old and malformed dates", () => {
    for (const bad of ["2001-02-29", "1998-13-01", "1998-04-31", "2026-09-18", "1899-12-31", "12/04/1998", "1998-4-12", ""]) {
      expect(isValidBirthDate(bad, today), bad).toBe(false)
    }
  })
})

describe("profile schema", () => {
  const base = { name: "Ada Okafor" }
  it("normalises the username to lowercase and treats blanks as not set", () => {
    const out = profileSchema.parse({ ...base, username: "  Ada_10 ", phone: "", gender: "", city: "  " })
    expect(out.username).toBe("ada_10")
    expect(out.phone).toBeNull()
    expect(out.gender).toBeNull()
    expect(out.city).toBeNull()
  })
  it.each([["ab"], ["_ada"], ["ada."], ["ada 10"], ["ada-10"], ["a".repeat(21)]])("rejects username %s", (username) => {
    expect(profileSchema.safeParse({ ...base, username }).success).toBe(false)
  })
  it("rejects reserved usernames in any case", () => {
    expect(profileSchema.safeParse({ ...base, username: "Admin" }).success).toBe(false)
    expect(profileSchema.safeParse({ ...base, username: "gameslots" }).success).toBe(false)
  })
  it("only allows known options", () => {
    expect(profileSchema.safeParse({ ...base, preferredPosition: "striker" }).success).toBe(false)
    expect(profileSchema.safeParse({ ...base, preferredPosition: "forward", skillLevel: "advanced", gender: "female" }).success).toBe(true)
  })
  it("requires a real name", () => {
    expect(profileSchema.safeParse({ name: " a " }).success).toBe(false)
  })
})
