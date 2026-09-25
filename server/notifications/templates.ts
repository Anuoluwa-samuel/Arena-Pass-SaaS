import { formatDate, formatMoney, formatTimeRange } from "@/lib/format"

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

function layout(title: string, body: string, appName: string, footer = `You are receiving this because you booked a session with ${appName}.`) {
  return `<!doctype html><html><body style="margin:0;background:#0f1115;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e8eaed">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:700;font-size:20px;margin-bottom:24px"><span style="display:inline-block;background:#22c55e;color:#0f1115;border-radius:8px;padding:4px 8px;margin-right:8px">AP</span>${appName}</div>
    <div style="background:#171a21;border:1px solid #262a33;border-radius:16px;padding:28px">
      <h1 style="font-size:22px;margin:0 0 12px">${title}</h1>
      ${body}
    </div>
    <p style="color:#8b919c;font-size:12px;margin-top:24px">${footer}</p>
  </div></body></html>`
}

export function ticketDeliveryEmail(p: {
  appName: string
  customerName: string
  ticketNumber: string
  sessionTitle: string
  startsAt: Date
  endsAt: Date
  venue: string
  teamNumber: number | null
  slotNumber: number | null
  amount: number
  currency: string
  ticketUrl: string
}) {
  const subject = `Your ticket ${p.ticketNumber} for ${p.sessionTitle}`
  const details = `
    <p style="color:#b5bac4;margin:0 0 20px">Hi ${p.customerName}, your payment is confirmed and your spot is secured.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#8b919c">Ticket</td><td style="padding:6px 0;text-align:right;font-weight:600">${p.ticketNumber}</td></tr>
      <tr><td style="padding:6px 0;color:#8b919c">Session</td><td style="padding:6px 0;text-align:right">${p.sessionTitle}</td></tr>
      <tr><td style="padding:6px 0;color:#8b919c">Date</td><td style="padding:6px 0;text-align:right">${formatDate(p.startsAt)}</td></tr>
      <tr><td style="padding:6px 0;color:#8b919c">Time</td><td style="padding:6px 0;text-align:right">${formatTimeRange(p.startsAt, p.endsAt)}</td></tr>
      <tr><td style="padding:6px 0;color:#8b919c">Venue</td><td style="padding:6px 0;text-align:right">${p.venue}</td></tr>
      ${p.teamNumber ? `<tr><td style="padding:6px 0;color:#8b919c">Team / Slot</td><td style="padding:6px 0;text-align:right">Team ${p.teamNumber} · Player ${p.slotNumber}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#8b919c">Paid</td><td style="padding:6px 0;text-align:right">${formatMoney(p.amount, p.currency)}</td></tr>
    </table>
    <a href="${p.ticketUrl}" style="display:block;margin-top:24px;background:#22c55e;color:#0f1115;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:600">View your digital ticket</a>
    <p style="color:#8b919c;font-size:13px;margin-top:16px">Show the QR code on your ticket at the arena entrance.</p>`
  const text = `Hi ${p.customerName},\n\nYour ticket ${p.ticketNumber} for ${p.sessionTitle} is confirmed.\n${formatDate(p.startsAt)} ${formatTimeRange(p.startsAt, p.endsAt)} at ${p.venue}.\n${p.teamNumber ? `Team ${p.teamNumber}, player ${p.slotNumber}.\n` : ""}View your ticket: ${p.ticketUrl}\n`
  return { subject, html: layout("Payment confirmed", details, p.appName), text }
}

export function sessionCancelledEmail(p: { appName: string; customerName: string; sessionTitle: string; startsAt: Date; reason: string }) {
  const subject = `Session cancelled: ${p.sessionTitle}`
  const html = layout(
    "Session cancelled",
    `<p style="color:#b5bac4">Hi ${p.customerName}, unfortunately <strong>${p.sessionTitle}</strong> on ${formatDate(p.startsAt)} has been cancelled.</p><p style="color:#b5bac4">Reason: ${p.reason}</p><p style="color:#b5bac4">Your payment will be refunded to the original payment method.</p>`,
    p.appName
  )
  return { subject, html, text: `Hi ${p.customerName}, ${p.sessionTitle} on ${formatDate(p.startsAt)} has been cancelled. Reason: ${p.reason}. Your payment will be refunded.` }
}

export function refundEmail(p: { appName: string; customerName: string; /** e.g. "ticket AP-2026-000123" or "payment PAY-…" */ itemLabel: string; amount: number; currency: string }) {
  const subject = `Refund issued for your ${p.itemLabel}`
  const html = layout(
    "Refund issued",
    `<p style="color:#b5bac4">Hi ${p.customerName}, we have refunded ${formatMoney(p.amount, p.currency)} for your ${p.itemLabel}. It can take a few business days to appear on your statement.</p>`,
    p.appName
  )
  return { subject, html, text: `Hi ${p.customerName}, we have refunded ${formatMoney(p.amount, p.currency)} for your ${p.itemLabel}.` }
}

export function sessionReminderEmail(p: { appName: string; customerName: string; sessionTitle: string; startsAt: Date; endsAt: Date; venue: string; ticketUrl: string }) {
  const subject = `Reminder: ${p.sessionTitle} is coming up`
  const html = layout(
    "See you on the pitch",
    `<p style="color:#b5bac4">Hi ${p.customerName}, <strong>${p.sessionTitle}</strong> kicks off ${formatDate(p.startsAt)} at ${formatTimeRange(p.startsAt, p.endsAt)}, ${p.venue}.</p><a href="${p.ticketUrl}" style="display:block;margin-top:20px;background:#22c55e;color:#0f1115;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:600">Open your ticket</a>`,
    p.appName
  )
  return { subject, html, text: `Reminder: ${p.sessionTitle} on ${formatDate(p.startsAt)} at ${p.venue}. Ticket: ${p.ticketUrl}` }
}

export function passwordResetEmail(p: { appName: string; customerName: string; resetUrl: string; expiresInMinutes: number }) {
  const subject = `Reset your ${p.appName} password`
  const name = escapeHtml(p.customerName)
  const html = layout(
    "Reset your password",
    `<p style="color:#b5bac4;margin:0 0 20px">Hi ${name}, we received a request to reset the password for your account.</p>
    <a href="${p.resetUrl}" style="display:block;background:#22c55e;color:#0f1115;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:600">Choose a new password</a>
    <p style="color:#8b919c;font-size:13px;margin-top:16px">This link expires in ${p.expiresInMinutes} minutes and can only be used once. If you didn't ask for this, you can ignore this email — your password won't change.</p>`,
    p.appName,
    `You are receiving this because a password reset was requested for your ${p.appName} account.`
  )
  const text = `Hi ${p.customerName},\n\nReset your ${p.appName} password: ${p.resetUrl}\n\nThis link expires in ${p.expiresInMinutes} minutes and can only be used once. If you didn't ask for this, ignore this email.\n`
  return { subject, html, text }
}

