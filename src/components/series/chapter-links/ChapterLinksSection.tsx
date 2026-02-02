"use client";

/**
 * ChapterLinksSection Component
 * 
 * Main component for displaying and managing chapter links.
 * Shows:
 * - Existing links with voting/reporting
 * - "Add Link" button when < 3 links exist
 * - Source availability info when no links
 */

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Plus, Loader2, ExternalLink } from "lucide-react";
import { ChapterLinkDisplay, NoLinksIndicator } from "./ChapterLinkDisplay";
import { AddLinkDialog } from "./AddLinkDialog";
import { ReportLinkDialog } from "./ReportLinkDialog";
import { toast } from "sonner";

interface ChapterLink {
  id: string;
  url: string;
  source_name: string;
  domain: string;
  status: "visible" | "unverified" | "hidden" | "removed";
  visibility_score: number;
  submitted_at: string;
  is_verified: boolean;
  tier: "official" | "aggregator" | "user";
  metadata?: {
    displayName?: string;
    scanlationGroup?: string;
    note?: string;
  };
}

interface ChapterLinksSectionProps {
  seriesId: string;
  seriesTitle: string;
  chapterId: string;
  chapterNumber: string;
  isAuthenticated: boolean;
  /** Source name from availability events (shown when no links available) */
  availabilitySourceName?: string;
  /** Compact mode for inline display */
  compact?: boolean;
}

export function ChapterLinksSection({
  seriesId,
  seriesTitle,
  chapterId,
  chapterNumber,
  isAuthenticated,
  availabilitySourceName,
  compact = false,
}: ChapterLinksSectionProps) {
  const [links, setLinks] = useState<ChapterLink[]>([]);
  const [userVotes, setUserVotes] = useState<Record<string, 1 | -1>>({});
  const [canSubmit, setCanSubmit] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [reportingLinkId, setReportingLinkId] = useState<string | null>(null);
  const [reportingSourceName, setReportingSourceName] = useState<string>("");

  // Fetch links for this chapter
  const fetchLinks = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/series/${seriesId}/chapters/${chapterId}/links`,
        { credentials: "include" }
      );

      if (!response.ok) {
        // Silent fail for non-critical errors
        if (response.status !== 404) {
          console.warn(`[ChapterLinks] Failed to fetch: ${response.status}`);
        }
        setLinks([]);
        setCanSubmit(true);
        return;
      }

      const data = await response.json();
      setLinks(data.links || []);
      setUserVotes(data.userVotes || {});
      setCanSubmit(data.canSubmit ?? true);
    } catch (err) {
      console.error("[ChapterLinks] Fetch error:", err);
      setLinks([]);
      setCanSubmit(true);
    } finally {
      setIsLoading(false);
    }
  }, [seriesId, chapterId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  // Handle voting
  const handleVote = useCallback(
    async (linkId: string, vote: 1 | -1) => {
      const response = await fetch(`/api/links/${linkId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ vote }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to vote");
      }

      const data = await response.json();
      
      // Update local state
      setUserVotes((prev) => {
        if (data.user_vote === null) {
          const { [linkId]: removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [linkId]: data.user_vote };
      });

      setLinks((prev) =>
        prev.map((link) =>
          link.id === linkId
            ? { ...link, visibility_score: data.visibility_score }
            : link
        )
      );
    },
    []
  );

  // Handle report
  const handleReport = useCallback((linkId: string) => {
    const link = links.find((l) => l.id === linkId);
    setReportingLinkId(linkId);
    setReportingSourceName(link?.source_name || "");
  }, [links]);

  // Handle add link success
  const handleAddSuccess = useCallback(() => {
    fetchLinks();
  }, [fetchLinks]);

  // Handle report success
  const handleReportSuccess = useCallback(() => {
    fetchLinks();
  }, [fetchLinks]);

  // Compact mode - just show add button or first link
  if (compact) {
    if (isLoading) {
      return (
        <Button variant="ghost" size="sm" disabled className="h-6 px-2">
          <Loader2 className="size-3 animate-spin" />
        </Button>
      );
    }

    if (links.length === 0) {
      return (
        <TooltipProvider>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setIsAddDialogOpen(true)}
            disabled={!isAuthenticated}
          >
            <Plus className="size-3 mr-1" />
            Add Link
          </Button>
          <AddLinkDialog
            isOpen={isAddDialogOpen}
            onOpenChange={setIsAddDialogOpen}
            seriesId={seriesId}
            chapterId={chapterId}
            chapterNumber={chapterNumber}
            seriesTitle={seriesTitle}
            onSuccess={handleAddSuccess}
          />
        </TooltipProvider>
      );
    }

    // Show first link in compact mode
    const firstLink = links[0];
    return (
      <a
        href={firstLink.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
      >
        <ExternalLink className="size-3" />
        {firstLink.source_name}
      </a>
    );
  }

  // Full mode
  return (
    <TooltipProvider>
      <div className="space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="size-5 animate-spin text-zinc-400" />
          </div>
        ) : links.length === 0 ? (
          <NoLinksIndicator
            sourceName={availabilitySourceName}
            onAddLink={() => setIsAddDialogOpen(true)}
            canSubmit={canSubmit}
            isAuthenticated={isAuthenticated}
          />
        ) : (
          <>
            {/* Link list */}
            <div className="space-y-1.5">
              {links.map((link) => (
                <ChapterLinkDisplay
                  key={link.id}
                  link={link}
                  userVote={userVotes[link.id]}
                  onVote={handleVote}
                  onReport={handleReport}
                  isAuthenticated={isAuthenticated}
                />
              ))}
            </div>

            {/* Add link button (if < 3 links) */}
            {canSubmit && (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 text-xs border-dashed"
                onClick={() => setIsAddDialogOpen(true)}
                disabled={!isAuthenticated}
              >
                <Plus className="size-3 mr-1.5" />
                {isAuthenticated ? "Add Another Link" : "Sign in to Add Link"}
              </Button>
            )}

            {/* Max links message */}
            {!canSubmit && (
              <p className="text-xs text-zinc-500 text-center py-1">
                Maximum of 3 links per chapter reached
              </p>
            )}
          </>
        )}

        {/* Add Link Dialog */}
        <AddLinkDialog
          isOpen={isAddDialogOpen}
          onOpenChange={setIsAddDialogOpen}
          seriesId={seriesId}
          chapterId={chapterId}
          chapterNumber={chapterNumber}
          seriesTitle={seriesTitle}
          onSuccess={handleAddSuccess}
        />

        {/* Report Dialog */}
        {reportingLinkId && (
          <ReportLinkDialog
            isOpen={!!reportingLinkId}
            onOpenChange={(open) => {
              if (!open) setReportingLinkId(null);
            }}
            linkId={reportingLinkId}
            sourceName={reportingSourceName}
            onSuccess={handleReportSuccess}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

// Export sub-components for individual use
export { ChapterLinkDisplay, NoLinksIndicator } from "./ChapterLinkDisplay";
export { AddLinkDialog } from "./AddLinkDialog";
export { ReportLinkDialog } from "./ReportLinkDialog";
