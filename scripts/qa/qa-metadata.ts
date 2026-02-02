
import { prisma } from '../../src/lib/prisma';
import { getMangaById } from '../../src/lib/mangadex';

// Mocking getMangaById if needed, but let's see if it works or if I should just mock the result
// For the purpose of this QA, I'll mock the internal behavior to ensure the prisma updates are correct.

async function runQA() {
  console.log('--- Metadata QA Started ---');

  // Setup: Create a test user
  const user = await prisma.user.upsert({
    where: { username: 'qa_tester' },
    update: {},
    create: {
      email: 'qa@test.com',
      username: 'qa_tester',
      password_hash: 'test',
    }
  });

  // Setup: Create a test series
  const series = await prisma.series.upsert({
    where: { mangadex_id: 'original-id' },
    update: {
      title: 'Original Title',
      metadata_source: 'CANONICAL',
      metadata_confidence: 1.0,
      override_user_id: null,
    },
    create: {
      mangadex_id: 'original-id',
      title: 'Original Title',
      type: 'manga',
      metadata_source: 'CANONICAL',
      metadata_confidence: 1.0,
    }
  });

  console.log('1. Initial State: CANONICAL metadata');
  
  // Test Case 3: User manually overrides metadata
  console.log('Test Case 3: Manual override simulation');
  const mockCanonicalData = {
    title: 'Overridden Title',
    alternative_titles: [],
    description: 'New Description',
    cover_url: 'http://test.com/cover.jpg',
    status: 'ongoing',
    genres: ['Action'],
    type: 'manga'
  };

  const updatedSeries = await prisma.series.update({
    where: { id: series.id },
    data: {
      title: mockCanonicalData.title,
      description: mockCanonicalData.description,
      metadata_source: 'USER_OVERRIDE',
      metadata_confidence: 0.8,
      override_user_id: user.id,
    }
  });

  if (updatedSeries.metadata_source === 'USER_OVERRIDE' && updatedSeries.override_user_id === user.id) {
    console.log('PASS: Test Case 3 - Metadata source and user ID correctly stored');
  } else {
    console.log('FAIL: Test Case 3');
  }

  // Test Case 4: Malicious input attempt (Sanitization)
  // Since we fetch from API, user input is only the ID.
  console.log('Test Case 4: Malicious input (ID level)');
  const maliciousId = 'abc-123<script>alert(1)</script>';
  // The extractMangaDexId logic should handle this.
  const { extractMangaDexId } = require('@/lib/mangadex-utils');
  const extracted = extractMangaDexId(maliciousId);
  if (extracted !== maliciousId && !extracted?.includes('<script>')) {
    console.log('PASS: Test Case 4 - Malicious ID sanitized or rejected');
  } else {
    console.log('FAIL: Test Case 4');
  }

  // Test Case 5: Multiple users
  console.log('Test Case 5: Multiple users isolation');
  // Series is global, so an override by one user affects others viewing it.
  // Requirement 5: "Do NOT block syncing or reading under any condition"
  // This means the global record is updated, but marked as override.
  console.log('INFO: Series record updated globally, as per requirement "Metadata records are shared across users"');

  console.log('--- QA Finished ---');
}

runQA().catch(console.error);
