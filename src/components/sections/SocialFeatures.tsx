"use client";

import React from 'react';
import { CircleUser, MessageSquareMore, ChartPie, Users } from 'lucide-react';

const SocialFeatures = () => {
  return (
    <section 
      id="social" 
      className="border-y border-border bg-[#F9FAFB] py-20"
    >
      <div className="container">
        {/* Header Section */}
        <div className="mb-12">
          <h2 className="text-[2.5rem] font-bold leading-[1.2] text-[#111827]">
            More Than Just Tracking.<br className="hidden sm:block" />
            <span className="font-normal text-[#6B7280]"> Join the Community</span>
          </h2>
        </div>

        {/* Features Icons Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {/* Feature 1 */}
          <div className="flex flex-col items-center sm:items-start">
            <div className="flex gap-3 items-center mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm border border-border">
                <CircleUser className="w-4 h-4 text-[#111827]" />
              </div>
              <h4 className="text-[1.25rem] font-semibold text-[#111827]">
                Your Profile, Your Rules
              </h4>
            </div>
            <p className="text-base text-[#6B7280] leading-relaxed text-center sm:text-left">
              Customize your profile, set a banner, and decide who can see your activity.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="flex flex-col items-center sm:items-start">
            <div className="flex gap-3 items-center mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm border border-border">
                <MessageSquareMore className="w-4 h-4 text-[#111827]" />
              </div>
              <h4 className="text-[1.25rem] font-semibold text-[#111827]">
                Connect With Friends
              </h4>
            </div>
            <p className="text-base text-[#6B7280] leading-relaxed text-center sm:text-left">
              Add friends, compare libraries, and see what they're reading in real time.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="flex flex-col items-center sm:items-start">
            <div className="flex gap-3 items-center mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm border border-border">
                <ChartPie className="w-4 h-4 text-[#111827]" />
              </div>
              <h4 className="text-[1.25rem] font-semibold text-[#111827]">
                Reading Stats That Matter
              </h4>
            </div>
            <p className="text-base text-[#6B7280] leading-relaxed text-center sm:text-left">
              Dive into detailed charts that reveal your series preferences and hidden reading habits.
            </p>
          </div>
        </div>

        {/* Profile Preview */}
        <div className="relative mt-8">
          <div className="rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/50 bg-white">
            <div className="w-full h-[400px] md:h-[500px] bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-white/20 flex items-center justify-center">
                  <Users className="w-10 h-10 text-white" />
                </div>
                <p className="text-white/80 font-medium text-lg">Social Community Profile</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default SocialFeatures;