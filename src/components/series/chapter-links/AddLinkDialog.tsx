"use client";

/**
 * AddLinkDialog Component
 * 
 * Dialog for submitting chapter links with:
 * - URL input field (required)
 * - Optional note field
 * - External link warning
 * - Google search helper button
 * - Validation feedback
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  ExternalLink,
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  Info,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

interface AddLinkDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  seriesId: string;
  chapterId: string;
  chapterNumber: string;
  seriesTitle: string;
  onSuccess?: () => void;
}

export function AddLinkDialog({
  isOpen,
  onOpenChange,
  seriesId,
  chapterId,
  chapterNumber,
  seriesTitle,
  onSuccess,
}: AddLinkDialogProps) {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Basic URL validation (client-side)
  const validateUrlFormat = useCallback((input: string): boolean => {
    if (!input.trim()) {
      setUrlError("URL is required");
      return false;
    }
    try {
      const parsed = new URL(input.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) {
        setUrlError("URL must use http or https");
        return false;
      }
      setUrlError(null);
      return true;
    } catch {
      setUrlError("Invalid URL format");
      return false;
    }
  }, []);

  const handleUrlChange = (value: string) => {
    setUrl(value);
    if (value.trim()) {
      validateUrlFormat(value);
    } else {
      setUrlError(null);
    }
    setError(null);
  };

  const handleSubmit = async () => {
    // Validate
    if (!validateUrlFormat(url)) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/series/${seriesId}/chapters/${chapterId}/links`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            url: url.trim(),
            note: note.trim() || undefined,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        // Handle specific error codes
        if (data.code === "DUPLICATE") {
          toast.info(data.message || "This link already exists");
          onOpenChange(false);
          onSuccess?.();
          return;
        }
        throw new Error(data.error || data.message || "Failed to submit link");
      }

      toast.success(data.message || "Link submitted successfully");
      setUrl("");
      setNote("");
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit link";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSearch = () => {
    // Build a safe search query - only series title and chapter number
    // Do NOT include pirate group names or specific sites
    const searchQuery = encodeURIComponent(
      `${seriesTitle} Chapter ${chapterNumber} read online`
    );
    window.open(
      `https://www.google.com/search?q=${searchQuery}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setUrl("");
      setNote("");
      setError(null);
      setUrlError(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLink className="size-5" />
            Add Reading Link
          </DialogTitle>
          <DialogDescription>
            Submit a link for <span className="font-medium">{seriesTitle}</span>{" "}
            Chapter {chapterNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning Alert */}
          <Alert variant="default" className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
            <AlertTriangle className="size-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-200 text-xs">
              This link is external and may contain unofficial content. We do not
              host any content. Links are user-provided and will be removed upon
              valid DMCA request.
            </AlertDescription>
          </Alert>

          {/* URL Input */}
          <div className="space-y-2">
            <Label htmlFor="url" className="text-sm font-medium">
              Chapter URL <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              <Input
                id="url"
                type="url"
                placeholder="https://example.com/chapter/123"
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                disabled={isSubmitting}
                className={urlError ? "border-red-500 focus-visible:ring-red-500" : ""}
                aria-invalid={!!urlError}
                aria-describedby={urlError ? "url-error" : undefined}
              />
              {url && !urlError && (
                <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-green-500" />
              )}
              {urlError && (
                <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-red-500" />
              )}
            </div>
            {urlError && (
              <p id="url-error" className="text-xs text-red-500" role="alert">
                {urlError}
              </p>
            )}
          </div>

          {/* Note Input (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="note" className="text-sm font-medium">
              Note <span className="text-zinc-400 text-xs font-normal">(optional)</span>
            </Label>
            <Textarea
              id="note"
              placeholder="e.g., Official translation, HD quality"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={isSubmitting}
              className="resize-none h-20"
              maxLength={500}
            />
            <p className="text-xs text-zinc-500">{note.length}/500 characters</p>
          </div>

          {/* Google Search Helper */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <Info className="size-4 text-zinc-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Need to find a link? Search for this chapter online.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 h-7 text-xs gap-1.5"
              onClick={handleGoogleSearch}
              type="button"
            >
              <Search className="size-3" />
              Search Google
            </Button>
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <XCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
            className="sm:w-auto w-full"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !url.trim() || !!urlError}
            className="sm:w-auto w-full gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <ExternalLink className="size-4" />
                Submit Link
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
