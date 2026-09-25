import type { Permission } from "@/lib/domain/constants"

export interface AdminNavItem {
  href: string
  label: string
  icon: string
  permission: Permission
  children?: Array<{ href: string; label: string }>
}

export interface AdminNavGroup {
  label: string
  items: AdminNavItem[]
}

/** Sidebar structure. Items are filtered by the user's permissions at render time. */
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: "layout-dashboard", permission: "dashboard.view" },
      { href: "/admin/analytics", label: "Analytics", icon: "bar-chart-3", permission: "analytics.view" },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/admin/sessions",
        label: "Sessions",
        icon: "calendar-days",
        permission: "sessions.view",
        children: [
          { href: "/admin/sessions", label: "All sessions" },
          { href: "/admin/sessions/new", label: "Create session" },
          { href: "/admin/sessions?status=upcoming", label: "Upcoming" },
          { href: "/admin/sessions?status=completed", label: "Completed" },
          { href: "/admin/sessions?status=CANCELLED", label: "Cancelled" },
        ],
      },
      {
        href: "/admin/tickets",
        label: "Tickets",
        icon: "ticket",
        permission: "tickets.view",
        children: [
          { href: "/admin/tickets", label: "All tickets" },
          { href: "/admin/tickets?status=CONFIRMED", label: "Sold" },
          { href: "/admin/tickets?status=USED", label: "Used" },
          { href: "/admin/tickets?status=REFUNDED", label: "Refunded" },
          { href: "/admin/tickets?status=CANCELLED", label: "Cancelled" },
        ],
      },
      { href: "/admin/validate", label: "Ticket validation", icon: "scan-line", permission: "tickets.validate" },
      { href: "/admin/customers", label: "Customers", icon: "users", permission: "customers.view" },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/admin/payments", label: "Payments", icon: "credit-card", permission: "payments.view" },
      { href: "/admin/payments/transactions", label: "Transactions", icon: "receipt", permission: "payments.view" },
    ],
  },
  {
    label: "Content",
    items: [
      {
        href: "/admin/content",
        label: "Content",
        icon: "layout-template",
        permission: "cms.view",
        children: [
          { href: "/admin/content/homepage", label: "Homepage" },
          { href: "/admin/content/about", label: "About" },
          { href: "/admin/content/services", label: "Services" },
          { href: "/admin/content/faqs", label: "FAQs" },
          { href: "/admin/content/announcements", label: "Announcements" },
          { href: "/admin/content/banners", label: "Banners" },
          { href: "/admin/content/contact", label: "Contact info" },
        ],
      },
      { href: "/admin/media", label: "Media library", icon: "image", permission: "media.view" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/admin/onboarding", label: "Set up", icon: "rocket", permission: "settings.view" },
      { href: "/admin/administrators", label: "Staff", icon: "shield", permission: "staff.view" },
      { href: "/admin/roles", label: "Roles & permissions", icon: "key-round", permission: "platform.roles.manage" },
      { href: "/admin/notifications", label: "Notifications", icon: "bell", permission: "notifications.view" },
      { href: "/admin/settings", label: "System settings", icon: "settings", permission: "settings.view" },
      { href: "/admin/audit-logs", label: "Audit logs", icon: "scroll-text", permission: "audit.view" },
    ],
  },
]
