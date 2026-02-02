"use client";

import React from 'react';
import { BookOpen } from 'lucide-react';

const CTASection: React.FC = () => {
  return (
    <section className="relative w-full px-5 py-20 sm:px-10 lg:px-20">
      <div className="container mx-auto max-w-[1280px]">
        <div className="relative h-[480px] w-full overflow-hidden rounded-[2rem] sm:rounded-[3rem]">
          {/* Background Gradient */}
          <div className="absolute inset-0 z-0">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-pink-500/30 via-transparent to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black/20 to-transparent" />
          </div>

          {/* Content */}
          <div className="relative z-10 flex h-full flex-col items-center justify-center text-center px-6">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
            <h2 className="mb-8 max-w-2xl text-[2.5rem] font-bold leading-[1.2] tracking-tight text-white md:text-[3.5rem]">
              Ready for Your Next Favourite Read?
            </h2>
            
            <a
              href="/register"
              className="inline-flex h-[52px] items-center justify-center rounded-xl bg-white px-8 text-sm font-semibold text-gray-900 shadow-lg transition-transform hover:scale-105 active:scale-95"
            >
              Get started for free
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;