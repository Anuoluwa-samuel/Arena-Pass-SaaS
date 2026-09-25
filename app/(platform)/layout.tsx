/**
 * The platform's own pages.
 *
 * Deliberately outside `(public)`: everything under that group resolves an
 * arena from the hostname, and these pages exist precisely where there is no
 * arena yet — signing up is how the first one comes into being. A registration
 * form that 404s because the visitor has no tenant would be a closed front
 * door.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col">{children}</div>
}
