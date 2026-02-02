import { prisma } from '@/lib/prisma';

describe('Privacy RLS Verification', () => {
  let testUser: any;

  beforeAll(async () => {
    // Create a user with default (NULL) privacy settings
    testUser = await prisma.user.create({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'privacy-test@example.com',
        username: 'privacytest',
      },
    });
  });

  afterAll(async () => {
    if (testUser) {
      await prisma.user.delete({ where: { id: testUser.id } });
    }
  });

  it('should verify that activity_public is not true by default', async () => {
    const user = await prisma.user.findUnique({
      where: { id: testUser.id },
      select: { privacy_settings: true }
    });
    
    // In our new RLS policy, we check for (privacy_settings->>'activity_public')::boolean IS TRUE
    // If it's NULL or false, it should not be viewable.
    const privacy = user?.privacy_settings as any;
    expect(privacy?.activity_public).not.toBe(true);
  });
});
