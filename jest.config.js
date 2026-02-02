/**
 * Jest Configuration
 * 
 * Bug 91 Fix: Test environment mirrors production flags
 */
const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^uuid$': '<rootDir>/node_modules/uuid/dist/cjs/index.js',
    // Mock BullMQ and its dependencies to avoid ESM issues in tests
    '^bullmq$': '<rootDir>/__mocks__/bullmq.ts',
    '^msgpackr$': '<rootDir>/__mocks__/msgpackr.ts',
    '^p-queue$': '<rootDir>/__mocks__/p-queue.ts',
  },
  testMatch: ['**/__tests__/**/*.[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/', '/load-tests/'],
  transformIgnorePatterns: [
    'node_modules/(?!(bullmq|msgpackr|@msgpack/msgpack|ioredis|lodash-es|uuid|p-queue|p-timeout|eventemitter3)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/types.ts',
  ],
  testEnvironmentOptions: {
    customExportConditions: [''],
  },
  globals: {
    __TEST_RATE_LIMITING__: true,
    __TEST_CSRF_PROTECTION__: true,
    __TEST_MEMORY_GUARDS__: true,
  },
}

module.exports = createJestConfig(customJestConfig)
