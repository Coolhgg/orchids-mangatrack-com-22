"use client";

/**
 * ChapterLinkDisplay Component
 * 
 * Displays a single chapter link with:
 * - Status badge (verified, unverified)
 * - Source name and domain
 * - Upvote/downvote buttons
 * - Report button
 * - External link (opens in new tab with noopener noreferrer)
 * - Legal disclaimer linking to /dmca
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ThumbsUp,
  ThumbsDown,
  Flag,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertTriangle,
  Loader2,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import Link from "next/link";

interface ChapterLinkDisplayProps {
  link: {
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
  };
  userVote?: 1 | -1 | null;
  onVote?: (linkId: string, vote: 1 | -1) => Promise<void>;
  onReport?: (linkId: string) => void;
  isAuthenticated?: boolean;
  /** Show the legal disclaimer below the link */
  showDisclaimer?: boolean;
}

export function ChapterLinkDisplay({
  link,
  userVote,
  onVote,
  onReport,
  isAuthenticated = false,
  showDisclaimer = true,
}: ChapterLinkDisplayProps) {
  const [isVoting, setIsVoting] = useState(false);
  const [currentVote, setCurrentVote] = useState<1 | -1 | null>(userVote ?? null);
  const [score, setScore] = useState(link.visibility_score);

  const handleVote = async (vote: 1 | -1) => {
    if (!isAuthenticated) {
      toast.error("Please sign in to vote");
      return;
    }
    if (!onVote || isVoting) return;

    setIsVoting(true);
    try {
      // Optimistic update
      const wasToggle = currentVote === vote;
      const wasSwitch = currentVote && currentVote !== vote;
      
      if (wasToggle) {
        setScore((prev) => prev - vote);
        setCurrentVote(null);
      } else if (wasSwitch) {
        setScore((prev) => prev + vote * 2);
        setCurrentVote(vote);
      } else {
        setScore((prev) => prev + vote);
        setCurrentVote(vote);
      }

      await onVote(link.id, vote);
    } catch {
      // Revert on error
      setScore(link.visibility_score);
      setCurrentVote(userVote ?? null);
      toast.error("Failed to vote. Please try again.");
    } finally {
      setIsVoting(false);
    }
  };

  const handleReport = () => {
    if (!isAuthenticated) {
      toast.error("Please sign in to report links");
      return;
    }
    onReport?.(link.id);
  };

  // Determine badge style based on status/tier
  const getBadgeVariant = () => {
    if (link.tier === "official") return "default";
    if (link.is_verified || link.status === "visible") return "secondary";
    return "outline";
  };

  const getBadgeClass = () => {
    if (link.tier === "official") return "bg-green-600 hover:bg-green-700 text-white";
    if (link.is_verified) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
    if (link.status === "unverified") return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    return "";
  };

  const getStatusIcon = () => {
    if (link.tier === "official") return <CheckCircle className="size-3" />;
    if (link.is_verified) return <CheckCircle className="size-3" />;
    if (link.status === "unverified") return <Clock className="size-3" />;
    return null;
  };

  const getStatusText = () => {
    if (link.tier === "official") return "Official";
    if (link.is_verified) return "Verified";
    if (link.status === "unverified") return "Community";
    return link.status;
  };

  // Sanitize display text (XSS prevention)
  const sanitizedSourceName = link.source_name
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Only show disclaimer for non-official (user-submitted) links
  const shouldShowDisclaimer = showDisclaimer && link.tier !== "official";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors group">
        {/* Link info - opens in new tab */}
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 flex-1 min-w-0"
          title={`Open ${sanitizedSourceName} in new tab`}
        >
          <div className="flex items-center gap-1.5">
            <Badge
              variant={getBadgeVariant()}
              className={`text-[10px] px-1.5 py-0 h-5 gap-1 ${getBadgeClass()}`}
            >
              {getStatusIcon()}
              {getStatusText()}
            </Badge>
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-medium truncate"
              dangerouslySetInnerHTML={{ __html: sanitizedSourceName }}
            />
            <p className="text-[10px] text-zinc-500 truncate">
              {link.domain}
              {link.metadata?.scanlationGroup && (
                <span className="ml-1">• {link.metadata.scanlationGroup}</span>
              )}
            </p>
          </div>
          <ExternalLink className="size-3.5 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </a>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Vote buttons */}
          <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-full p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`size-6 p-0 rounded-full ${
                    currentVote === 1
                      ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                      : "hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleVote(1);
                  }}
                  disabled={isVoting}
                >
                  {isVoting && currentVote !== -1 ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <ThumbsUp className="size-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Upvote this link</TooltipContent>
            </Tooltip>

            <span className="text-[10px] font-bold min-w-[16px] text-center">
              {score}
            </span>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`size-6 p-0 rounded-full ${
                    currentVote === -1
                      ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                      : "hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleVote(-1);
                  }}
                  disabled={isVoting}
                >
                  {isVoting && currentVote !== 1 ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <ThumbsDown className="size-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Downvote this link</TooltipContent>
            </Tooltip>
          </div>

          {/* Report dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-6 p-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Flag className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Report this link</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleReport}>
                <AlertTriangle className="size-3.5 mr-2" />
                Report broken/inappropriate link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Legal Disclaimer for user-submitted links */}
      {shouldShowDisclaimer && (
        <LinkDisclaimer />
      )}
    </div>
  );
}

/**
 * Legal disclaimer shown below user-submitted links
 */
export function LinkDisclaimer({ className }: { className?: string }) {
  return (
    <div className={`flex items-start gap-1.5 px-2 py-1 text-[10px] text-zinc-400 ${className || ''}`}>
      <Info className="size-3 shrink-0 mt-0.5" />
      <p>
        User-submitted external link. We do not host content.{" "}
        <Link
          href="/dmca"
          className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline"
        >
          Request removal
        </Link>
      </p>
    </div>
  );
}

/**
 * Standalone disclaimer component for use outside link display
 */
export function ChapterLinksDisclaimer() {
  return (
    <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
      <div className="flex items-start gap-2">
        <Info className="size-4 text-zinc-400 shrink-0 mt-0.5" />
        <div className="text-xs text-zinc-500">
          <p className="font-medium text-zinc-600 dark:text-zinc-400 mb-1">
            External Links Notice
          </p>
          <p>
            Links shown here are user-submitted and point to external websites. 
            We do not host any copyrighted content. Links are removed upon valid DMCA request.{" "}
            <Link
              href="/dmca"
              className="text-zinc-600 dark:text-zinc-400 hover:underline"
            >
              Learn more
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// Status indicator for when no links are available
export function NoLinksIndicator({
  sourceName,
  onAddLink,
  canSubmit = true,
  isAuthenticated = false,
}: {
  sourceName?: string;
  onAddLink?: () => void;
  canSubmit?: boolean;
  isAuthenticated?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-dashed border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-2 text-zinc-500 text-sm">
        <AlertTriangle className="size-4" />
        <span>
          {sourceName ? (
            <>
              Source: <span className="font-medium">{sourceName}</span> — Link not available
            </>
          ) : (
            "No links available for this chapter"
          )}
        </span>
      </div>
      {onAddLink && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onAddLink}
              disabled={!canSubmit}
            >
              + Add Link
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {!isAuthenticated
              ? "Sign in to submit links"
              : !canSubmit
              ? "Maximum 3 links per chapter reached"
              : "Submit a link for this chapter"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
