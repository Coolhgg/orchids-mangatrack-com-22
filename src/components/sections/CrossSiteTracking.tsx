"use client";

import React from 'react';
import { Globe, Search, FolderOpen } from 'lucide-react';

const CrossSiteTracking: React.FC = () => {
  const features = [
    {
      title: 'Track Everything, Everywhere',
      description: 'Stay ahead of your favourite series with seamless cross-site tracking across 20+ websites.',
      icon: Globe,
      gradient: 'from-blue-500 to-cyan-500',
    },
    {
      title: 'Find Your Next Read',
      description: 'Search through 30,000+ titles and find exactly what you want—with powerful sorting and filtering.',
      icon: Search,
      gradient: 'from-violet-500 to-purple-500',
    },
    {
      title: 'Your Library, Your Way',
      description: 'Shape your library any way you want—filters, tags, ratings, and all the tools you need to keep it personal.',
      icon: FolderOpen,
      gradient: 'from-amber-500 to-orange-500',
    },
  ];

  return (
    <section id="track" className="py-24 bg-white">
      <div className="container mx-auto px-5 lg:px-10 max-w-[1280px]">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
          <div className="max-w-2xl">
            <h2 className="text-[32px] md:text-[40px] font-bold text-[#111827] leading-[1.1] tracking-tight">
              Cross-site tracking.<br />
              <span className="font-normal text-[#6B7280]">
                If Series Exists, You&apos;ll Find It Here.
              </span>
            </h2>
          </div>
          <div className="flex-shrink-0">
            <a 
              href="/supported-sites" 
              className="inline-flex items-center px-5 py-2.5 text-sm font-semibold text-[#374151] bg-white border border-[#E5E7EB] rounded-lg shadow-sm hover:bg-[#F9FAFB] transition-all duration-200"
            >
              Check 20+ supported sites &rarr;
            </a>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
          {features.map((feature, index) => (
            <div key={index} className="flex flex-col">
              <div className={`relative mb-6 rounded-2xl overflow-hidden shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)] border border-[#E5E7EB] aspect-[4/3] bg-gradient-to-br ${feature.gradient} flex items-center justify-center`}>
                <feature.icon className="w-16 h-16 text-white/90" />
              </div>
              <div className="flex flex-col">
                <h4 className="text-xl font-semibold text-[#111827] mb-3">
                  {feature.title}
                </h4>
                <p className="text-[16px] leading-[1.6] text-[#6B7280]">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default CrossSiteTracking;