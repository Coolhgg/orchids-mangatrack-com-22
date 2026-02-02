import type { Metadata } from "next";
import "./globals.css";
import ErrorReporter from "@/components/ErrorReporter";
import VisualEditsMessengerWrapper from "@/visual-edits/VisualEditsMessengerWrapper";
import Script from "next/script";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthSessionProvider } from "@/components/auth-session-provider";
import { SafeBrowsingProvider } from "@/lib/context/safe-browsing-context";
import { SyncProvider } from "@/components/sync-provider";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "MangaTrack - Universal Manga Tracker",
  description: "Track your manga, manhwa, and webtoons across all platforms in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Script
          id="orchids-browser-logs-1"
          src="https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/object/public/scripts/orchids-browser-logs.js"
          strategy="afterInteractive"
          data-orchids-project-id="56bb3864-9ca4-4f06-bad2-180cf74c63c7"
        />
        <Script
          id="orchids-browser-logs-2"
          src="https://nkrxhoamqsawixdwehaq.supabase.co/storage/v1/object/public/scripts/orchids-browser-logs.js"
          strategy="afterInteractive"
          data-orchids-project-id="e5587058-accd-49a5-b634-62270bbfdbff"
        />
        <ErrorReporter />
        <Script
          src="https://nkrxhoamqsawixdwehaq.supabase.co/storage/v1/object/public/scripts//route-messenger.js"
          strategy="afterInteractive"
          data-target-origin="*"
          data-message-type="ROUTE_CHANGE"
          data-include-search-params="true"
          data-only-in-iframe="true"
          data-debug="true"
          data-custom-data='{"appName": "YourApp", "version": "1.0.0", "greeting": "hi"}'
        />
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <AuthSessionProvider>
                <SafeBrowsingProvider>
                  <SyncProvider>
                    {children}
                  </SyncProvider>
                </SafeBrowsingProvider>
            </AuthSessionProvider>
          </ThemeProvider>
        <Toaster position="top-right" richColors />
        <VisualEditsMessengerWrapper />
      </body>
    </html>
  );
}