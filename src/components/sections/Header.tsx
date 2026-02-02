"use client";

import React, { useState, useEffect } from "react";
import { ChevronDown, Menu, User, X } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface UserData {
  id: string
  email: string
  username?: string
}

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    
    const checkUser = async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        
        if (authUser) {
          setUser({
            id: authUser.id,
            email: authUser.email || '',
            username: authUser.user_metadata?.username
          });
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Error checking user:", error);
      } finally {
        setLoading(false);
      }
    };

    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            username: session.user.user_metadata?.username
          });
        } else {
          setUser(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 transition-all duration-300">
      <nav
        className={`w-full transition-all duration-300 ${
          isScrolled
            ? "bg-background/80 backdrop-blur-md border-b border-border/50 py-3 shadow-sm"
            : "bg-transparent py-5"
        }`}
      >
        <div className="container mx-auto px-5 md:px-10 max-w-[1280px]">
          <div className="flex items-center justify-between">
            {/* Logo */}
              <a href="/" className="flex-shrink-0 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-primary-foreground font-bold text-sm">M</span>
                </div>
                <span className="font-bold text-xl text-foreground">MangaTrack</span>
              </a>

            {/* Desktop Navigation Links */}
            <div className="hidden lg:flex items-center gap-8">
              <a
                href="#track"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Track
              </a>
              <a
                href="#discover"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Discover
              </a>
              <a
                href="#social"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Social
              </a>
              <a
                href="#premium"
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Premium
              </a>
              <div className="relative group cursor-pointer flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                <span>Resources</span>
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>

            {/* Desktop Actions */}
            <div className="hidden lg:flex items-center gap-4">
              {loading ? (
                <div className="h-10 w-32 bg-muted animate-pulse rounded-lg" />
              ) : user ? (
                <>
                  <Link 
                    href="/library" 
                    className="text-sm font-semibold text-foreground px-4 py-2 hover:opacity-80 transition-opacity"
                  >
                    My Library
                  </Link>
                  <Link 
                    href="/library" 
                    className="bg-primary hover:opacity-90 text-primary-foreground text-sm font-semibold px-6 py-2.5 rounded-lg shadow-sm transition-all active:scale-[0.98] flex items-center gap-2"
                  >
                    <User className="w-4 h-4" />
                    Dashboard
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/login" className="text-sm font-semibold text-foreground px-4 py-2 hover:opacity-80 transition-opacity">
                    Log in
                  </Link>
                  <Link href="/register" className="bg-primary hover:opacity-90 text-primary-foreground text-sm font-semibold px-6 py-2.5 rounded-lg shadow-sm transition-all active:scale-[0.98]">
                    Register
                  </Link>
                </>
              )}
            </div>

            {/* Mobile Menu Button */}
            <div className="lg:hidden">
              <button
                className="p-2.5 border border-border shadow-sm rounded-lg bg-background active:bg-secondary transition-colors"
                aria-label="Toggle Navigation"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? (
                  <X className="w-6 h-6 text-foreground" />
                ) : (
                  <Menu className="w-6 h-6 text-foreground" />
                )}
              </button>
            </div>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="lg:hidden mt-4 pb-4 border-t border-border/50 pt-4 space-y-4">
              <div className="flex flex-col gap-3">
                <a href="#track" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2">
                  Track
                </a>
                <a href="#discover" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2">
                  Discover
                </a>
                <a href="#social" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2">
                  Social
                </a>
                <a href="#premium" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-2">
                  Premium
                </a>
              </div>
              <div className="flex flex-col gap-3 pt-2 border-t border-border/50">
                {loading ? (
                  <div className="h-10 w-full bg-muted animate-pulse rounded-lg" />
                ) : user ? (
                  <>
                    <Link 
                      href="/library" 
                      className="text-sm font-semibold text-foreground py-2 hover:opacity-80 transition-opacity"
                    >
                      My Library
                    </Link>
                    <Link 
                      href="/library" 
                      className="bg-primary hover:opacity-90 text-primary-foreground text-sm font-semibold px-6 py-3 rounded-lg shadow-sm transition-all text-center flex items-center justify-center gap-2"
                    >
                      <User className="w-4 h-4" />
                      Dashboard
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href="/login" className="text-sm font-semibold text-foreground py-2 hover:opacity-80 transition-opacity">
                      Log in
                    </Link>
                    <Link href="/register" className="bg-primary hover:opacity-90 text-primary-foreground text-sm font-semibold px-6 py-3 rounded-lg shadow-sm transition-all text-center">
                      Register
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
};

export default Header;
