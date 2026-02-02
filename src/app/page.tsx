import { redirect } from 'next/navigation'
import { getCachedUser } from '@/lib/supabase/cached-user'
import ScrollytellingLanding from '@/components/landing/ScrollytellingLanding'

export default async function Home() {
  const user = await getCachedUser()

  if (user) {
    const username = user.user_metadata?.username || user.app_metadata?.username
    if (!username) {
      redirect('/onboarding')
    }
    redirect('/library')
  }

  return <ScrollytellingLanding />
}
