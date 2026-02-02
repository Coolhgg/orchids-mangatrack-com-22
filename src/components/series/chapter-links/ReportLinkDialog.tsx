"use client";

/**
 * ReportLinkDialog Component
 * 
 * Dialog for reporting chapter links with:
 * - Reason selection (broken, malicious, spam, copyright, other)
 * - Optional details field
 * - Submission feedback
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Flag,
  Loader2,
  AlertTriangle,
  LinkIcon,
  Shield,
  Trash,
  Copyright,
  HelpCircle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

type ReportReason = "broken" | "malicious" | "spam" | "copyright" | "other";

const REPORT_REASONS: { value: ReportReason; label: string; description: string; icon: typeof LinkIcon }[] = [
  {
    value: "broken",
    label: "Broken Link",
    description: "Link is dead, 404, or doesn't work",
    icon: LinkIcon,
  },
  {
    value: "malicious",
    label: "Malicious Content",
    description: "Contains malware, phishing, or harmful content",
    icon: Shield,
  },
  {
    value: "spam",
    label: "Spam/Advertisement",
    description: "Link is spam or primarily advertising",
    icon: Trash,
  },
  {
    value: "copyright",
    label: "Copyright Issue",
    description: "You are the copyright holder or authorized representative",
    icon: Copyright,
  },
  {
    value: "other",
    label: "Other",
    description: "Other issue not listed above",
    icon: HelpCircle,
  },
];

interface ReportLinkDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  linkId: string;
  sourceName?: string;
  onSuccess?: () => void;
}

export function ReportLinkDialog({
  isOpen,
  onOpenChange,
  linkId,
  sourceName,
  onSuccess,
}: ReportLinkDialogProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!reason) {
      setError("Please select a reason for your report");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/links/${linkId}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          reason,
          details: details.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          toast.info("You have already reported this link");
          handleClose();
          return;
        }
        throw new Error(data.error || data.message || "Failed to submit report");
      }

      toast.success(data.message || "Report submitted successfully");
      handleClose();
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit report";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setReason(null);
      setDetails("");
      setError(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="size-5 text-red-500" />
            Report Link
          </DialogTitle>
          <DialogDescription>
            {sourceName ? (
              <>Report the link from <span className="font-medium">{sourceName}</span></>
            ) : (
              "Help us maintain quality by reporting problematic links"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Reason Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              Reason <span className="text-red-500">*</span>
            </Label>
            <RadioGroup
              value={reason || ""}
              onValueChange={(value) => {
                setReason(value as ReportReason);
                setError(null);
              }}
              className="space-y-2"
            >
              {REPORT_REASONS.map((option) => {
                const Icon = option.icon;
                return (
                  <div
                    key={option.value}
                    className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                      reason === option.value
                        ? "border-zinc-900 dark:border-zinc-50 bg-zinc-50 dark:bg-zinc-900"
                        : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    }`}
                    onClick={() => {
                      setReason(option.value);
                      setError(null);
                    }}
                  >
                    <RadioGroupItem value={option.value} id={option.value} />
                    <div className="flex-1">
                      <Label
                        htmlFor={option.value}
                        className="flex items-center gap-2 cursor-pointer font-medium"
                      >
                        <Icon className="size-4 text-zinc-500" />
                        {option.label}
                      </Label>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {option.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </RadioGroup>
          </div>

          {/* Details Input (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="details" className="text-sm font-medium">
              Additional Details{" "}
              <span className="text-zinc-400 text-xs font-normal">(optional)</span>
            </Label>
            <Textarea
              id="details"
              placeholder="Provide any additional context about this report..."
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              disabled={isSubmitting}
              className="resize-none h-20"
              maxLength={1000}
            />
            <p className="text-xs text-zinc-500">{details.length}/1000 characters</p>
          </div>

          {/* Copyright Notice */}
          {reason === "copyright" && (
            <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
              <AlertTriangle className="size-4 text-blue-600" />
              <AlertDescription className="text-blue-800 dark:text-blue-200 text-xs">
                For formal DMCA takedown requests, please visit our{" "}
                <a
                  href="/dmca"
                  className="underline font-medium"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  DMCA page
                </a>{" "}
                to submit a proper notice.
              </AlertDescription>
            </Alert>
          )}

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
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
            variant="destructive"
            onClick={handleSubmit}
            disabled={isSubmitting || !reason}
            className="sm:w-auto w-full gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Flag className="size-4" />
                Submit Report
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
