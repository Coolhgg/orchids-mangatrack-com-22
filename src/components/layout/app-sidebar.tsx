"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpen,
  Compass,
  Layers,
  Settings,
  Trophy,
  Users,
  Bell,
  LogOut,
  User,
  ChevronUp,
  Flame,
  AlertCircle,
  Search,
  Shield,
  Sparkles,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { XpCompactDisplay } from "@/components/ui/xp-dashboard"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { logout } from "@/app/auth/auth-actions"

interface CurrentUser {
  id: string
  username: string
  email: string
  avatar_url: string | null
  level: number
  xp: number
  streak_days: number
  _synced?: boolean
  _warning?: string
}

const data = {
  navMain: [
    {
      title: "Library",
      url: "/library",
      icon: BookOpen,
    },
    {
      title: "Browse",
      url: "/browse",
      icon: Search,
    },
    {
      title: "Discover",
      url: "/discover",
      icon: Compass,
    },
    {
      title: "Feed",
      url: "/feed",
      icon: Layers,
    },
    {
      title: "Progress",
      url: "/progress",
      icon: Sparkles,
    },
    {
      title: "Leaderboard",
      url: "/leaderboard",
      icon: Trophy,
    },
    {
      title: "Friends",
      url: "/friends",
      icon: Users,
    },
  ],
}

