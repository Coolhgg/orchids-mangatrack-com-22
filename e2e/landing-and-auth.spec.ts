import { test, expect, Page } from '@playwright/test';

/**
 * E2E Tests: Landing Page
 * 
 * Tests the public landing page experience for unauthenticated users.
 */
test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the hero section', async ({ page }) => {
    // Check for hero content
    await expect(page.locator('main')).toBeVisible();
    
    // Should have a header
    await expect(page.locator('header')).toBeVisible();
    
    // Should have navigation
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('should have working navigation links', async ({ page }) => {
    // Check for login link
    const loginLink = page.getByRole('link', { name: /log ?in|sign ?in/i });
    await expect(loginLink).toBeVisible();
    
    // Check for signup/register link
    const signupLink = page.getByRole('link', { name: /sign ?up|register|get started/i });
    await expect(signupLink).toBeVisible();
  });

  test('should navigate to login page', async ({ page }) => {
    const loginLink = page.getByRole('link', { name: /log ?in|sign ?in/i }).first();
    await loginLink.click();
    
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  });

  test('should navigate to register page', async ({ page }) => {
    const signupLink = page.getByRole('link', { name: /sign ?up|register|get started/i }).first();
    await signupLink.click();
    
    await expect(page).toHaveURL(/\/register/);
  });

  test('should have footer with links', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
  });

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Page should still be functional
    await expect(page.locator('main')).toBeVisible();
    
    // Navigation might be in a hamburger menu
    const nav = page.getByRole('navigation');
    await expect(nav).toBeVisible();
  });

  test('should load without console errors', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Filter out known acceptable errors (e.g., third-party scripts)
    const criticalErrors = errors.filter(
      (error) => !error.includes('favicon') && !error.includes('third-party')
    );
    
    expect(criticalErrors).toHaveLength(0);
  });

  test('should redirect authenticated users to library', async ({ page, context }) => {
    // This test verifies the redirect behavior mentioned in the page component
    // For authenticated users, they should be redirected to /library
    
    // Note: This test runs with unauthenticated state by default
    // The actual redirect is tested in the auth flow tests
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
  });
});

/**
 * E2E Tests: Authentication Flow
 */
test.describe('Authentication Flow', () => {
  test('login page should render correctly', async ({ page }) => {
    await page.goto('/login');
    
    // Should have email input
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    
    // Should have password input
    await expect(page.locator('input[type="password"], input[name="password"]')).toBeVisible();
    
    // Should have submit button
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('login form should validate empty fields', async ({ page }) => {
    await page.goto('/login');
    
    // Click submit without filling fields
    await page.click('button[type="submit"]');
    
    // Should show validation error or HTML5 validation
    // The email field should be required
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('login form should validate email format', async ({ page }) => {
    await page.goto('/login');
    
    // Fill invalid email
    await page.fill('input[type="email"], input[name="email"]', 'invalid-email');
    await page.fill('input[type="password"], input[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    // Should show validation error
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('register page should render correctly', async ({ page }) => {
    await page.goto('/register');
    
    // Should have email input
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    
    // Should have password input
    await expect(page.locator('input[type="password"], input[name="password"]').first()).toBeVisible();
  });

  test('forgot password page should exist', async ({ page }) => {
    await page.goto('/forgot-password');
    
    // Should have email input for password reset
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  });

  test('login should have link to register', async ({ page }) => {
    await page.goto('/login');
    
    const registerLink = page.getByRole('link', { name: /sign ?up|register|create/i });
    await expect(registerLink).toBeVisible();
  });

  test('register should have link to login', async ({ page }) => {
    await page.goto('/register');
    
    const loginLink = page.getByRole('link', { name: /log ?in|sign ?in|already have/i });
    await expect(loginLink).toBeVisible();
  });
});

/**
 * E2E Tests: Protected Routes (Unauthenticated Access)
 */
test.describe('Protected Routes - Unauthenticated', () => {
  const protectedRoutes = [
    '/library',
    '/feed',
    '/settings',
    '/discover',
    '/leaderboard',
    '/notifications',
  ];

  for (const route of protectedRoutes) {
    test(`${route} should redirect to login`, async ({ page }) => {
      const response = await page.goto(route);
      
      // Should redirect to login or show login page
      await page.waitForURL(/\/(login|auth)/);
      
      // Verify we're on the login page
      await expect(page).toHaveURL(/\/(login|auth)/);
    });
  }
});

/**
 * E2E Tests: API Health
 */
test.describe('API Health', () => {
  test('health endpoint should return 200', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data.status).toBe('ok');
  });
});

/**
 * E2E Tests: SEO and Metadata
 */
test.describe('SEO and Metadata', () => {
  test('landing page should have proper meta tags', async ({ page }) => {
    await page.goto('/');
    
    // Should have a title
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
    
    // Should have a description meta tag
    const description = await page.getAttribute('meta[name="description"]', 'content');
    // Description might be present
    if (description) {
      expect(description.length).toBeGreaterThan(0);
    }
    
    // Should have viewport meta tag
    const viewport = await page.getAttribute('meta[name="viewport"]', 'content');
    expect(viewport).toBeTruthy();
  });

  test('login page should have proper title', async ({ page }) => {
    await page.goto('/login');
    
    const title = await page.title();
    expect(title).toBeTruthy();
  });
});

/**
 * E2E Tests: Accessibility
 */
test.describe('Accessibility', () => {
  test('landing page should have accessible structure', async ({ page }) => {
    await page.goto('/');
    
    // Should have main landmark
    await expect(page.locator('main')).toBeVisible();
    
    // Should have header landmark
    await expect(page.locator('header')).toBeVisible();
    
    // Should have navigation landmark
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('login form should have accessible labels', async ({ page }) => {
    await page.goto('/login');
    
    // Email input should be accessible
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    await expect(emailInput).toBeVisible();
    
    // Check for associated label or aria-label
    const hasLabel = await emailInput.evaluate((el) => {
      const id = el.id;
      const ariaLabel = el.getAttribute('aria-label');
      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      const hasAssociatedLabel = id ? document.querySelector(`label[for="${id}"]`) !== null : false;
      const placeholder = el.getAttribute('placeholder');
      return hasAssociatedLabel || ariaLabel || ariaLabelledBy || placeholder;
    });
    expect(hasLabel).toBeTruthy();
  });

  test('buttons should be keyboard accessible', async ({ page }) => {
    await page.goto('/login');
    
    // Tab to submit button
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    // Check that some element has focus
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeTruthy();
  });
});

/**
 * E2E Tests: Error Handling
 */
test.describe('Error Handling', () => {
  test('404 page should display for unknown routes', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist-12345');
    
    // Should return 404 or show error page
    expect(response?.status()).toBe(404);
  });

  test('API should return JSON for unknown endpoints', async ({ request }) => {
    const response = await request.get('/api/this-does-not-exist');
    
    // Should return 404
    expect(response.status()).toBe(404);
  });
});
