"use client";

import React from 'react';
import { Sparkles, Bell, Settings } from 'lucide-react';

const PremiumFeatures = () => {
  const features = [
    {
      title: 'Personalized Recommendations',
      description: "The more you read, the better we get at suggesting series you'll love—tailored for you.",
      icon: Sparkles,
      gradient: 'from-rose-500 to-pink-600',
    },
    {
      title: 'Smart Suggestions System',
      description: 'Get real-time notifications and tailored suggestions to keep your list organized and up to date.',
      icon: Bell,
      gradient: 'from-amber-500 to-orange-600',
    },
  ];

  return (
    <section 
      id="premium" 
      className="container py-[120px] bg-white"
      style={{
        maxWidth: '1280px',
        margin: '0 auto',
      }}
    >
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-16 gap-6">
        <div>
          <h2 className="text-[2.5rem] font-bold leading-[1.2] tracking-[-0.02em] text-[#111827]">
            Go Premium & Unlock More.<br className="hidden sm:block" />
            <span className="font-normal text-[#6B7280]"> Supercharge Your Tracking Experience.</span>
          </h2>
        </div>
        <a href="/pricing">
          <button className="bg-[#313131] hover:bg-black text-white px-6 py-2.5 rounded-lg font-semibold text-sm transition-all shadow-sm">
            Explore premium
          </button>
        </a>
      </div>

      {/* 3-Column Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
        
        {features.map((feature, index) => (
          <div key={index} className="flex flex-col">
            <div className={`relative aspect-[4/3] mb-6 overflow-hidden rounded-xl border border-[#E5E7EB] shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)] bg-gradient-to-br ${feature.gradient} flex items-center justify-center`}>
              <feature.icon className="w-16 h-16 text-white/90" />
            </div>
            <div className="flex flex-col gap-2">
              <h4 className="text-[1.25rem] font-semibold text-[#111827] leading-tight">
                {feature.title}
              </h4>
              <p className="text-[#6B7280] text-base leading-relaxed">
                {feature.description}
              </p>
            </div>
          </div>
        ))}

        {/* And More / Custom Collection Management Card */}
        <div className="flex flex-col">
          <div className="relative aspect-[4/3] mb-6 overflow-hidden rounded-xl border border-[#E5E7EB] shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)] bg-[#F9FAFB]">
            <div className="p-6 h-full flex flex-col justify-center">
              <div className="bg-white rounded-lg border border-[#E5E7EB] p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3 ml-2">
                  <Settings className="w-4 h-4 text-gray-600" />
                  <p className="text-[10px] font-bold text-gray-800">Customise Collections</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded border border-dashed border-gray-200">
                    <div className="w-2 h-2 bg-gray-300 rounded-sm"></div>
                    <div className="h-2 w-24 bg-gray-200 rounded"></div>
                  </div>
                  <div className="flex items-center gap-2 px-2 py-1.5 border border-dashed border-gray-100 opacity-60">
                    <div className="w-2 h-2 bg-gray-200 rounded-sm"></div>
                    <div className="h-2 w-20 bg-gray-100 rounded"></div>
                  </div>
                  <div className="flex items-center gap-2 px-2 py-1.5 border border-dashed border-gray-100 opacity-40">
                    <div className="w-2 h-2 bg-gray-100 rounded-sm"></div>
                    <div className="h-2 w-28 bg-gray-50 rounded"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h4 className="text-[1.25rem] font-semibold text-[#111827] leading-tight">
              And More...
            </h4>
            <p className="text-[#6B7280] text-base leading-relaxed">
              From profile customization to early access features, level-up your experience even more.
            </p>
          </div>
        </div>

      </div>
    </section>
  );
};

export default PremiumFeatures;