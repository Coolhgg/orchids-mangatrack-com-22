#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const criticalModules = [
  'next',
  '@supabase/ssr',
  '@supabase/supabase-js',
  'react',
  'react-dom',
  '@prisma/client'
];

const nodeModulesPath = path.join(process.cwd(), 'node_modules');
const nextCachePath = path.join(process.cwd(), '.next');

function checkModule(moduleName) {
  const modulePath = path.join(nodeModulesPath, ...moduleName.split('/'));
  const packageJsonPath = path.join(modulePath, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    return { exists: false, reason: 'package.json missing' };
  }
  
  // For @supabase/ssr, also check dist folder exists
  if (moduleName === '@supabase/ssr') {
    const distPath = path.join(modulePath, 'dist');
    if (!fs.existsSync(distPath)) {
      return { exists: false, reason: 'dist folder missing' };
    }
  }
  
  // For next, check that the bin exists
  if (moduleName === 'next') {
    const binPath = path.join(modulePath, 'dist', 'bin', 'next');
    if (!fs.existsSync(binPath)) {
      return { exists: false, reason: 'next binary missing' };
    }
  }
  
  return { exists: true };
}

function clearNextCache() {
  if (fs.existsSync(nextCachePath)) {
    console.log('[ensure-deps] Clearing .next cache to prevent stale state...');
    try {
      fs.rmSync(nextCachePath, { recursive: true, force: true });
      console.log('[ensure-deps] .next cache cleared');
    } catch (error) {
      console.warn('[ensure-deps] Warning: Could not clear .next cache:', error.message);
    }
  }
}

function clearErrorLogs() {
  const errorLogPath = '/tmp/dev-server.err.log';
  try {
    if (fs.existsSync(errorLogPath)) {
      const stats = fs.statSync(errorLogPath);
      // Clear if larger than 100KB to prevent stale error confusion
      if (stats.size > 100 * 1024) {
        fs.writeFileSync(errorLogPath, '');
        console.log('[ensure-deps] Cleared large error log file');
      }
    }
  } catch (e) {
    // Ignore errors clearing log
  }
}

function main() {
  console.log('[ensure-deps] Checking critical modules...');
  
  const issues = [];
  for (const mod of criticalModules) {
    const result = checkModule(mod);
    if (!result.exists) {
      issues.push({ module: mod, reason: result.reason });
    }
  }
  
  if (issues.length > 0) {
    console.log('[ensure-deps] Issues detected:');
    issues.forEach(({ module, reason }) => {
      console.log(`  - ${module}: ${reason}`);
    });
    
    console.log('[ensure-deps] Running bun install to restore...');
    clearNextCache();
    clearErrorLogs();
    
    try {
      execSync('bun install', { stdio: 'inherit', cwd: process.cwd() });
      console.log('[ensure-deps] Dependencies restored successfully');
    } catch (error) {
      console.error('[ensure-deps] Failed to restore dependencies:', error.message);
      process.exit(1);
    }
  } else {
    console.log('[ensure-deps] All critical modules present and valid');
  }
}

main();
