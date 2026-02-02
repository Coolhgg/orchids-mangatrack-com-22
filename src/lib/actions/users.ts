'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function toggleFollow(followingId: string, username: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  if (user.id === followingId) {
    return { error: "You can't follow yourself" }
  }

  const { data: existing } = await supabase
    .from('follows')
    .select('id')
    .eq('follower_id', user.id)
    .eq('following_id', followingId)
    .single()

  if (existing) {
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('id', existing.id)
    
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('follows')
      .insert({
        follower_id: user.id,
        following_id: followingId
      })
    
    if (error) return { error: error.message }

    await supabase.from('activities').insert({
      user_id: user.id,
      type: 'user_followed',
      metadata: { following_id: followingId, following_username: username }
    })
  }

  revalidatePath(`/users/${username}`)
  revalidatePath('/friends')
  revalidatePath('/feed')
  return { success: true }
}

export async function updateProfile(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const bio = formData.get('bio') as string
  const avatar_url = formData.get('avatar_url') as string

  const { error } = await supabase
    .from('users')
    .update({
      bio,
      avatar_url,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { success: true }
}
