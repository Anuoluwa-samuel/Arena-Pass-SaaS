"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { BarChart3, Bell, CalendarDays, CreditCard, Image as ImageIcon, KeyRound, LayoutDashboard, LayoutTemplate, Receipt, Rocket, ScanLine, ScrollText, Settings, Shield, Ticket, Users, ChevronRight } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ADMIN_NAV } from "@/lib/admin-nav"
import type { Permission } from "@/lib/domain/constants"
import { initials } from "@/lib/format"

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "layout-dashboard": LayoutDashboard,
  "bar-chart-3": BarChart3,
  "calendar-days": CalendarDays,
  ticket: Ticket,
  "scan-line": ScanLine,
  users: Users,
  "credit-card": CreditCard,
  receipt: Receipt,
  "layout-template": LayoutTemplate,
  image: ImageIcon,
  shield: Shield,
  "key-round": KeyRound,
  bell: Bell,
  settings: Settings,
  "scroll-text": ScrollText,
  rocket: Rocket,
}

export function AdminSidebar({ permissions, siteName }: { permissions: Permission[]; siteName: string }) {
  const pathname = usePathname()
  const search = useSearchParams()
  const current = search.size ? `${pathname}?${search.toString()}` : pathname
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : href.includes("?") ? current === href : pathname === href || pathname.startsWith(href + "/"))
  const sectionActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href))

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-3">
        <Link href="/admin" className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary"><span className="text-xs font-black text-primary-foreground">{initials(siteName)}</span></div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold">{siteName}</p>
            <p className="text-[11px] text-muted-foreground">Control center</p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {ADMIN_NAV.map((group) => {
          const items = group.items.filter((i) => permissions.includes(i.permission))
          if (!items.length) return null
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const Icon = ICONS[item.icon] ?? LayoutDashboard
                    if (!item.children) {
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.label}>
                            <Link href={item.href}><Icon /><span>{item.label}</span></Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    }
                    return (
                      <Collapsible key={item.href} asChild defaultOpen={sectionActive(item.href)} className="group/collapsible">
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton tooltip={item.label} isActive={sectionActive(item.href)}>
                              <Icon />
                              <span>{item.label}</span>
                              <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {item.children.map((c) => (
                                <SidebarMenuSubItem key={c.href}>
                                  <SidebarMenuSubButton asChild isActive={isActive(c.href)}>
                                    <Link href={c.href}><span>{c.label}</span></Link>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              ))}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </SidebarMenuItem>
                      </Collapsible>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      <SidebarFooter className="p-3 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
        <Link href="/" className="hover:text-foreground">← View public site</Link>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
