import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addHiddenColumn() {
  try {
    // Add is_hidden column to achievements
    await prisma.$executeRawUnsafe(`
      ALTER TABLE achievements ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false
    `);
    console.log('✓ Added is_hidden column');

    // Create index
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS achievements_is_hidden_idx ON achievements(is_hidden)
    `);
    console.log('✓ Created index');

    // Verify
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'achievements' AND column_name = 'is_hidden'
    `;
    console.log('Column info:', result);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addHiddenColumn();
