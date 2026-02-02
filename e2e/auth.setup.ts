import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../playwright/.auth/user.json');

/**
 * Authentication Setup for E2E Tests
 * 
 * This file handles test user authentication and stores the session
 * for reuse across all test files.
 * 
 * For CI/CD, set environment variables:
 * - PLAYWRIGHT_TEST_EMAIL
 * - PLAYWRIGHT_TEST_PASSWORD
 */
setup('authenticate', async ({ page }) => {
  // Skip auth setup if testing unauthenticated flows only
  if (process.env.PLAYWRIGHT_SKIP_AUTH === 'true') {
    console.log('Skipping authentication setup');
    return;
  }

  const testEmail = process.env.PLAYWRIGHT_TEST_EMAIL;
  const testPassword = process.env.PLAYWRIGHT_TEST_PASSWORD;

  // If no test credentials, create a mock auth state for testing public pages
  if (!testEmail || !testPassword) {
    console.log('No test credentials provided. Running in unauthenticated mode.');
    console.log('Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD for authenticated tests.');
    
    // Create empty auth state
    await page.context().storageState({ path: authFile });
    return;
  }

  // Navigate to login page
  await page.goto('/login');
  
  // Wait for the login form to be visible
  await expect(page.locator('form')).toBeVisible();

  // Fill in credentials
  await page.fill('input[type="email"], input[name="email"]', testEmail);
  await page.fill('input[type="password"], input[name="password"]', testPassword);

  // Click login button
  await page.click('button[type="submit"]');

  // Wait for redirect to library (authenticated home page)
  await page.waitForURL('/library', { timeout: 30000 });
  
  // Verify we're logged in
  await expect(page).toHaveURL('/library');

  // Store authentication state
  await page.context().storageState({ path: authFile });
});
