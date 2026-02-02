#!/usr/bin/env node
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = process.cwd();
const NODE_MODULES = path.join(ROOT, 'node_modules');
const LOCK_FILE = path.join(ROOT, '.watchdog.lock');
const STATE_FILE = path.join(ROOT, '.watchdog.state');
const BUN_CACHE = path.join(os.homedir(), '.bun', 'install', 'cache');

const PHANTOM_DIRECTORIES = [
  'home',
  'tmp',
  'var'
];

const CRITICAL_CHECKS = [
  { path: 'next/dist/bin/next', name: 'next' },
  { path: '@supabase/ssr/dist/main/index.js', name: '@supabase/ssr' },
  { path: '@supabase/supabase-js/dist/main/index.js', name: '@supabase/supabase-js' },
  { path: 'react/package.json', name: 'react' },
  { path: 'react-dom/package.json', name: 'react-dom' },
  { path: '@prisma/client/package.json', name: '@prisma/client' }
];

const FORBIDDEN_DEPS = [
  '@number-flow/react',
  'number-flow',
  '@react-three/fiber',
  '@react-three/drei',
  'three',
  'three-globe',
  '@types/three',
  'cobe'
];

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[watchdog ${ts}] ${msg}`);
}

function isLocked() {
  if (!fs.existsSync(LOCK_FILE)) return false;
  try {
    const lockTime = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
    if (Date.now() - lockTime > 120000) {
      fs.unlinkSync(LOCK_FILE);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function setLock() {
  fs.writeFileSync(LOCK_FILE, String(Date.now()));
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function checkModulesHealth() {
  if (!fs.existsSync(NODE_MODULES)) {
    return { healthy: false, issues: ['node_modules missing entirely'] };
  }

  const issues = [];
  for (const check of CRITICAL_CHECKS) {
    const fullPath = path.join(NODE_MODULES, check.path);
    if (!fs.existsSync(fullPath)) {
      issues.push(`${check.name}: missing ${check.path}`);
    }
  }

  const reactPkg = path.join(NODE_MODULES, 'react/package.json');
  const reactDomPkg = path.join(NODE_MODULES, 'react-dom/package.json');
  if (fs.existsSync(reactPkg) && fs.existsSync(reactDomPkg)) {
    try {
      const reactVer = JSON.parse(fs.readFileSync(reactPkg, 'utf8')).version;
      const reactDomVer = JSON.parse(fs.readFileSync(reactDomPkg, 'utf8')).version;
      if (reactVer !== reactDomVer) {
        issues.push(`react version mismatch: react@${reactVer} vs react-dom@${reactDomVer}`);
      }
    } catch (e) {
      issues.push('Failed to read react versions');
    }
  }

  for (const dep of FORBIDDEN_DEPS) {
    const depPath = path.join(NODE_MODULES, dep);
    if (fs.existsSync(depPath)) {
      issues.push(`phantom dep detected: ${dep} (not in package.json but exists)`);
    }
  }

  const phantomDirs = checkPhantomDirectories();
  for (const dir of phantomDirs) {
    issues.push(`phantom directory detected: ${dir}/ (causes Turbopack path resolution issues)`);
  }

  return { healthy: issues.length === 0, issues };
}

function purgeForbiddenFromCache() {
    if (!fs.existsSync(BUN_CACHE)) return;
    
    for (const dep of FORBIDDEN_DEPS) {
      const cachePath = path.join(BUN_CACHE, dep);
      if (fs.existsSync(cachePath)) {
        try {
          fs.rmSync(cachePath, { recursive: true, force: true });
          log(`Purged from bun cache: ${dep}`);
        } catch {}
      }
      // Also check scoped packages (@org/pkg format)
      if (dep.startsWith('@')) {
        const [scope, name] = dep.split('/');
        const scopedPath = path.join(BUN_CACHE, scope);
        if (fs.existsSync(scopedPath)) {
          const pkgPath = path.join(scopedPath, name);
          if (fs.existsSync(pkgPath)) {
            try {
              fs.rmSync(pkgPath, { recursive: true, force: true });
              log(`Purged scoped package from cache: ${dep}`);
            } catch {}
          }
        }
      }
    }
}

function checkPhantomDirectories() {
  const phantomsFound = [];
  for (const dir of PHANTOM_DIRECTORIES) {
    const dirPath = path.join(ROOT, dir);
    if (fs.existsSync(dirPath)) {
      try {
        const stat = fs.statSync(dirPath);
        if (stat.isDirectory()) {
          phantomsFound.push(dir);
        }
      } catch {}
    }
  }
  return phantomsFound;
}

function removePhantomDirectories() {
  const phantoms = checkPhantomDirectories();
  for (const dir of phantoms) {
    const dirPath = path.join(ROOT, dir);
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      log(`Removed phantom directory: ${dir}/`);
    } catch (e) {
      log(`Failed to remove phantom directory ${dir}/: ${e.message}`);
    }
  }
  return phantoms.length;
}

function repairModules() {
  if (isLocked()) {
    log('Another repair in progress, skipping');
    return false;
  }

  setLock();
  try {
    log('Repairing node_modules...');
    
    // Step 0: Remove phantom directories (causes Turbopack issues)
    const phantomDirsRemoved = removePhantomDirectories();
    if (phantomDirsRemoved > 0) {
      log(`Removed ${phantomDirsRemoved} phantom director(y/ies)`);
    }
    
    // Step 1: Clear build cache
    try {
      fs.rmSync(path.join(ROOT, '.next'), { recursive: true, force: true });
      log('Cleared .next cache');
    } catch {}

    // Step 2: Remove old binary lock file
    try {
      fs.rmSync(path.join(ROOT, 'bun.lockb'), { force: true });
      log('Removed bun.lockb');
    } catch {}

    // Step 3: Remove phantom deps from node_modules
    for (const dep of FORBIDDEN_DEPS) {
      const depPath = path.join(NODE_MODULES, dep);
      if (fs.existsSync(depPath)) {
        try {
          fs.rmSync(depPath, { recursive: true, force: true });
          log(`Removed phantom dep: ${dep}`);
        } catch {}
      }
    }

    // Step 4: CRITICAL - Purge forbidden deps from bun's global cache
    // This prevents bun install --force from re-fetching them
    purgeForbiddenFromCache();

    // Step 5: Reinstall
    execSync('bun install --force', { 
      cwd: ROOT, 
      stdio: 'inherit',
      timeout: 120000
    });
    
    // Step 6: Post-install verification - remove any phantom deps that snuck back
    let phantomsRemoved = false;
    for (const dep of FORBIDDEN_DEPS) {
      const depPath = path.join(NODE_MODULES, dep);
      if (fs.existsSync(depPath)) {
        try {
          fs.rmSync(depPath, { recursive: true, force: true });
          log(`Post-install cleanup: removed ${dep}`);
          phantomsRemoved = true;
        } catch {}
      }
    }
    
    if (phantomsRemoved) {
      // Also purge from cache again to prevent future reinstalls
      purgeForbiddenFromCache();
    }
    
    log('Repair complete');
    
    const recheck = checkModulesHealth();
    if (!recheck.healthy) {
      log('WARNING: Issues persist after repair: ' + recheck.issues.join(', '));
      return false;
    }
    
    return true;
  } catch (e) {
    log('Repair failed: ' + e.message);
    return false;
  } finally {
    releaseLock();
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastCheck: 0, repairCount: 0, lastRepair: 0 };
  }
}

function main() {
  const command = process.argv[2];
  
  if (command === 'check') {
    const result = checkModulesHealth();
    if (result.healthy) {
      log('All modules healthy');
      process.exit(0);
    } else {
      log('Issues found: ' + result.issues.join(', '));
      process.exit(1);
    }
  }
  
  if (command === 'repair') {
    const result = checkModulesHealth();
    if (result.healthy) {
      log('Modules already healthy, no repair needed');
      process.exit(0);
    }
    const success = repairModules();
    process.exit(success ? 0 : 1);
  }
  
  if (command === 'ensure') {
    const result = checkModulesHealth();
    if (!result.healthy) {
      log('Issues detected: ' + result.issues.join(', '));
      const success = repairModules();
      if (!success) {
        log('FATAL: Could not repair modules');
        process.exit(1);
      }
    }
    log('Modules ready');
    process.exit(0);
  }
  
  if (command === 'clean-phantoms') {
    const phantoms = checkPhantomDirectories();
    if (phantoms.length === 0) {
      log('No phantom directories found');
      process.exit(0);
    }
    log(`Found phantom directories: ${phantoms.join(', ')}`);
    const removed = removePhantomDirectories();
    log(`Removed ${removed} phantom director(y/ies)`);
    process.exit(0);
  }
  
  if (command === 'watch') {
    log('Starting watchdog daemon...');
    const CHECK_INTERVAL = 30000;
    
    const check = () => {
      const state = loadState();
      const result = checkModulesHealth();
      
      state.lastCheck = Date.now();
      
      if (!result.healthy) {
        log('Corruption detected: ' + result.issues.join(', '));
        
        if (Date.now() - state.lastRepair < 60000) {
          log('Too soon since last repair, waiting...');
          saveState(state);
          return;
        }
        
        const success = repairModules();
        state.repairCount++;
        state.lastRepair = Date.now();
        
        if (!success && state.repairCount > 5) {
          log('FATAL: Repeated repair failures. Manual intervention required.');
        }
      }
      
      saveState(state);
    };
    
    check();
    setInterval(check, CHECK_INTERVAL);
    return;
  }
  
  console.log('Usage: node scripts/watchdog.js <check|repair|ensure|watch|clean-phantoms>');
  console.log('  check          - Check module health');
  console.log('  repair         - Force repair modules');
  console.log('  ensure         - Check and repair if needed');
  console.log('  watch          - Start continuous monitoring');
  console.log('  clean-phantoms - Remove phantom directories (home/, tmp/, var/)');
  process.exit(1);
}

main();
