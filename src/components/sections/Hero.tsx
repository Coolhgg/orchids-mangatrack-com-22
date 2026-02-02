"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { BookMarked } from 'lucide-react';

const HeroSection = () => {
  return (
    <section className="relative min-h-[900px] overflow-hidden bg-background">
      {/* Background Gradient */}
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-primary/5 via-background to-background" />
      <div className="absolute inset-0 z-0 opacity-30 dark:opacity-10">
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute top-40 right-1/4 w-80 h-80 bg-violet-500/20 rounded-full blur-3xl" />
      </div>

      <div className="container relative z-10 pt-32 pb-12 mx-auto px-5 text-center">
        {/* Hero Text Content */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl mx-auto mb-16 sm:mb-20"
        >
          <h1 className="inline-flex flex-wrap items-center justify-center gap-x-4 text-[44px] md:text-[72px] font-[900] leading-[1.05] tracking-[-0.04em] text-foreground mb-6">
            Every Series
            <div className="relative inline-flex align-middle h-[50px] md:h-[80px] w-[40px] md:w-[60px] mx-1">
              <motion.div 
                whileHover={{ rotate: -5, scale: 1.1 }}
                className="absolute inset-0 bg-gradient-to-br from-primary to-violet-600 rounded-xl shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)] overflow-hidden border border-border flex items-center justify-center"
              >
                <span className="text-white font-bold text-lg md:text-2xl">M</span>
              </motion.div>
              <motion.div 
                animate={{ 
                  y: [0, -8, 0],
                  rotate: [6, 12, 6]
                }}
                transition={{ 
                  duration: 4,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="absolute -right-4 -bottom-6 md:-right-8 md:-bottom-10 w-10 md:w-14 h-auto pointer-events-none"
              >
                <BookMarked className="w-10 md:w-14 h-10 md:h-14 text-primary drop-shadow-lg" />
              </motion.div>
            </div>
            One Tracker
          </h1>

          <div className="space-y-2">
            <motion.h3 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.8 }}
              className="text-lg md:text-[22px] font-medium text-muted-foreground max-w-2xl mx-auto leading-relaxed"
            >
              Sync your reading across 20+ sites, discover new favourites,
            </motion.h3>
            <motion.h3 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="text-lg md:text-[22px] font-medium text-muted-foreground max-w-2xl mx-auto leading-relaxed"
            >
              and share progress with friends—all for free.
            </motion.h3>
          </div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            className="mt-12 flex justify-center"
          >
            <a href="/register" className="group relative bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-5 rounded-2xl font-black text-[18px] transition-all transform hover:scale-105 shadow-[0_20px_40px_-10px_rgba(var(--primary),0.3)]">
              Get started for free
              <div className="absolute inset-0 rounded-2xl bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
          </motion.div>
        </motion.div>

        {/* Dashboard Preview */}
        <motion.div 
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1, duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="relative max-w-[1200px] mx-auto group"
        >
          <div className="absolute -inset-1 bg-primary/30 blur-3xl opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity duration-1000" />
          <div className="relative rounded-[32px] overflow-hidden border border-border shadow-[0_40px_100px_-20px_rgba(0,0,0,0.4)] bg-card transition-all duration-700 ease-out hover:scale-[1.02] hover:shadow-[0_60px_120px_-30px_rgba(0,0,0,0.5)]">
            <div className="w-full h-[400px] md:h-[600px] bg-gradient-to-br from-muted via-muted/80 to-muted/60 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <BookMarked className="w-8 h-8 text-primary" />
                </div>
                <p className="text-muted-foreground font-medium">Dashboard Preview</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Subtle bottom fade to next section */}
      <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-background via-background/80 to-transparent z-10" />
    </section>
  );
};

export default HeroSection;
