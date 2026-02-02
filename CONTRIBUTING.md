# Contributing to MangaTrack

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and configure
4. Run `npm run dev` to start development

## Code Style

- **TypeScript**: Use strict typing, avoid `any`
- **Formatting**: Run `npm run format` before committing
- **Linting**: Ensure `npm run lint` passes

### Naming Conventions

- Components: PascalCase (`UserProfile.tsx`)
- Utilities: camelCase (`formatDate.ts`)
- Test files: `*.test.ts` or `*.spec.ts`
- Constants: UPPER_SNAKE_CASE

## Pull Request Process

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and add tests
3. Run checks: `npm run lint && npm test`
4. Submit PR with clear description

## Testing

- Unit tests: `src/__tests__/unit/`
- Integration tests: `src/__tests__/integration/`
- E2E tests: `e2e/`

Run tests before submitting:
```bash
npm test
npm run test:e2e
```

## Commit Messages

Use conventional commits:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `test:` Test changes
- `chore:` Maintenance

Example: `feat: add user profile page`
