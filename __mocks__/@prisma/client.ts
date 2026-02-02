interface DecimalLike {
  toString(): string
  toNumber(): number
}

class MockDecimal implements DecimalLike {
  private value: number

  constructor(val: string | number) {
    this.value = typeof val === 'string' ? parseFloat(val) || 0 : val
  }

  toString(): string {
    return this.value.toString()
  }

  toNumber(): number {
    return this.value
  }
}

export const Prisma = {
  Decimal: MockDecimal,
  TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable',
  },
}

type MockFn = jest.Mock

interface MockPrismaModel {
  findUnique: MockFn
  findFirst: MockFn
  findMany: MockFn
  create: MockFn
  createMany: MockFn
  update: MockFn
  updateMany: MockFn
  upsert: MockFn
  delete: MockFn
  deleteMany: MockFn
  count: MockFn
  aggregate: MockFn
  groupBy: MockFn
}

const createMockModel = (): MockPrismaModel => ({
  findUnique: jest.fn().mockResolvedValue(null),
  findFirst: jest.fn().mockResolvedValue(null),
  findMany: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockImplementation((args: { data?: Record<string, unknown> }) =>
    Promise.resolve({ id: 'mock-id', ...args?.data })
  ),
  createMany: jest.fn().mockResolvedValue({ count: 0 }),
  update: jest.fn().mockImplementation((args: { where?: { id?: string }; data?: Record<string, unknown> }) =>
    Promise.resolve({ id: args?.where?.id, ...args?.data })
  ),
  updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  upsert: jest.fn().mockImplementation((args: { create?: Record<string, unknown> }) =>
    Promise.resolve({ id: 'mock-id', ...args?.create })
  ),
  delete: jest.fn().mockResolvedValue({}),
  deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  count: jest.fn().mockResolvedValue(0),
  aggregate: jest.fn().mockResolvedValue({}),
  groupBy: jest.fn().mockResolvedValue([]),
})

interface PrismaMock {
  $connect: jest.Mock
  $disconnect: jest.Mock
  $transaction: jest.Mock
  $executeRaw: jest.Mock
  $executeRawUnsafe: jest.Mock
  $queryRaw: jest.Mock
  $queryRawUnsafe: jest.Mock
  series: MockPrismaModel
  user: MockPrismaModel
  chapter: MockPrismaModel
  chapterSource: MockPrismaModel
  seriesSource: MockPrismaModel
  libraryEntry: MockPrismaModel
  feedEntry: MockPrismaModel
  notification: MockPrismaModel
  userChapterReadV2: MockPrismaModel
  auditLog: MockPrismaModel
  workerFailure: MockPrismaModel
  queryStats: MockPrismaModel
  legacyChapter: MockPrismaModel
  userFollow: MockPrismaModel
}

export const prismaMock: PrismaMock = {
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $transaction: jest.fn((fn: unknown) => {
    if (typeof fn === 'function') {
      return (fn as (client: PrismaMock) => unknown)(prismaMock)
    }
    return Promise.all(fn as Promise<unknown>[])
  }),
  $executeRaw: jest.fn(),
  $executeRawUnsafe: jest.fn(),
  $queryRaw: jest.fn(),
  $queryRawUnsafe: jest.fn(),
  series: createMockModel(),
  user: createMockModel(),
  chapter: createMockModel(),
  chapterSource: createMockModel(),
  seriesSource: createMockModel(),
  libraryEntry: createMockModel(),
  feedEntry: createMockModel(),
  notification: createMockModel(),
  userChapterReadV2: createMockModel(),
  auditLog: createMockModel(),
  workerFailure: createMockModel(),
  queryStats: createMockModel(),
  legacyChapter: createMockModel(),
  userFollow: createMockModel(),
}

export const PrismaClient = jest.fn().mockImplementation(() => prismaMock)
