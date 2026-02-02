"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

/**
 * Updates the preferred source for a specific series in the user's library.
 */
export async function updatePreferredSource(libraryEntryId: string, sourceName: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    throw new Error("Unauthorized")
  }

  const entry = await prisma.libraryEntry.findUnique({
    where: { id: libraryEntryId },
    select: { user_id: true, series_id: true }
  })

  if (!entry || entry.user_id !== user.id) {
    throw new Error("Library entry not found or unauthorized")
  }

  await prisma.libraryEntry.update({
    where: { id: libraryEntryId },
    data: { preferred_source: sourceName }
  })

  // Sync with per-series preference table
  if (entry.series_id) {
    if (sourceName) {
      await prisma.userSeriesSourcePreference.upsert({
        where: {
          user_id_series_id: {
            user_id: user.id,
            series_id: entry.series_id,
          },
        },
        update: { source_name: sourceName },
        create: {
          user_id: user.id,
          series_id: entry.series_id,
          source_name: sourceName,
        },
      })
    } else {
      await prisma.userSeriesSourcePreference.deleteMany({
        where: {
          user_id: user.id,
          series_id: entry.series_id,
        },
      })
    }
    revalidatePath(`/series/${entry.series_id}`)
  }
  revalidatePath('/library')
  
  return { success: true }
}

/**
 * Updates the global source priority list for the user.
 */
export async function updateSourcePriorities(sourceNames: string[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    throw new Error("Unauthorized")
  }

  // Transaction to update all priorities
  await prisma.$transaction([
    // Delete existing priorities
    prisma.userSourcePriority.deleteMany({
      where: { user_id: user.id }
    }),
    // Create new priorities
    ...sourceNames.map((name, index) => 
      prisma.userSourcePriority.create({
        data: {
          user_id: user.id,
          source_name: name,
          priority: index
        }
      })
    )
  ])

  revalidatePath('/settings')
  return { success: true }
}

/**
 * Updates the global default source (legacy support).
 */
export async function updateGlobalDefaultSource(sourceName: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    throw new Error("Unauthorized")
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { default_source: sourceName }
  })

  revalidatePath('/settings')
  return { success: true }
}

/**
 * Updates or creates a source preference for a specific series.
 */
export async function updateSeriesSourcePreference(seriesId: string, sourceName: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    throw new Error("Unauthorized")
  }

  if (sourceName) {
    await prisma.userSeriesSourcePreference.upsert({
      where: {
        user_id_series_id: {
          user_id: user.id,
          series_id: seriesId,
        },
      },
      update: { source_name: sourceName },
      create: {
        user_id: user.id,
        series_id: seriesId,
        source_name: sourceName,
      },
    })
  } else {
    await prisma.userSeriesSourcePreference.deleteMany({
      where: {
        user_id: user.id,
        series_id: seriesId,
      },
    })
  }

  revalidatePath(`/series/${seriesId}`)
  return { success: true }
}

/**
 * Gets the source preference for a specific series.
 */
export async function getSeriesSourcePreference(seriesId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return null

  return prisma.userSeriesSourcePreference.findUnique({
    where: {
      user_id_series_id: {
        user_id: user.id,
        series_id: seriesId,
      },
    },
  })
}
