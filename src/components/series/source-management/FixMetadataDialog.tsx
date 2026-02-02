"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { SourceUrlInput } from "./SourceUrlInput"
import { CANONICAL_HOSTS } from "@/lib/constants/sources"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

interface FixMetadataDialogProps {
  seriesId: string;
  seriesTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FixMetadataDialog({
  seriesId,
  seriesTitle,
  open,
  onOpenChange
}: FixMetadataDialogProps) {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const validateUrl = (value: string) => {
    if (!value) return "URL is required"
    try {
      const hostname = new URL(value).hostname.replace('www.', '')
      const isSupported = CANONICAL_HOSTS.some(host => hostname.includes(host))
      if (!isSupported) return "Accepted: MangaDex, AniList, MyAnimeList"
      return null
    } catch {
      return "Invalid URL format"
    }
  }

  const handleSubmit = async () => {
    const validationError = validateUrl(url)
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/series/${seriesId}/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical_url: url })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || "Failed to update metadata")
      }

      toast.success("Metadata update triggered!")
      onOpenChange(false)
      setUrl("")
      router.refresh()
    } catch (err: any) {
      setError(err.message)
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Fix metadata</DialogTitle>
          <DialogDescription>
            Link to a canonical source to improve series info (title, description, cover, genres).
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <SourceUrlInput
            value={url}
            onChange={(val) => {
              setUrl(val)
              if (error) setError(null)
            }}
            error={error}
            placeholder="https://anilist.co/manga/..."
            helperText="Accepted: MangaDex, AniList, MyAnimeList"
          />
          <p className="text-[10px] text-muted-foreground mt-2 italic">
            ⓘ This does not affect chapter syncing.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Link & Enrich
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
