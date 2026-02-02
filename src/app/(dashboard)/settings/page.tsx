"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { Bell, Lock, Download, User, Loader2, Shield, Eye, EyeOff, Mail, Smartphone, FileText, Upload, HelpCircle } from "lucide-react"
import { CSVImport } from "@/components/library/CSVImport"
import { PlatformImport } from "@/components/library/PlatformImport"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { SourcePrioritySettings } from "@/components/settings/SourcePrioritySettings"

interface UserProfile {
  id: string
  username: string
  email: string
  avatar_url: string | null
  bio: string | null
  notification_settings: {
    email_new_chapters?: boolean
    email_follows?: boolean
    email_achievements?: boolean
    push_enabled?: boolean
  }
  privacy_settings: {
    library_public?: boolean
    activity_public?: boolean
    profile_searchable?: boolean
  }
  default_source: string | null
  notification_digest: 'immediate' | 'short' | 'hourly' | 'daily'
}

const SUPPORTED_SOURCES = [
  { value: "mangadex", label: "MangaDex" },
  { value: "mangapark", label: "MangaPark" },
  { value: "mangasee", label: "MangaSee" },
  { value: "mangakakalot", label: "MangaKakalot" },
]

// Bio max length for security
const MAX_BIO_LENGTH = 500
const MAX_URL_LENGTH = 500

