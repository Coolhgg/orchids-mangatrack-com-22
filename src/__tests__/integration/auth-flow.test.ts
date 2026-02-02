import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Home from '@/app/page'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}))

// Mock Supabase server client
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

describe('Home Page Onboarding Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should redirect to /onboarding if logged in but no username', async () => {
    const mockUser = {
      id: 'user-1',
      user_metadata: {},
      app_metadata: {},
    }

    ;(createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: mockUser } }),
      },
    })

    await Home()

    expect(redirect).toHaveBeenCalledWith('/onboarding')
  })

  it('should redirect to /library if logged in and has username in user_metadata', async () => {
    const mockUser = {
      id: 'user-1',
      user_metadata: { username: 'testuser' },
      app_metadata: {},
    }

    ;(createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: mockUser } }),
      },
    })

    await Home()

    expect(redirect).toHaveBeenCalledWith('/library')
  })

  it('should redirect to /library if logged in and has username in app_metadata', async () => {
    const mockUser = {
      id: 'user-1',
      user_metadata: {},
      app_metadata: { username: 'testuser' },
    }

    ;(createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: mockUser } }),
      },
    })

    await Home()

    expect(redirect).toHaveBeenCalledWith('/library')
  })

  it('should NOT redirect if not logged in', async () => {
    ;(createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      },
    })

    const result = await Home()

    expect(redirect).not.toHaveBeenCalled()
    expect(result).toBeDefined()
  })
})
