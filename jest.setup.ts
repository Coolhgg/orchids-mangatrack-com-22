import '@testing-library/jest-dom'
import { config } from 'dotenv'
import { randomUUID } from 'crypto'

config()

// Polyfill crypto.randomUUID for Jest environment
if (typeof global.crypto === 'undefined') {
  Object.defineProperty(global, 'crypto', {
    value: { randomUUID },
  })
} else if (typeof global.crypto.randomUUID === 'undefined') {
  Object.defineProperty(global.crypto, 'randomUUID', {
    value: randomUUID,
  })
}

// Polyfill for NextRequest/NextResponse in Jest environment
// NextRequest relies on Web API Headers which jsdom doesn't fully support
class MockHeaders implements Headers {
  private _headers: Map<string, string> = new Map()

  constructor(init?: HeadersInit) {
    if (init) {
      if (init instanceof MockHeaders || init instanceof Headers) {
        init.forEach((value, key) => this._headers.set(key.toLowerCase(), value))
      } else if (Array.isArray(init)) {
        init.forEach(([key, value]) => this._headers.set(key.toLowerCase(), value))
      } else if (typeof init === 'object') {
        Object.entries(init).forEach(([key, value]) => this._headers.set(key.toLowerCase(), value))
      }
    }
  }

  append(name: string, value: string): void {
    const key = name.toLowerCase()
    const existing = this._headers.get(key)
    this._headers.set(key, existing ? `${existing}, ${value}` : value)
  }

  delete(name: string): void {
    this._headers.delete(name.toLowerCase())
  }

  get(name: string): string | null {
    return this._headers.get(name.toLowerCase()) ?? null
  }

  has(name: string): boolean {
    return this._headers.has(name.toLowerCase())
  }

  set(name: string, value: string): void {
    this._headers.set(name.toLowerCase(), value)
  }

  forEach(callbackfn: (value: string, key: string, parent: Headers) => void): void {
    this._headers.forEach((value, key) => callbackfn(value, key, this))
  }

  entries(): HeadersIterator<[string, string]> {
    return this._headers.entries() as HeadersIterator<[string, string]>
  }

  keys(): HeadersIterator<string> {
    return this._headers.keys() as HeadersIterator<string>
  }

  values(): HeadersIterator<string> {
    return this._headers.values() as HeadersIterator<string>
  }

  [Symbol.iterator](): HeadersIterator<[string, string]> {
    return this._headers.entries() as HeadersIterator<[string, string]>
  }

  getSetCookie(): string[] {
    const cookie = this._headers.get('set-cookie')
    return cookie ? [cookie] : []
  }
}

// Mock NextRequest class that works in Jest
class MockNextRequest {
  public url: string
  public method: string
  public headers: MockHeaders
  public nextUrl: URL
  private _body: string | null = null

  constructor(input: string | URL, init?: RequestInit) {
    this.url = typeof input === 'string' ? input : input.toString()
    this.method = init?.method || 'GET'
    this.headers = new MockHeaders(init?.headers)
    this.nextUrl = new URL(this.url)
    if (init?.body) {
      this._body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
    }
  }

  async json(): Promise<unknown> {
    if (this._body) {
      return JSON.parse(this._body)
    }
    return {}
  }

  async text(): Promise<string> {
    return this._body || ''
  }

  clone(): MockNextRequest {
    return new MockNextRequest(this.url, {
      method: this.method,
      headers: this.headers as unknown as HeadersInit,
      body: this._body || undefined,
    })
  }

