import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Testing Prisma connection...')
  try {
    const userCount = await prisma.user.count()
    console.log(`Successfully connected to database! Found ${userCount} users.`)
    
    const series = await prisma.series.findMany({ take: 1 })
    console.log('Series count:', series.length)
    if (series.length > 0) {
      console.log('Sample series title:', series[0].title)
    }
  } catch (error: any) {
    console.error('Prisma connection test failed!')
    console.error('Error message:', error.message)
    console.error('Error code:', error.code)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