function SettingsSkeleton() {
  return (
    <div className="p-6 md:p-12 space-y-12 max-w-2xl mx-auto pb-24">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-24 w-full rounded-3xl" />
        <Skeleton className="h-48 w-full rounded-3xl" />
        <Skeleton className="h-48 w-full rounded-3xl" />
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [activeSection, setActiveSection] = useState<"profile" | "notifications" | "privacy">("profile")
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [retrying, setRetrying] = useState(false)
    
    const [formData, setFormData] = useState({

    bio: "",
    avatar_url: "",
    email_new_chapters: true,
    email_follows: true,
    email_achievements: true,
    push_enabled: false,
      library_public: true,
      activity_public: true,
      profile_searchable: true,
      default_source: "none",
      notification_digest: "immediate" as const,
    })


  const router = useRouter()
  
  // Create supabase client once using useMemo
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch('/api/users/me')
        if (!res.ok) {
          if (res.status === 401) {
            router.push('/login')
            return
          }
          throw new Error('Failed to load profile')
        }
        
        const data = await res.json()
        setProfile(data)
        setFormData({
          bio: data.bio || "",
          avatar_url: data.avatar_url || "",
          email_new_chapters: data.notification_settings?.email_new_chapters ?? true,
          email_follows: data.notification_settings?.email_follows ?? true,
          email_achievements: data.notification_settings?.email_achievements ?? true,
          push_enabled: data.notification_settings?.push_enabled ?? false,
              library_public: data.privacy_settings?.library_public ?? true,
              activity_public: data.privacy_settings?.activity_public ?? true,
              profile_searchable: data.privacy_settings?.profile_searchable ?? true,
              default_source: data.default_source || "none",
              notification_digest: data.notification_digest || "immediate",
            })

      } catch (err) {
        toast.error('Failed to load settings')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadProfile()
  }, [router])

  // Sanitize bio input - remove HTML tags and limit length
  const sanitizeBio = useCallback((input: string): string => {
    return input
      .slice(0, MAX_BIO_LENGTH)
      .replace(/<[^>]*>/g, '') // Remove HTML tags
  }, [])

  // Validate URL format
  const isValidUrl = useCallback((url: string): boolean => {
    if (!url) return true // Empty is valid
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol)
    } catch {
      return false
    }
  }, [])

  const handleBioChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const sanitized = sanitizeBio(e.target.value)
    setFormData(f => ({ ...f, bio: sanitized }))
  }, [sanitizeBio])

  const handleAvatarUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value.slice(0, MAX_URL_LENGTH)
    setFormData(f => ({ ...f, avatar_url: url }))
  }, [])

  async function handleSaveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    
    // Validate avatar URL
    if (formData.avatar_url && !isValidUrl(formData.avatar_url)) {
      toast.error('Invalid avatar URL format')
      return
    }

    setSaving(true)
    
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bio: formData.bio,
          avatar_url: formData.avatar_url || "",
          notification_settings: {
            email_new_chapters: formData.email_new_chapters,
            email_follows: formData.email_follows,
            email_achievements: formData.email_achievements,
            push_enabled: formData.push_enabled,
          },
          privacy_settings: {
            library_public: formData.library_public,
            activity_public: formData.activity_public,
            profile_searchable: formData.profile_searchable,
          },
            default_source: formData.default_source === "none" ? null : formData.default_source,
            notification_digest: formData.notification_digest
          })

      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update settings')
      }

      const updatedUser = await res.json()
      setProfile(updatedUser)
      toast.success('Settings saved!')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      const res = await fetch('/api/users/me', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete account')
      }
      
      toast.success('Account deleted successfully')
      await supabase.auth.signOut()
      router.push('/')
    } catch (err: any) {
      toast.error(err.message)
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  async function handleExportData() {
    setExporting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        toast.error('Not authenticated')
        return
      }

      const [libraryRes, activitiesRes, achievementsRes] = await Promise.all([
        supabase.from('library_entries').select('*, series(title, type)').eq('user_id', user.id),
        supabase.from('activities').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('user_achievements').select('*, achievements(name, description)').eq('user_id', user.id),
      ])

      const exportData = {
        exported_at: new Date().toISOString(),
        user: {
          username: profile?.username,
          email: profile?.email,
          bio: profile?.bio,
          created_at: profile?.id,
        },
        library: libraryRes.data || [],
        activities: activitiesRes.data || [],
        achievements: achievementsRes.data || [],
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mangatrack-export-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success('Data exported successfully!')
    } catch (error) {
      toast.error('Failed to export data')
    } finally {
      setExporting(false)
    }
  }

    async function handleRetryFailedMetadata() {
      setRetrying(true)
      try {
        const res = await fetch('/api/library/retry-all-metadata', { method: 'POST' })
        const data = await res.json()
        
        if (!res.ok) throw new Error(data.error || 'Failed to retry metadata')
        
        if (data.count > 0) {
          toast.success(data.message)
        } else {
          toast.info('No failed metadata found to retry')
        }
      } catch (err: any) {
        toast.error(err.message)
      } finally {
        setRetrying(false)
      }
    }

    if (loading) {

    return <SettingsSkeleton />
  }

  if (!profile) return null

  return (
    <div className="p-6 md:p-12 space-y-8 max-w-3xl mx-auto pb-24">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-zinc-500">Manage your profile and account preferences</p>
      </div>

      <div className="flex gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <Button
          variant={activeSection === "profile" ? "default" : "ghost"}
          className="rounded-full"
          onClick={() => setActiveSection("profile")}
        >
          <User className="size-4 mr-2" />
          Profile
        </Button>
        <Button
          variant={activeSection === "notifications" ? "default" : "ghost"}
          className="rounded-full"
          onClick={() => setActiveSection("notifications")}
        >
          <Bell className="size-4 mr-2" />
          Notifications
        </Button>
        <Button
          variant={activeSection === "privacy" ? "default" : "ghost"}
          className="rounded-full"
          onClick={() => setActiveSection("privacy")}
        >
          <Lock className="size-4 mr-2" />
          Privacy
        </Button>
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-8">
        {activeSection === "profile" && (
          <div className="space-y-8">
            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-6">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <User className="size-5 text-zinc-400" />
                Profile Information
              </h2>
              
              <div className="flex items-start gap-6">
                <div className="size-24 rounded-3xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
                  {formData.avatar_url && isValidUrl(formData.avatar_url) ? (
                    <img src={formData.avatar_url} className="h-full w-full object-cover" alt="" />
                  ) : (
                    <span className="text-2xl font-bold text-zinc-300">{profile.username?.[0]?.toUpperCase() || '?'}</span>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <Label htmlFor="avatar_url">Profile Picture URL</Label>
                  <Input 
                    id="avatar_url" 
                    value={formData.avatar_url}
                    onChange={handleAvatarUrlChange}
                    placeholder="https://example.com/avatar.jpg" 
                    className="rounded-xl"
                    maxLength={MAX_URL_LENGTH}
                  />
                  <p className="text-xs text-zinc-500">Enter a URL for your profile picture (HTTPS only)</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input 
                  id="username" 
                  value={profile.username} 
                  disabled 
                  className="bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 rounded-xl"
                />
                <p className="text-xs text-zinc-500">Username cannot be changed at this time.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input 
                  id="email" 
                  value={profile.email} 
                  disabled 
                  className="bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="bio">Bio</Label>
                  <span className="text-xs text-zinc-400">{formData.bio.length}/{MAX_BIO_LENGTH}</span>
                </div>
                  <Textarea 
                    id="bio" 
                    value={formData.bio}
                    onChange={handleBioChange}
                    placeholder="Tell us about your reading taste..." 
                    className="min-h-[120px] rounded-xl"
                    maxLength={MAX_BIO_LENGTH}
                  />
                </div>

                <SourcePrioritySettings />

                <div className="space-y-2">
                  <Label htmlFor="default_source">Default Reading Source</Label>
                  <Select 
                    value={formData.default_source} 
                    onValueChange={(value) => setFormData(f => ({ ...f, default_source: value }))}
                  >
                    <SelectTrigger id="default_source" className="rounded-xl">
                      <SelectValue placeholder="Ask every time (Show dialog)" />
                    </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Ask every time (Show dialog)</SelectItem>
                        {SUPPORTED_SOURCES.map(source => (
                        <SelectItem key={source.value} value={source.value}>
                          {source.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-zinc-500">
                    Preferred source for reading chapters. You can override this for individual series.
                  </p>
                </div>
              </div>
            </div>
          )}

        {activeSection === "notifications" && (
          <div className="space-y-8">
            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-6">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Mail className="size-5 text-zinc-400" />
                Email Notifications
              </h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                  <div className="space-y-0.5">
                    <p className="font-medium text-sm">New Chapter Alerts</p>
                    <p className="text-xs text-zinc-500">Get notified when new chapters are released</p>
                  </div>
                  <Switch 
                    checked={formData.email_new_chapters}
                    onCheckedChange={(checked) => setFormData(f => ({ ...f, email_new_chapters: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                  <div className="space-y-0.5">
                    <p className="font-medium text-sm">New Followers</p>
                    <p className="text-xs text-zinc-500">Get notified when someone follows you</p>
                  </div>
                  <Switch 
                    checked={formData.email_follows}
                    onCheckedChange={(checked) => setFormData(f => ({ ...f, email_follows: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                  <div className="space-y-0.5">
                    <p className="font-medium text-sm">Achievement Unlocked</p>
                    <p className="text-xs text-zinc-500">Get notified when you unlock achievements</p>
                  </div>
                  <Switch 
                    checked={formData.email_achievements}
                    onCheckedChange={(checked) => setFormData(f => ({ ...f, email_achievements: checked }))}
                  />
                  </div>
                </div>
              </div>

              <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-6">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Bell className="size-5 text-zinc-400" />
                  Digest Preferences
                </h2>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="notification_digest">Digest Frequency</Label>
                    <Select 
                      value={formData.notification_digest} 
                      onValueChange={(value: any) => setFormData(f => ({ ...f, notification_digest: value }))}
                    >
                      <SelectTrigger id="notification_digest" className="rounded-xl">
                        <SelectValue placeholder="Select frequency" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="immediate">Immediate (Real-time)</SelectItem>
                        <SelectItem value="short">Short Digest (Every 15 mins)</SelectItem>
                        <SelectItem value="hourly">Hourly Digest</SelectItem>
                        <SelectItem value="daily">Daily Summary</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-zinc-500">
                      Choose how often you want to be notified. Digests group multiple updates into a single notification to reduce noise.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-6">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Smartphone className="size-5 text-zinc-400" />
                  Push Notifications
                </h2>

              
              <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                <div className="space-y-0.5">
                  <p className="font-medium text-sm">Enable Push Notifications</p>
                  <p className="text-xs text-zinc-500">Receive instant updates on your device</p>
                </div>
                <Switch 
                  checked={formData.push_enabled}
                  onCheckedChange={(checked) => setFormData(f => ({ ...f, push_enabled: checked }))}
                />
              </div>
            </div>
          </div>
        )}

        {activeSection === "privacy" && (
          <div className="space-y-8">
            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-6">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Shield className="size-5 text-zinc-400" />
                Privacy Controls
              </h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    {formData.library_public ? <Eye className="size-5 text-green-500" /> : <EyeOff className="size-5 text-zinc-400" />}
                    <div className="space-y-0.5">
                      <p className="font-medium text-sm">Public Library</p>
                      <p className="text-xs text-zinc-500">Allow others to see what you're reading</p>
                    </div>
                  </div>
                  <Switch 
                    checked={formData.library_public}
                    onCheckedChange={(checked) => setFormData(f => ({ ...f, library_public: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    {formData.activity_public ? <Eye className="size-5 text-green-500" /> : <EyeOff className="size-5 text-zinc-400" />}
                    <div className="space-y-0.5">
                      <p className="font-medium text-sm">Public Activity</p>
                      <p className="text-xs text-zinc-500">Show your reading activity on your profile</p>
                    </div>
                  </div>
                  <Switch 
                    checked={formData.activity_public}
                    onCheckedChange={(checked) => setFormData(f => ({ ...f, activity_public: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    {formData.profile_searchable ? <Eye className="size-5 text-green-500" /> : <EyeOff className="size-5 text-zinc-400" />}
                    <div className="space-y-0.5">
                      <p className="font-medium text-sm">Searchable Profile</p>
                      <p className="text-xs text-zinc-500">Allow others to find you by username</p>
                    </div>
                  </div>
                  <Switch 
                    checked={formData.profile_searchable}
                    onCheckedChange={(checked) => setFormData(f => ({ ...f, profile_searchable: checked }))}
                  />
                </div>
              </div>
            </div>

            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-6">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Download className="size-5 text-zinc-400" />
                Data Management
              </h2>
              
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                    <div className="space-y-0.5">
                      <p className="font-medium text-sm">Export Your Data</p>
                      <p className="text-xs text-zinc-500">Download all your library and activity data as JSON</p>
                    </div>
                      <Button 
                        type="button"
                        variant="outline" 
                        className="rounded-full"
                        onClick={handleExportData}
                        disabled={exporting}
                      >
                        {exporting ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <Download className="size-4 mr-2" />
                        )}
                        Export
                      </Button>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800">
                      <div className="space-y-0.5">
                        <p className="font-medium text-sm">Retry Failed Metadata</p>
                        <p className="text-xs text-zinc-500">Manually trigger a retry for entries that failed to enrich</p>
                      </div>
                      <Button 
                        type="button"
                        variant="outline" 
                        className="rounded-full"
                        onClick={handleRetryFailedMetadata}
                        disabled={retrying}
                      >
                        {retrying ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <HelpCircle className="size-4 mr-2" />
                        )}
                        Retry All
                      </Button>
                    </div>


                  <div className="p-6 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <p className="font-medium text-sm">Import from CSV</p>
                        <p className="text-xs text-zinc-500">Upload a CSV file to import your reading progress</p>
                      </div>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8 rounded-full">
                              <HelpCircle className="size-4 text-zinc-400" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Required columns: title, status, progress</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <CSVImport />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-6 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 space-y-4">
                      <PlatformImport platform="AniList" />
                    </div>
                    <div className="p-6 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 space-y-4">
                      <PlatformImport platform="MyAnimeList" />
                    </div>
                  </div>
                </div>
            </div>

          </div>
        )}

        <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-4">
          <Button 
            type="submit" 
            disabled={saving}
            className="bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 rounded-full px-8 font-bold"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </form>

      <div className="pt-12 space-y-6 border-t border-zinc-100 dark:border-zinc-800">
        <h2 className="text-xl font-bold text-red-600">Danger Zone</h2>
        <div className="p-6 rounded-3xl border border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-950/10 flex items-center justify-between">
          <div>
            <p className="font-bold text-sm">Delete Account</p>
            <p className="text-xs text-zinc-500">Permanently remove your account and all your tracking data.</p>
          </div>
          {showDeleteConfirm ? (
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="rounded-full"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                size="sm" 
                className="rounded-full font-bold"
                onClick={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Confirm Delete'}
              </Button>
            </div>
          ) : (
            <Button 
              variant="destructive" 
              className="rounded-full px-6 font-bold"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
