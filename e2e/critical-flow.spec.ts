import { test, expect } from '@playwright/test';

test.describe('Critical User Flow', () => {
  // We use a unique email for each run to avoid conflicts
  const testEmail = `qa-test-${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  const testUsername = `qauser_${Math.random().toString(36).substring(2, 7)}`;

  test('User journey: Landing -> Register -> Onboarding -> Library', async ({ page }) => {
    // 1. Landing Page
    await page.goto('/');
    await expect(page).toHaveTitle(/Kenmei|MangaTrack/i);
    
    // 2. Navigate to Register
    const registerBtn = page.getByRole('link', { name: /Start Reading Free|Register|Get Started/i }).first();
    await registerBtn.click();
    await expect(page).toHaveURL(/\/register/);

    // 3. Complete Registration
    await page.fill('input[name="username"]', testUsername);
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', testPassword);
    await page.click('button[type="submit"]');

    // Handle "Check your email" or automatic redirect to onboarding
    // Note: In test mode, we often bypass email confirmation or use a mock
    await expect(page).toHaveURL(/\/onboarding|\/check-email/, { timeout: 15000 });

    if (page.url().includes('onboarding')) {
      // 4. Onboarding Step 1: Import (Skip)
      await page.click('button:has-text("Skip for now")');
      
      // 5. Onboarding Step 2: Search and Add
      await expect(page.getByText(/Add your first series/i)).toBeVisible();
      const searchInput = page.getByPlaceholder(/Search for series/i);
      await searchInput.fill('Solo Leveling');
      
      // Wait for search results
      await expect(page.locator('text=Solo Leveling').first()).toBeVisible({ timeout: 10000 });
      
      // Click Add button for the first result
      const addButton = page.locator('button:has-text("Add")').first();
      await addButton.click();
      
      // Verify toast or success state
      await expect(page.getByText(/Added "Solo Leveling" to your library/i)).toBeVisible();
      
      // Continue to next step
      await page.click('button:has-text("Continue")');
      
      // 6. Onboarding Step 3: Notifications
      await expect(page.getByText(/Never miss a drop/i)).toBeVisible();
      await page.click('button:has-text("Enable Notifications")');
      
      // 7. Final Destination: Library
      await expect(page).toHaveURL(/\/library/);
      await expect(page.getByText('Solo Leveling')).toBeVisible();
    }
  });

  test('Guest access to browse and series detail', async ({ page }) => {
    await page.goto('/browse');
    await expect(page.getByRole('heading', { name: /Browse/i })).toBeVisible();
    
    // Click on a series card (assuming there are some)
    const seriesCard = page.locator('a[href^="/series/"]').first();
    if (await seriesCard.isVisible()) {
      await seriesCard.click();
      await expect(page).toHaveURL(/\/series\//);
      await expect(page.locator('h1')).toBeVisible();
    }
  });
});
