import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { PATCH as updateProfile } from "@/app/api/users/me/route"
import Home from "@/app/page"
import { redirect } from "next/navigation"

// Mock next/navigation
jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}))

// Mock Supabase server client
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
}))

describe("Onboarding Integration Flow", () => {
  const mockUserId = "550e8400-e29b-41d4-a716-446655440001"
  const mockUserEmail = "onboarding@example.com"

  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: mockUserId,
              email: mockUserEmail,
              user_metadata: {},
              app_metadata: {},
            },
          },
          error: null,
        }),
      },
    })
  })

  describe("Landing Page Redirection", () => {
    it("should redirect to /onboarding when user is authenticated but has no username", async () => {
      await Home()
      expect(redirect).toHaveBeenCalledWith("/onboarding")
    })

    it("should redirect to /library when user has a username", async () => {
      ;(createClient as jest.Mock).mockResolvedValue({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: {
              user: {
                id: mockUserId,
                email: mockUserEmail,
                user_metadata: { username: "testuser" },
                app_metadata: {},
              },
            },
            error: null,
          }),
        },
      })

      await Home()
      expect(redirect).toHaveBeenCalledWith("/library")
    })
  })

  describe("Username Selection API", () => {
    it("should allow a user to set their initial username", async () => {
      const request = new NextRequest("http://localhost/api/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Origin": "http://localhost",
          "Host": "localhost",
        },
        body: JSON.stringify({ username: "new_unique_user" }),
      })

      // Mock prisma calls
      const mockPrismaTx = {
        user: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue({
            id: mockUserId,
            username: "new_unique_user",
          }),
        },
        $executeRaw: jest.fn().mockResolvedValue(1),
      }
      ;(prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(mockPrismaTx))

      const response = await updateProfile(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.username).toBe("new_unique_user")
      expect(mockPrismaTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUserId },
          data: expect.objectContaining({ username: "new_unique_user" }),
        })
      )
    })

    it("should reject duplicate usernames with 409 Conflict", async () => {
      const request = new NextRequest("http://localhost/api/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Origin": "http://localhost",
          "Host": "localhost",
        },
        body: JSON.stringify({ username: "existing_user" }),
      })

      const mockPrismaTx = {
        user: {
          findFirst: jest.fn().mockResolvedValue({ id: "other-id", username: "existing_user" }),
        },
        $executeRaw: jest.fn().mockResolvedValue(1),
      }
      ;(prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(mockPrismaTx))

      const response = await updateProfile(request)
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.error).toMatch(/already taken/i)
    })

    it("should reject invalid username formats", async () => {
      const request = new NextRequest("http://localhost/api/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Origin": "http://localhost",
          "Host": "localhost",
        },
        body: JSON.stringify({ username: "a" }), // Too short
      })

      const response = await updateProfile(request)
      expect(response.status).toBe(400)
    })
  })
})
