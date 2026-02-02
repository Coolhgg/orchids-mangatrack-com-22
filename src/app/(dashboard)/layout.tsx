import { Shell } from "@/components/layout/shell"
import { getCachedUser } from "@/lib/supabase/cached-user"
import { redirect } from "next/navigation"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCachedUser()

  if (!user) {
    redirect("/login")
  }

  return <Shell>{children}</Shell>
}
