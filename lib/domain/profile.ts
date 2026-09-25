/** Customer profile options, shared by the form, validation and admin views. */

export const GENDERS = ["female", "male", "prefer_not_to_say"] as const
export const POSITIONS = ["goalkeeper", "defender", "midfielder", "forward", "anywhere"] as const
export const SKILL_LEVELS = ["beginner", "intermediate", "advanced"] as const

export type Gender = (typeof GENDERS)[number]
export type Position = (typeof POSITIONS)[number]
export type SkillLevel = (typeof SKILL_LEVELS)[number]

export const GENDER_LABELS: Record<Gender, string> = { female: "Female", male: "Male", prefer_not_to_say: "Prefer not to say" }
export const POSITION_LABELS: Record<Position, string> = { goalkeeper: "Goalkeeper", defender: "Defender", midfielder: "Midfielder", forward: "Forward", anywhere: "Anywhere on the pitch" }
export const SKILL_LABELS: Record<SkillLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" }

/** 3–20 characters: lowercase letters, numbers, underscore and dot; starts and ends with a letter or number. */
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_.]{1,18}[a-z0-9])$/
/** Handles that could impersonate staff or the brand. */
export const RESERVED_USERNAMES = new Set(["admin", "administrator", "gameslots", "arena_pass", "arena.pass", "support", "staff", "root", "system", "help", "official", "moderator", "owner"])

export const MIN_BIRTH_YEAR = 1900