function UserAvatar({ user, size = "md" }: { user: CurrentUser | null; size?: "sm" | "md" | "lg" }) {
  const sizeClasses = {
    sm: "size-6 text-xs",
    md: "size-8 text-sm",
    lg: "size-10 text-base",
  }

  if (!user) {
    return <Skeleton className={`${sizeClasses[size]} rounded-full`} />
  }

  if (user.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.username}
        className={`${sizeClasses[size]} rounded-full object-cover`}
      />
    )
  }

  return (
    <div className={`${sizeClasses[size]} rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center font-bold text-zinc-600 dark:text-zinc-400`}>
      {user.username?.[0]?.toUpperCase() || "U"}
    </div>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch("/api/users/me")
        
        if (res.status === 401) {
          // User is not authenticated - this is expected on public pages
          setUser(null)
          setError(null)
          return
        }
        
        if (res.status === 503) {
          // Database temporarily unavailable
          setError("Database unavailable")
          return
        }
        
        if (!res.ok) {
          setError("Failed to load user")
          return
        }
        
        const data = await res.json()
        
        // Check if this is a degraded response
        if (data._synced === false) {
          console.warn("User data not synced:", data._warning)
        }
        
        setUser(data)
        setError(null)
      } catch (err) {
        console.error("Failed to fetch user:", err)
        setError("Connection error")
      } finally {
        setLoading(false)
      }
    }
    fetchUser()
  }, [])

  const isProfileActive = mounted && pathname.startsWith("/users/") && user && pathname.includes(user.username)

  return (
    <Sidebar collapsible="icon" {...props} className="border-r border-zinc-200 dark:border-zinc-800">
      <SidebarHeader className="h-16 flex items-center px-4">
          <Link href="/library" className="flex items-center gap-2 font-bold text-xl tracking-tighter">
            <div className="size-8 bg-zinc-900 dark:bg-zinc-50 rounded-lg flex items-center justify-center text-zinc-50 dark:text-zinc-900">
              M
            </div>
            <span className="group-data-[collapsible=icon]:hidden">
              {mounted ? "MangaTrack" : ""}
            </span>
          </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
              {data.navMain.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={mounted && pathname === item.url}
                    tooltip={item.title}
                    className="hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Link href={item.url}>
                      <item.icon className="size-5" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
        </SidebarGroup>
{/* XP Progress Widget */}
          {mounted && user && (
            <SidebarGroup className="group-data-[collapsible=icon]:hidden px-2">
              <SidebarGroupLabel>XP Progress</SidebarGroupLabel>
              <SidebarGroupContent>
                <XpCompactDisplay />
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          <SidebarGroup className="mt-auto">
            <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
                {/* Profile Link */}
                <SidebarMenuItem>
                  {loading ? (
                    <SidebarMenuButton
                      tooltip="Profile"
                      className="hover:bg-zinc-100 dark:hover:bg-zinc-800 opacity-50 cursor-not-allowed"
                      disabled
                    >
                      <User className="size-5" />
                      <span>Profile</span>
                    </SidebarMenuButton>
                  ) : user ? (
                    <SidebarMenuButton
                      asChild
                      isActive={isProfileActive ?? false}
                      tooltip="Profile"
                      className="hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Link href={`/users/${user.username}`}>
                        <User className="size-5" />
                        <span>Profile</span>
                      </Link>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton
                      asChild
                      tooltip="Profile"
                      className="hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Link href="/settings">
                        <User className="size-5" />
                        <span>Profile</span>
                      </Link>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              {/* Notifications */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={mounted && pathname === "/notifications"}
                    tooltip="Notifications"
                    className="hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Link href="/notifications">
                      <Bell className="size-5" />
                      <span>Notifications</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {/* Safe Browsing */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={mounted && pathname === "/settings/safe-browsing"}
                      tooltip="Safe Browsing"
                      className="hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Link href="/settings/safe-browsing">
                        <Shield className="size-5" />
                        <span>Safe Browsing</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {/* Settings */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={mounted && pathname === "/settings"}
                      tooltip="Settings"
                      className="hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Link href="/settings">
                        <Settings className="size-5" />
                        <span>Settings</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
              </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
        <SidebarFooter className="border-t border-zinc-200 dark:border-zinc-800">
          <SidebarMenu>
            <SidebarMenuItem>
              {mounted ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-zinc-800"
                  >
                    <UserAvatar user={user} size="md" />
                      <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                        {loading ? (
                          <>
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-3 w-16 mt-1" />
                          </>
                        ) : error ? (
                        <span className="truncate text-amber-500 flex items-center gap-1">
                          <AlertCircle className="size-3" />
                          {error}
                        </span>
                      ) : user ? (
                        <>
                          <span className="truncate font-semibold">{user.username}</span>
                          <span className="truncate text-xs text-zinc-500">
                            Level {user.level}
                            {user._synced === false && " (syncing...)"}
                          </span>
                        </>
                      ) : (
                        <span className="truncate text-zinc-500">Not signed in</span>
                      )}
                    </div>
                    <ChevronUp className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-xl"
                  side="top"
                  align="start"
                  sideOffset={4}
                >
                  {user && (
                    <>
                      <DropdownMenuLabel className="p-0 font-normal">
                        <div className="flex items-center gap-3 px-2 py-3 text-left">
                          <UserAvatar user={user} size="lg" />
                          <div className="grid flex-1 text-left text-sm leading-tight">
                            <span className="truncate font-semibold">{user.username}</span>
                            <span className="truncate text-xs text-zinc-500">{user.email}</span>
                          </div>
                        </div>
                      </DropdownMenuLabel>
                      {user._synced === false && (
                        <div className="px-2 pb-2">
                          <div className="flex items-center gap-1 text-xs text-amber-500">
                            <AlertCircle className="size-3" />
                            <span>Some data may be unavailable</span>
                          </div>
                        </div>
                      )}
                      <div className="px-2 pb-2">
                        <div className="flex items-center gap-4 text-xs text-zinc-500">
                          <span className="flex items-center gap-1">
                            <Trophy className="size-3 text-amber-500" />
                            Level {user.level}
                          </span>
                          <span className="flex items-center gap-1">
                            <Flame className="size-3 text-orange-500" />
                            {user.streak_days} day streak
                          </span>
                        </div>
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link href={`/users/${user.username}`} className="cursor-pointer">
                          <User className="size-4 mr-2" />
                          View Profile
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/settings" className="cursor-pointer">
                          <Settings className="size-4 mr-2" />
                          Settings
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem asChild>
                    <form action={logout} className="w-full">
                      <button type="submit" className="flex w-full items-center text-red-600 dark:text-red-400">
                        <LogOut className="size-4 mr-2" />
                        Log out
                      </button>
                    </form>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              ) : (
                <SidebarMenuButton
                  size="lg"
                  className="cursor-default"
                >
                  <Skeleton className="size-8 rounded-full" />
                  <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16 mt-1" />
                  </div>
                  <ChevronUp className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