  get cookies() {
    return {
      get: (name: string) => {
        const cookieHeader = this.headers.get('cookie')
        if (!cookieHeader) return undefined
        const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`))
        return match ? { name, value: match[1] } : undefined
      },
      getAll: () => [],
      has: () => false,
      set: () => {},
      delete: () => {},
    }
  }

  get geo() {
    return {}
  }

  get ip() {
    return this.headers.get('x-forwarded-for') || '127.0.0.1'
  }
}

// Mock NextResponse class
class MockNextResponse {
  public status: number
  public headers: MockHeaders
  private _body: unknown

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this._body = body
    this.status = init?.status || 200
    this.headers = new MockHeaders(init?.headers)
  }

  async json(): Promise<unknown> {
    if (typeof this._body === 'string') {
      return JSON.parse(this._body)
    }
    return this._body
  }

  async text(): Promise<string> {
    if (typeof this._body === 'string') {
      return this._body
    }
    return JSON.stringify(this._body)
  }

  static json(data: unknown, init?: ResponseInit): MockNextResponse {
    const response = new MockNextResponse(JSON.stringify(data), init)
    response.headers.set('content-type', 'application/json')
    return response
  }

  static redirect(url: string | URL, status = 307): MockNextResponse {
    const response = new MockNextResponse(null, { status })
    response.headers.set('location', typeof url === 'string' ? url : url.toString())
    return response
  }

  static next(): MockNextResponse {
    return new MockNextResponse(null, { status: 200 })
  }
}

// Override the global NextRequest/NextResponse with mocks
jest.mock('next/server', () => ({
  NextRequest: MockNextRequest,
  NextResponse: MockNextResponse,
}))

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

const createMockPrismaModel = (defaults: Partial<MockPrismaModel> = {}): MockPrismaModel => ({
  findUnique: jest.fn().mockResolvedValue(null),
  findFirst: jest.fn().mockResolvedValue(null),
  findMany: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockImplementation((args: { data?: Record<string, unknown> }) => Promise.resolve({ id: 'mock-id', ...args?.data })),
  createMany: jest.fn().mockResolvedValue({ count: 0 }),
  update: jest.fn().mockImplementation((args: { where?: { id?: string }; data?: Record<string, unknown> }) => Promise.resolve({ id: args?.where?.id, ...args?.data })),
  updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  upsert: jest.fn().mockImplementation((args: { create?: Record<string, unknown> }) => Promise.resolve({ id: 'mock-id', ...args?.create })),
  delete: jest.fn().mockResolvedValue({}),
  deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  count: jest.fn().mockResolvedValue(0),
  aggregate: jest.fn().mockResolvedValue({}),
  groupBy: jest.fn().mockResolvedValue([]),
  ...defaults,
})

const SOFT_DELETE_MODELS = ['User', 'Series', 'Chapter', 'LibraryEntry']

const buildSoftDeleteSafeQuery = (baseQuery: string, tableName: string): string => {
  const isSoftDeleteModel = SOFT_DELETE_MODELS.some(
    model => tableName.toLowerCase().includes(model.toLowerCase())
  )
  
  if (!isSoftDeleteModel) {
    return baseQuery
  }
  
  const upperQuery = baseQuery.toUpperCase()
  const hasWhere = upperQuery.includes('WHERE')
  const hasDeletedAtFilter = baseQuery.toLowerCase().includes('deleted_at')
  
  if (hasDeletedAtFilter) {
    return baseQuery
  }
  
  if (hasWhere) {
    const whereIndex = upperQuery.indexOf('WHERE')
    const afterWhere = whereIndex + 6
    return `${baseQuery.slice(0, afterWhere)} ${tableName}.deleted_at IS NULL AND ${baseQuery.slice(afterWhere)}`
  } else {
    const orderByIndex = upperQuery.indexOf('ORDER BY')
    const limitIndex = upperQuery.indexOf('LIMIT')
    const groupByIndex = upperQuery.indexOf('GROUP BY')
    
    const insertPoint = Math.min(
      orderByIndex > -1 ? orderByIndex : baseQuery.length,
      limitIndex > -1 ? limitIndex : baseQuery.length,
      groupByIndex > -1 ? groupByIndex : baseQuery.length
    )
    
    return `${baseQuery.slice(0, insertPoint)} WHERE ${tableName}.deleted_at IS NULL ${baseQuery.slice(insertPoint)}`
  }
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: unknown) => {
      if (typeof fn === 'function') {
        return fn({
          workerFailure: createMockPrismaModel(),
          auditLog: createMockPrismaModel(),
          series: createMockPrismaModel(),
          user: createMockPrismaModel(),
          chapter: createMockPrismaModel(),
          chapterSource: createMockPrismaModel(),
          seriesSource: createMockPrismaModel(),
          legacyChapter: createMockPrismaModel(),
          feedEntry: createMockPrismaModel(),
          libraryEntry: createMockPrismaModel(),
          notification: createMockPrismaModel(),
          queryStats: createMockPrismaModel(),
          userChapterReadV2: createMockPrismaModel(),
          follow: createMockPrismaModel(),
          readingStreak: createMockPrismaModel(),
          seasonalXp: createMockPrismaModel(),
          achievement: createMockPrismaModel(),
          userAchievement: createMockPrismaModel(),
          userSourcePriority: createMockPrismaModel(),
            userContentFilter: createMockPrismaModel(),
            $executeRaw: jest.fn(),
            $executeRawUnsafe: jest.fn(),
            $queryRaw: jest.fn(),
            $queryRawUnsafe: jest.fn(),
          })
      }
      return Promise.all(fn as Promise<unknown>[])
    }),
    workerFailure: createMockPrismaModel(),
    auditLog: createMockPrismaModel(),
    series: createMockPrismaModel(),
    user: createMockPrismaModel(),
    chapter: createMockPrismaModel(),
    chapterSource: createMockPrismaModel(),
    seriesSource: createMockPrismaModel(),
    legacyChapter: createMockPrismaModel(),
    feedEntry: createMockPrismaModel(),
    libraryEntry: createMockPrismaModel(),
    notification: createMockPrismaModel(),
    queryStats: createMockPrismaModel(),
    userChapterReadV2: createMockPrismaModel(),
    follow: createMockPrismaModel(),
    readingStreak: createMockPrismaModel(),
    seasonalXp: createMockPrismaModel(),
    achievement: createMockPrismaModel(),
    userAchievement: createMockPrismaModel(),
    userSourcePriority: createMockPrismaModel(),
    userContentFilter: createMockPrismaModel(),
      $executeRaw: jest.fn(),
      $executeRawUnsafe: jest.fn(),
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn(),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      $connect: jest.fn().mockResolvedValue(undefined),
      $extends: jest.fn().mockReturnThis(),
    },
    withRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
  isTransientError: jest.fn().mockReturnValue(false),
  buildSoftDeleteSafeQuery,
}))

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
} else if (process.env.NODE_ENV === 'test') {
  process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock'
}
if (process.env.TEST_DIRECT_URL) {
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL
}
if (process.env.TEST_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.TEST_SUPABASE_URL
}
if (process.env.TEST_SUPABASE_ANON_KEY) {
  process.env.SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY
}
if (process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY
}

global.fetch = jest.fn()
global.Request = jest.fn() as unknown as typeof Request
global.Response = jest.fn() as unknown as typeof Response

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
  }),
  usePathname: () => '',
}))
