import { AuthGate } from "@/components/auth/AuthContext";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TenantProvider } from "@/components/dashboard/TenantContext";

// The dashboard waits for the user's session before rendering (the API enforces access on
// every request; this gate only decides what to show), so it opts out of instant-navigation
// prerender validation, as recommended in the Next.js authentication guide.
export const instant = false;

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <AuthGate>
      <TenantProvider>
        <div className="relative flex min-h-screen">
          {/* Background glow, clipped to the screen so it never makes phones scroll sideways. */}
          <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
            <div className="bg-grid absolute inset-0 opacity-60" />
            <div className="aurora-blob right-[-10%] top-[-15%] h-[600px] w-[600px] bg-violet/60" />
            <div className="aurora-blob bottom-[-20%] left-[20%] h-[500px] w-[500px] bg-accent/30 [animation-delay:-8s]" />
          </div>
          <Sidebar />
          <main className="min-w-0 flex-1 pt-16 lg:pt-0">{children}</main>
        </div>
      </TenantProvider>
    </AuthGate>
  );
}
