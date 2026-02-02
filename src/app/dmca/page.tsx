"use client";

/**
 * DMCA Policy Page
 * 
 * Provides:
 * - DMCA policy information
 * - Contact email for inquiries
 * - Takedown request form
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Shield,
  Mail,
  FileText,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

const CONTACT_EMAIL = "dmca@kenmei.co";

export default function DMCAPage() {
  const [formData, setFormData] = useState({
    requester_name: "",
    requester_company: "",
    requester_contact: "",
    work_title: "",
    target_url: "",
    claim_details: "",
    good_faith_statement: false,
    accuracy_statement: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
    requestId?: string;
  } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear field error on change
    if (errors[field]) {
      setErrors((prev) => {
        const { [field]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.requester_contact.trim()) {
      newErrors.requester_contact = "Email address is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.requester_contact)) {
      newErrors.requester_contact = "Please enter a valid email address";
    }

    if (!formData.work_title.trim()) {
      newErrors.work_title = "Title of copyrighted work is required";
    }

    if (!formData.target_url.trim()) {
      newErrors.target_url = "Target URL is required";
    } else {
      try {
        new URL(formData.target_url);
      } catch {
        newErrors.target_url = "Please enter a valid URL";
      }
    }

    if (!formData.claim_details.trim()) {
      newErrors.claim_details = "Claim details are required";
    } else if (formData.claim_details.trim().length < 20) {
      newErrors.claim_details = "Please provide more detailed information (minimum 20 characters)";
    }

    if (!formData.good_faith_statement) {
      newErrors.good_faith_statement = "You must confirm good faith belief";
    }

    if (!formData.accuracy_statement) {
      newErrors.accuracy_statement = "You must confirm the accuracy of your information";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      const response = await fetch("/api/dmca", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.details) {
          // Field-level errors from server
          const serverErrors: Record<string, string> = {};
          Object.entries(data.details).forEach(([key, messages]) => {
            if (Array.isArray(messages) && messages.length > 0) {
              serverErrors[key] = messages[0];
            }
          });
          setErrors(serverErrors);
          setSubmitResult({
            success: false,
            message: "Please correct the errors below and try again.",
          });
        } else {
          throw new Error(data.message || data.error || "Failed to submit request");
        }
        return;
      }

      setSubmitResult({
        success: true,
        message: data.message,
        requestId: data.request_id,
      });

      // Reset form on success
      setFormData({
        requester_name: "",
        requester_company: "",
        requester_contact: "",
        work_title: "",
        target_url: "",
        claim_details: "",
        good_faith_statement: false,
        accuracy_statement: false,
      });
    } catch (err) {
      setSubmitResult({
        success: false,
        message: err instanceof Error ? err.message : "An error occurred. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* Header */}
      <div className="border-b border-zinc-100 dark:border-zinc-900">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-900">
              <Shield className="size-6" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">DMCA Policy</h1>
          </div>
          <p className="text-zinc-600 dark:text-zinc-400 max-w-2xl">
            We respect intellectual property rights and respond promptly to valid takedown requests.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-12">
        {/* Policy Section */}
        <section className="space-y-6">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FileText className="size-5" />
            Our Policy
          </h2>
          <div className="prose prose-zinc dark:prose-invert max-w-none space-y-4">
            <p>
              Kenmei respects the intellectual property rights of others and expects its users to do the same.
              In accordance with the Digital Millennium Copyright Act (DMCA), we will respond expeditiously
              to claims of copyright infringement committed using our service.
            </p>
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <div className="flex gap-3">
                <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">
                    Important Notice
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Kenmei does not host any copyrighted content. We are a tracking service that aggregates
                    links from third-party sources. User-submitted links are provided for convenience and
                    we cannot verify the legality of external content. Links are removed upon valid DMCA request.
                  </p>
                </div>
              </div>
            </div>
            <h3 className="font-semibold">What happens when you submit a takedown request:</h3>
            <ol className="list-decimal pl-6 space-y-2">
              <li>Your request is logged and assigned a reference number</li>
              <li>If we can identify the reported link in our system, it is immediately removed pending review</li>
              <li>Our team reviews the request for completeness and validity</li>
              <li>The link submitter may be notified and given opportunity to file a counter-notice</li>
              <li>Final resolution is communicated to all parties</li>
            </ol>
          </div>
        </section>

        {/* Contact Section */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Mail className="size-5" />
            Contact Information
          </h2>
          <Card>
            <CardContent className="pt-6">
              <p className="mb-4">
                For DMCA inquiries, you may contact us via email or use the form below:
              </p>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="inline-flex items-center gap-2 text-lg font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                <Mail className="size-5" />
                {CONTACT_EMAIL}
              </a>
            </CardContent>
          </Card>
        </section>

        {/* Takedown Form */}
        <section className="space-y-6">
          <h2 className="text-xl font-bold">Submit Takedown Request</h2>
          
          {submitResult && (
            <Alert
              variant={submitResult.success ? "default" : "destructive"}
              className={submitResult.success ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" : ""}
            >
              {submitResult.success ? (
                <CheckCircle className="size-4 text-green-600" />
              ) : (
                <AlertTriangle className="size-4" />
              )}
              <AlertDescription className={submitResult.success ? "text-green-800 dark:text-green-200" : ""}>
                {submitResult.message}
                {submitResult.requestId && (
                  <span className="block mt-1 font-mono text-sm">
                    Reference: {submitResult.requestId}
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>DMCA Takedown Notice</CardTitle>
              <CardDescription>
                Please provide accurate information. False claims may result in legal liability.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Claimant Info */}
                <div className="space-y-4">
                  <h3 className="font-medium text-sm text-zinc-500 uppercase tracking-wide">
                    Your Information
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="requester_name">Full Name</Label>
                      <Input
                        id="requester_name"
                        value={formData.requester_name}
                        onChange={(e) => handleChange("requester_name", e.target.value)}
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="requester_company">
                        Company/Organization <span className="text-zinc-400">(if applicable)</span>
                      </Label>
                      <Input
                        id="requester_company"
                        value={formData.requester_company}
                        onChange={(e) => handleChange("requester_company", e.target.value)}
                        placeholder="Shueisha Inc."
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="requester_contact">
                      Email Address <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="requester_contact"
                      type="email"
                      value={formData.requester_contact}
                      onChange={(e) => handleChange("requester_contact", e.target.value)}
                      placeholder="you@example.com"
                      className={errors.requester_contact ? "border-red-500" : ""}
                    />
                    {errors.requester_contact && (
                      <p className="text-xs text-red-500">{errors.requester_contact}</p>
                    )}
                  </div>
                </div>

                {/* Work Info */}
                <div className="space-y-4">
                  <h3 className="font-medium text-sm text-zinc-500 uppercase tracking-wide">
                    Copyrighted Work
                  </h3>
                  <div className="space-y-2">
                    <Label htmlFor="work_title">
                      Title of Copyrighted Work <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="work_title"
                      value={formData.work_title}
                      onChange={(e) => handleChange("work_title", e.target.value)}
                      placeholder="One Piece"
                      className={errors.work_title ? "border-red-500" : ""}
                    />
                    {errors.work_title && (
                      <p className="text-xs text-red-500">{errors.work_title}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="target_url">
                      URL to be Removed <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="target_url"
                      type="url"
                      value={formData.target_url}
                      onChange={(e) => handleChange("target_url", e.target.value)}
                      placeholder="https://example.com/chapter/123"
                      className={errors.target_url ? "border-red-500" : ""}
                    />
                    {errors.target_url && (
                      <p className="text-xs text-red-500">{errors.target_url}</p>
                    )}
                    <p className="text-xs text-zinc-500">
                      The specific link on our platform you want removed
                    </p>
                  </div>
                </div>

                {/* Claim Details */}
                <div className="space-y-4">
                  <h3 className="font-medium text-sm text-zinc-500 uppercase tracking-wide">
                    Claim Details
                  </h3>
                  <div className="space-y-2">
                    <Label htmlFor="claim_details">
                      Description of Claim <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="claim_details"
                      value={formData.claim_details}
                      onChange={(e) => handleChange("claim_details", e.target.value)}
                      placeholder="Please describe how this content infringes your copyright, including which specific copyrighted work is being infringed and your relationship to it (author, publisher, authorized representative, etc.)."
                      className={`min-h-[120px] ${errors.claim_details ? "border-red-500" : ""}`}
                    />
                    {errors.claim_details && (
                      <p className="text-xs text-red-500">{errors.claim_details}</p>
                    )}
                    <p className="text-xs text-zinc-500">
                      {formData.claim_details.length}/5000 characters
                    </p>
                  </div>
                </div>

                {/* Legal Statements */}
                <div className="space-y-4 p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900">
                  <h3 className="font-medium text-sm">Required Statements</h3>
                  
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="good_faith_statement"
                        checked={formData.good_faith_statement}
                        onCheckedChange={(checked) =>
                          handleChange("good_faith_statement", checked === true)
                        }
                        className={errors.good_faith_statement ? "border-red-500" : ""}
                      />
                      <div className="space-y-1">
                        <Label
                          htmlFor="good_faith_statement"
                          className="text-sm cursor-pointer"
                        >
                          I have a good faith belief that use of the material in the manner
                          complained of is not authorized by the copyright owner, its agent,
                          or the law. <span className="text-red-500">*</span>
                        </Label>
                        {errors.good_faith_statement && (
                          <p className="text-xs text-red-500">{errors.good_faith_statement}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="accuracy_statement"
                        checked={formData.accuracy_statement}
                        onCheckedChange={(checked) =>
                          handleChange("accuracy_statement", checked === true)
                        }
                        className={errors.accuracy_statement ? "border-red-500" : ""}
                      />
                      <div className="space-y-1">
                        <Label
                          htmlFor="accuracy_statement"
                          className="text-sm cursor-pointer"
                        >
                          The information in this notification is accurate, and under penalty
                          of perjury, I am the owner, or an agent authorized to act on behalf
                          of the owner, of an exclusive right that is allegedly infringed.{" "}
                          <span className="text-red-500">*</span>
                        </Label>
                        {errors.accuracy_statement && (
                          <p className="text-xs text-red-500">{errors.accuracy_statement}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full sm:w-auto"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Shield className="size-4 mr-2" />
                      Submit Takedown Request
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>

        {/* Additional Info */}
        <section className="space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Counter-Notice</h2>
          <p>
            If you believe your content was removed in error, you may submit a counter-notice by
            emailing{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 dark:text-blue-400 hover:underline">
              {CONTACT_EMAIL}
            </a>{" "}
            with the following information:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Your physical or electronic signature</li>
            <li>Identification of the material that was removed and its location before removal</li>
            <li>
              A statement under penalty of perjury that you have a good faith belief that the
              material was removed as a result of mistake or misidentification
            </li>
            <li>Your name, address, and telephone number</li>
            <li>
              A statement that you consent to the jurisdiction of federal court in your district
              and will accept service of process from the complainant
            </li>
          </ul>
        </section>

        {/* Back link */}
        <div className="pt-8 border-t border-zinc-100 dark:border-zinc-900">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
          >
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
