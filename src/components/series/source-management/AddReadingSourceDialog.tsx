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
import { READING_SOURCE_HOSTS } from "@/lib/constants/sources"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

interface AddReadingSourceDialogProps {
  seriesId: string;
  seriesTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddReadingSourceDialog({
  seriesId,
  seriesTitle,
  open,
  onOpenChange
}: AddReadingSourceDialogProps) {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const validateUrl = (value: string) => {
    if (!value) return "URL is required"
    try {
      const hostname = new URL(value).hostname.replace('www.', '')
      const isSupported = READING_SOURCE_HOSTS.some(host => hostname.includes(host))
      if (!isSupported) return "Only MangaDex links are currently supported"
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
      const response = await fetch(`/api/series/${seriesId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_url: url })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || "Failed to add source")
      }

      toast.success("Source added! Chapter sync started.")
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
          <DialogTitle>Add reading source</DialogTitle>
          <DialogDescription>
            Paste a MangaDex link to start syncing chapters.
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
            placeholder="https://mangadex.org/title/..."
            helperText="Currently supported: MangaDex"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Source & Sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
