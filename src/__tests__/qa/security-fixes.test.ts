// Jest globals are available without imports

describe('QA Security Fixes Verification', () => {
  describe('H1: CSRF Wildcard Domain Bypass Fix', () => {
    it('should have removed wildcard domain matching', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const apiUtilsContent = fs.readFileSync(
        path.join(process.cwd(), 'src/lib/api-utils.ts'),
        'utf-8'
      );
      
      expect(apiUtilsContent).not.toContain('.orchids.cloud');
      expect(apiUtilsContent).not.toContain('.vercel.app');
      expect(apiUtilsContent).toContain('ALLOWED_CSRF_ORIGINS');
    });

    it('should use explicit allowlist from env var', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const apiUtilsContent = fs.readFileSync(
        path.join(process.cwd(), 'src/lib/api-utils.ts'),
        'utf-8'
      );
      
      expect(apiUtilsContent).toContain("process.env.ALLOWED_CSRF_ORIGINS");
    });

    it('should check NEXT_PUBLIC_SITE_URL for validation', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const apiUtilsContent = fs.readFileSync(
        path.join(process.cwd(), 'src/lib/api-utils.ts'),
        'utf-8'
      );
      
      expect(apiUtilsContent).toContain("process.env.NEXT_PUBLIC_SITE_URL");
    });

    it('should skip validation in development mode', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const apiUtilsContent = fs.readFileSync(
        path.join(process.cwd(), 'src/lib/api-utils.ts'),
        'utf-8'
      );
      
      expect(apiUtilsContent).toContain("process.env.NODE_ENV === 'development'");
    });
  });

  describe('H2: Request Body Clone Fix', () => {
    it('should use request.clone() in notifications route', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const notificationsContent = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/notifications/route.ts'),
        'utf-8'
      );
      
      expect(notificationsContent).toContain('request.clone()');
    });
  });

  describe('M2: Chapter Pagination Limit', () => {
    it('should have MAX_CHAPTERS_PER_BULK constant defined', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const progressRouteContent = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/library/[id]/progress/route.ts'),
        'utf-8'
      );
      
      expect(progressRouteContent).toContain('MAX_CHAPTERS_PER_BULK');
      expect(progressRouteContent).toContain('LIMIT');
    });

    it('should limit bulk chapter queries to 2000', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const progressRouteContent = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/library/[id]/progress/route.ts'),
        'utf-8'
      );
      
      expect(progressRouteContent).toMatch(/MAX_CHAPTERS_PER_BULK\s*=\s*2000/);
    });
  });

  describe('Trust Score Leaderboard Filter', () => {
    it('should have TRUST_SCORE_MIN_FOR_LEADERBOARD constant', async () => {
      const { TRUST_SCORE_MIN_FOR_LEADERBOARD } = await import('@/lib/gamification/trust-score');
      
      expect(TRUST_SCORE_MIN_FOR_LEADERBOARD).toBeDefined();
      expect(TRUST_SCORE_MIN_FOR_LEADERBOARD).toBe(0.6);
    });

    it('should filter leaderboard queries by trust score', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const leaderboardContent = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/leaderboard/route.ts'),
        'utf-8'
      );
      
      expect(leaderboardContent).toContain('trust_score');
      expect(leaderboardContent).toContain('TRUST_SCORE_MIN_FOR_LEADERBOARD');
    });
  });

  describe('Request ID Tracking', () => {
    it('should have REQUEST_ID_HEADER constant defined', async () => {
      const { REQUEST_ID_HEADER } = await import('@/lib/request-id');
      
      expect(REQUEST_ID_HEADER).toBe('X-Request-ID');
    });

    it('should generate unique request IDs', async () => {
      const { generateRequestId } = await import('@/lib/request-id');
      
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it('should add request ID header to middleware', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const middlewareContent = fs.readFileSync(
        path.join(process.cwd(), 'src/middleware.ts'),
        'utf-8'
      );
      
      expect(middlewareContent).toContain('REQUEST_ID_HEADER');
      expect(middlewareContent).toContain('requestId');
    });
  });

  describe('Logger Migration', () => {
    it('should use logger instead of console in api-utils', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const apiUtilsContent = fs.readFileSync(
        path.join(process.cwd(), 'src/lib/api-utils.ts'),
        'utf-8'
      );
      
      expect(apiUtilsContent).toContain("import { logger }");
      expect(apiUtilsContent).toContain('logger.info');
      expect(apiUtilsContent).toContain('logger.error');
      expect(apiUtilsContent).toContain('logger.warn');
    });

    it('should use logger in progress route', async () => {
      const fs = await import('fs');
      const path = await import('path');
      
      const progressContent = fs.readFileSync(
        path.join(process.cwd(), 'src/app/api/library/[id]/progress/route.ts'),
        'utf-8'
      );
      
      expect(progressContent).toContain("import { logger }");
    });
  });

  describe('Error Boundary Component', () => {
    it('should export ErrorBoundary component', async () => {
      const { ErrorBoundary, withErrorBoundary, AsyncErrorBoundary } = await import('@/components/ErrorBoundary');
      
      expect(ErrorBoundary).toBeDefined();
      expect(withErrorBoundary).toBeDefined();
      expect(AsyncErrorBoundary).toBeDefined();
    });
  });

  describe('Error Monitoring Utility', () => {
    it('should export monitoring functions', async () => {
      const { 
        captureException, 
        captureMessage, 
        setUser, 
        addBreadcrumb,
        initMonitoring 
      } = await import('@/lib/monitoring');
      
      expect(captureException).toBeDefined();
      expect(captureMessage).toBeDefined();
      expect(setUser).toBeDefined();
      expect(addBreadcrumb).toBeDefined();
      expect(initMonitoring).toBeDefined();
    });
  });
});
