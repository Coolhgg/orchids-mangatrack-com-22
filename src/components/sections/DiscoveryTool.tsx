"use client";

import React from 'react';
import { Sparkles, Flame, Search, SlidersHorizontal, Compass } from 'lucide-react';

const DiscoveryTool: React.FC = () => {
  return (
    <section 
      id="discover" 
      className="py-24 bg-white"
    >
      <div className="container px-5 md:px-10 mx-auto max-w-[1280px]">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-16 gap-6">
          <div>
            <h2 className="text-[40px] font-bold leading-[1.2] text-[#111827]">
              The Ultimate Tracking Tool.
              <br className="hidden sm:block" />
              <span className="font-normal text-[#6b7280]"> Your taste, our picks—perfect match.</span>
            </h2>
          </div>
          <a href="/discovery">
            <button className="bg-[#313131] text-white px-8 py-3 rounded-lg font-semibold text-sm hover:bg-black transition-all shadow-sm">
              Start discovering
            </button>
          </a>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-20">
          
          {/* Left Column: Features */}
          <div className="flex flex-col justify-between">
            {/* Main Highlight */}
            <div className="pb-10">
              <div className="flex items-center gap-3 mb-4">
                <Sparkles className="w-8 h-8 text-amber-500" />
                <h4 className="text-xl font-semibold text-[#111827]">From hidden gems to trending hits</h4>
              </div>
              <p className="text-[#6b7280] text-base leading-relaxed mb-4">
                Say goodbye to endless scrolling and hello to smarter recommendations. Whether you're searching for trending titles, hidden gems, or something completely fresh, our discovery tools have your back.
              </p>
              <p className="text-[#6b7280] text-base leading-relaxed">
                Discover your next obsession with precision filtering across genres, tags, platforms and more.
              </p>
            </div>

            {/* Sub-features Accordion-style List */}
            <div className="divide-y border-t border-b mb-10 lg:mb-24">
              <div className="flex items-center gap-4 py-5 group cursor-default">
                <div className="w-8 h-8 flex items-center justify-center rounded-md bg-[#f9fafb]">
                  <Flame className="w-4 h-4 text-orange-500" />
                </div>
                <h4 className="text-sm font-semibold text-[#111827]">Discover what's hot right now</h4>
              </div>
              
              <div className="flex items-center gap-4 py-5 group cursor-default">
                <div className="w-8 h-8 flex items-center justify-center rounded-md bg-[#f9fafb]">
                  <Search className="w-4 h-4 text-blue-500" />
                </div>
                <h4 className="text-sm font-semibold text-[#111827]">Uncover hidden gems</h4>
              </div>

              <div className="flex items-center gap-4 py-5 group cursor-default">
                <div className="w-8 h-8 flex items-center justify-center rounded-md bg-[#f9fafb]">
                  <SlidersHorizontal className="w-4 h-4 text-violet-500" />
                </div>
                <h4 className="text-sm font-semibold text-[#111827] leading-tight">Refine using tags, genres, and other advanced filters</h4>
              </div>
            </div>
          </div>

          {/* Right Column: Platform Preview */}
          <div className="lg:col-span-2 relative overflow-hidden rounded-2xl border border-[#e5e7eb] shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)]">
            <div className="w-full h-[400px] md:h-[500px] bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-white/20 flex items-center justify-center">
                  <Compass className="w-10 h-10 text-white" />
                </div>
                <p className="text-white/80 font-medium text-lg">Discovery Interface</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};

export default DiscoveryTool;