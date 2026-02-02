"use client";

import React from 'react';
import { Bookmark, SlidersHorizontal, FileText, History, LayoutDashboard } from 'lucide-react';

const PlatformAction = () => {
  return (
    <section className="mx-5 2xl:mx-0 py-16 lg:py-24">
      <div className="container relative overflow-hidden rounded-[2.5rem] bg-[#111827] text-white min-h-[600px] lg:min-h-[700px]">
        {/* Scenic Background Gradient */}
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-[#111827] via-[#1e293b] to-[#0f172a]" />
          <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-violet-900/20 to-transparent" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        </div>

        {/* Content Wrapper */}
        <div className="relative z-10 p-8 lg:p-16 flex flex-col h-full">
          {/* Header Section */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-16 gap-6">
            <div>
              <h2 className="text-3xl lg:text-[2.5rem] font-bold leading-tight mb-2">
                See the platform in action.<br className="hidden sm:block" />
                <span className="text-[#9CA3AF] font-normal text-xl lg:text-2xl mt-1 block sm:inline sm:mt-0">
                  {" "}Start tracking in under 1 minute.
                </span>
              </h2>
            </div>
            <button className="bg-white text-[#111827] px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-gray-100 transition-all whitespace-nowrap shadow-sm">
              Get started for free
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 lg:gap-20 items-center">
            {/* Left Column: Features */}
            <div className="flex flex-col gap-10">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Bookmark className="w-8 h-8 text-primary" />
                  <h4 className="text-xl font-semibold">Take Control of Your Collection</h4>
                </div>
                <p className="text-[#9CA3AF] text-base leading-relaxed max-w-md">
                  Sort it, filter it, tag it—make your library truly yours. Add notes, drop ratings, or create custom tags to keep track of everything exactly how you like it.
                </p>
                <p className="text-[#9CA3AF] text-base leading-relaxed max-w-md">
                  Managing your collection just got a whole lot easier (and way more fun).
                </p>
              </div>

              {/* Smaller Feature List */}
              <div className="border-t border-white/10 pt-8 space-y-6">
                <div className="flex items-center gap-4 group">
                  <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">
                    <SlidersHorizontal className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-sm font-medium text-gray-200">Filter by genres, tags, reading status</span>
                </div>

                <div className="flex items-center gap-4 group">
                  <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-sm font-medium text-gray-200">Add notes, rate titles, and create tags</span>
                </div>

                <div className="flex items-center gap-4 group">
                  <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-white/5 group-hover:bg-white/10 transition-colors">
                    <History className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-sm font-medium text-gray-200">Keep a detailed history</span>
                </div>
              </div>
            </div>

            {/* Right Column: Large Preview */}
            <div className="lg:col-span-2 h-full lg:relative">
              <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] bg-[#1F2937]/50 backdrop-blur-sm lg:translate-x-12">
                <div className="w-full h-[300px] md:h-[400px] bg-gradient-to-br from-[#1F2937] to-[#374151] flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/10 flex items-center justify-center">
                      <LayoutDashboard className="w-8 h-8 text-white/80" />
                    </div>
                    <p className="text-white/60 font-medium">Platform Interface</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PlatformAction;