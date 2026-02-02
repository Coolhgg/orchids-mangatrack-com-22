# MangaTrack

A modern manga/manhwa/manhua tracking and discovery platform built with Next.js 15.

## Tech Stack

- **Framework**: Next.js 15 (App Router, Turbopack)
- **Language**: TypeScript
- **Database**: PostgreSQL via Supabase + Prisma ORM
- **Auth**: Supabase Auth
- **Styling**: Tailwind CSS
- **Queue**: BullMQ + Redis
- **Testing**: Jest (unit), Playwright (E2E), k6 (load)

## Getting Started

### Prerequisites

- Node.js 20+
- npm
- Redis (for queue workers)

### Installation

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Start development server
npm run dev
```

### Database Extensions

The search feature requires PostgreSQL extensions for fuzzy matching:

```sql
-- Enable in Supabase SQL Editor or migration
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
REDIS_URL=
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Build for production |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix ESLint issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Run Jest unit tests |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run test:coverage` | Run tests with coverage |

## Project Structure

```
src/
├── app/              # Next.js App Router pages and API routes
│   ├── (auth)/       # Authentication pages
│   ├── (dashboard)/  # Protected dashboard pages
│   └── api/          # API routes
├── components/       # React components
├── lib/              # Utilities, configs, hooks
├── workers/          # BullMQ worker processors
└── __tests__/        # Test files
    ├── unit/         # Unit tests
    ├── integration/  # Integration tests
    └── api/          # API route tests
```

## Testing

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Load tests (requires k6)
k6 run load-tests/api-load-test.js
```

## Code Quality

This project uses:
- **ESLint** for linting
- **Prettier** for formatting
- **TypeScript** strict mode
- **Husky** pre-commit hooks (optional)

## License

Private - All rights reserved.
