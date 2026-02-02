import { Shell } from "@/components/layout/shell"

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <Shell>{children}</Shell>
}
