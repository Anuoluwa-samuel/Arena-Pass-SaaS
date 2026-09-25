"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { SmokeyBackground } from "@/components/ui/login-form"
import { Reveal } from "@/components/motion"
import { cn } from "@/lib/utils"
import { initials } from "@/lib/format"

/** Smoke backdrop + brand mark shared by the customer and admin sign-in pages. */
export function AuthShell({ siteName, children, className }: { siteName: string; children: ReactNode; className?: string }) {
  return (
    // Auth pages render without a navbar, so the shell fills the viewport; `isolate` keeps the smoke behind this section only.
    <section className={cn("relative isolate flex min-h-svh items-center justify-center overflow-hidden px-4 py-12", className)}>
      <SmokeyBackground className="-z-10" />
      <div className="flex w-full max-w-sm flex-col items-center">
        <Reveal trigger="mount" y={8}>
          <Link href="/" className="mb-8 flex items-center justify-center gap-2">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary"><span className="text-sm font-black text-primary-foreground">{initials(siteName)}</span></div>
            <span className="text-2xl font-bold">{siteName}</span>
          </Link>
        </Reveal>
        <Reveal trigger="mount" delay={0.08} className="w-full">
          {children}
        </Reveal>
      </div>
    </section>
  )
}
