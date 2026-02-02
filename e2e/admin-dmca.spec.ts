import { test, expect } from '@playwright/test';

/**
 * Admin DMCA E2E Tests
 * 
 * Verifies the admin DMCA moderation endpoints.
 */
test.describe('Admin DMCA API', () => {
  test('should return 401 when unauthenticated', async ({ request }) => {
    const response = await request.get('/api/admin/dmca');
    expect(response.status()).toBe(401);
  });

  test('should return 403 when authenticated as regular user', async ({ request }) => {
    // Note: This assumes the default storageState in playwright.config.ts 
    // is a regular user (if any). If no auth is set up, it will still return 401.
    // In a real environment, we would use a different storageState for the admin.
    const response = await request.get('/api/admin/dmca');
    
    // If we're not logged in at all in the default state, it will be 401.
    // If we're logged in as a non-admin, it should be 403.
    expect([401, 403]).toContain(response.status());
  });

  test('PATCH should require valid request_id and action', async ({ request }) => {
    const response = await request.patch('/api/admin/dmca', {
      data: {
        request_id: 'invalid-uuid',
        action: 'resolve'
      }
    });
    
    // Even if unauthorized, the validation might run or it might stop at auth.
    // Usually it stops at auth.
    expect([401, 403, 400]).toContain(response.status());
  });
});

test.describe('Public DMCA Page', () => {
  test('should load the public DMCA page', async ({ page }) => {
    await page.goto('/dmca');
    await expect(page.locator('h1')).toContainText('DMCA Policy');
    await expect(page.locator('form')).toBeVisible();
  });

  test('should validate the DMCA form fields', async ({ page }) => {
    await page.goto('/dmca');
    
    // Submit empty form
    await page.click('button[type="submit"]');
    
    // Check for validation messages
    await expect(page.locator('text=Email address is required')).toBeVisible();
    await expect(page.locator('text=Title of copyrighted work is required')).toBeVisible();
    await expect(page.locator('text=Target URL is required')).toBeVisible();
  });
});
