"use client";

import React from 'react';

const Footer = () => {
  const footerLinks = {
    Product: [
      { name: 'Supported Sites', href: '#' },
      { name: 'Pricing', href: '#' },
      { name: 'About', href: '#' },
    ],
    Resources: [
      { name: 'Suggestions', href: '#' },
      { name: 'Changelog', href: '#' },
      { name: 'Status', href: '#' },
      { name: 'Blog', href: '#' },
    ],
    Legal: [
      { name: 'Cookies', href: '#' },
      { name: 'Privacy', href: '#' },
      { name: 'Terms', href: '#' },
      { name: 'DMCA / Takedown', href: '/dmca' },
    ],
    Social: [
      { name: 'Discord', href: '#' },
      { name: 'X', href: '#' },
    ],
  };

  return (
    <footer className="relative w-full bg-[#111827] text-white pt-24 overflow-hidden">
      {/* Background Gradient */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-t from-[#111827] via-[#1a2332] to-[#111827]" />
        <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-violet-900/20 to-transparent" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="container relative z-10 mx-auto px-5 lg:px-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 mb-20">
          {/* Logo and Tagline Column */}
          <div className="lg:col-span-5 flex flex-col items-start">
              <div className="mb-6 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
                  <span className="text-[#111827] font-bold text-sm">M</span>
                </div>
                <span className="font-bold text-xl text-white">MangaTrack</span>
              </div>
            <p className="text-gray-400 text-sm max-w-xs leading-relaxed font-medium">
              Your favourite tracker for discovering and tracking new series.
            </p>
          </div>

          {/* Links Columns */}
          <div className="lg:col-span-7">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {Object.entries(footerLinks).map(([title, links]) => (
                <div key={title}>
                  <h4 className="text-white font-bold text-sm mb-5 tracking-wide">
                    {title}
                  </h4>
                  <ul className="space-y-3">
                    {links.map((link) => (
                      <li key={link.name}>
                        <a
                          href={link.href}
                          className="text-gray-400 hover:text-white transition-colors duration-200 text-sm font-medium"
                        >
                          {link.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Bottom / Copyright */}
        <div className="border-t border-white/10 py-10 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-gray-500 text-xs font-medium">
            © 2025 Studio Shogun, LTD. All rights reserved.
          </div>
          <p className="text-gray-500 text-xs font-medium text-center md:text-right">
            We use cookies to improve your experience and provide core website functionality.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;