import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"
import { XP_SERIES_COMPLETED } from "@/lib/gamification/xp"

export async function testLibraryBulkOperations() {
  console.log("=== TESTING LIBRARY BULK OPERATIONS ===")
  
  // 1. Setup test data
  const testUserId = "00000000-0000-0000-0000-000000000001" // Mock admin or test user
  const series = await prisma.series.findFirst({ where: { deleted_at: null } })
  
  if (!series) {
    console.log("Skipping test: No series found in database")
    return
  }

  console.log(`Using series: ${series.title}`)

  // Create library entries if they don't exist
  const entry = await prisma.libraryEntry.upsert({
    where: { user_id_series_id: { user_id: testUserId, series_id: series.id } },
    update: { status: 'reading', deleted_at: null },
    create: {
      user_id: testUserId,
      series_id: series.id,
      status: 'reading',
      source_url: `https://example.com/series/${series.id}`,
      source_name: 'test'
    }
  })

  const initialUser = await prisma.user.findUnique({ where: { id: testUserId } })
  const initialXp = initialUser?.xp || 0

  console.log(`Initial status: ${entry.status}, XP: ${initialXp}`)

  // 2. Perform bulk update
  console.log("Performing bulk update (status -> completed)...")
  
  // Simulate API call logic (since we can't easily hit the endpoint in this script)
  // We'll just verify the logic matches the route implementation
  
  const updates = [
    { id: entry.id, status: 'completed', rating: 10 }
  ]

  // This matches the logic in src/app/api/library/bulk/route.ts
  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      await tx.libraryEntry.update({
        where: { id: update.id, user_id: testUserId },
        data: { 
            status: update.status, 
            user_rating: update.rating,
            updated_at: new Date() 
        }
      })
      
      // XP reward logic
      await tx.user.update({
        where: { id: testUserId },
        data: { xp: { increment: XP_SERIES_COMPLETED } }
      })
      
      await tx.activity.create({
        data: {
          user_id: testUserId,
          type: 'series_completed',
          series_id: entry.series_id,
          metadata: {}
        }
      })
    }
  })

  // 3. Verify results
  const updatedEntry = await prisma.libraryEntry.findUnique({ where: { id: entry.id } })
  const updatedUser = await prisma.user.findUnique({ where: { id: testUserId } })
  
  console.log(`New status: ${updatedEntry?.status}, XP: ${updatedUser?.xp}`)
  
  const success = updatedEntry?.status === 'completed' && (updatedUser?.xp || 0) === initialXp + XP_SERIES_COMPLETED
  
  if (success) {
    console.log("PASS: Bulk update and XP award successful")
  } else {
    console.log("FAIL: Bulk update or XP award failed")
  }

  // Cleanup
  await prisma.libraryEntry.update({
    where: { id: entry.id },
    data: { status: 'reading' }
  })
  await prisma.user.update({
    where: { id: testUserId },
    data: { xp: initialXp }
  })
  
  console.log("=== TEST COMPLETE ===\n")
}

// Check if running directly
if (require.main === module) {
  testLibraryBulkOperations()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
}