export function emailVerificationEmail(p: { appName: string; customerName: string; verifyUrl: string; expiresInHours: number }) {
  const subject = `Confirm your email for ${p.appName}`
  const name = escapeHtml(p.customerName)
  const html = layout(
    "Confirm your email",
    `<p style="color:#b5bac4;margin:0 0 20px">Hi ${name}, confirm this address so we can send you your tickets and session reminders.</p>
    <a href="${p.verifyUrl}" style="display:block;background:#22c55e;color:#0f1115;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:600">Confirm my email</a>
    <p style="color:#8b919c;font-size:13px;margin-top:16px">This link expires in ${p.expiresInHours} hours and can only be used once. If you didn't create this account, you can ignore this email.</p>`,
    p.appName,
    `You are receiving this because an account was created at ${p.appName} with this email address.`
  )
  const text = `Hi ${p.customerName},\n\nConfirm your email for ${p.appName}: ${p.verifyUrl}\n\nThis link expires in ${p.expiresInHours} hours and can only be used once. If you didn't create this account, ignore this email.\n`
  return { subject, html, text }
}

export function refundRequiredAdminEmail(p: { appName: string; customerName: string; customerEmail: string; sessionTitle: string; reference: string; amount: number; currency: string; paymentsUrl: string }) {
  const subject = `Action needed: refund ${formatMoney(p.amount, p.currency)} to ${p.customerName}`
  const html = layout(
    "Refund needed",
    `<p style="color:#b5bac4;margin:0 0 16px">A customer paid after their slot reservation expired, and <strong>${escapeHtml(p.sessionTitle)}</strong> filled up in the meantime, so no ticket was issued. The money has been received and must be refunded.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#8b919c">Customer</td><td style="padding:6px 0;text-align:right">${escapeHtml(p.customerName)} · ${escapeHtml(p.customerEmail)}</td></tr>
      <tr><td style="padding:6px 0;color:#8b919c">Amount</td><td style="padding:6px 0;text-align:right;font-weight:600">${formatMoney(p.amount, p.currency)}</td></tr>
      <tr><td style="padding:6px 0;color:#8b919c">Reference</td><td style="padding:6px 0;text-align:right">${escapeHtml(p.reference)}</td></tr>
    </table>
    <a href="${p.paymentsUrl}" style="display:block;margin-top:24px;background:#22c55e;color:#0f1115;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:600">Review and refund</a>`,
    p.appName,
    `You are receiving this because you can issue refunds for ${p.appName}.`
  )
  const text = `Refund needed: ${p.customerName} (${p.customerEmail}) paid ${formatMoney(p.amount, p.currency)} for ${p.sessionTitle} after their reservation expired, and the session is full. No ticket was issued. Reference ${p.reference}. Review and refund: ${p.paymentsUrl}\n`
  return { subject, html, text }
}
