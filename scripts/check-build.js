const fs = require('fs');
const path = require('path');

const NEXT_DIR = path.join(process.cwd(), '.next');
const BUILD_ID_FILE = path.join(NEXT_DIR, 'BUILD_ID');

function checkBuild() {
  console.log('[Startup Guard] Checking for production build...');

  if (!fs.existsSync(NEXT_DIR)) {
    console.error('❌ FATAL: .next directory not found.');
    console.error('   Run "npm run build" before starting the production server.');
    process.exit(1);
  }

  if (!fs.existsSync(BUILD_ID_FILE)) {
    console.error('❌ FATAL: .next/BUILD_ID not found. Build may be corrupted.');
    console.error('   Run "npm run build" to regenerate.');
    process.exit(1);
  }

  const buildId = fs.readFileSync(BUILD_ID_FILE, 'utf8').trim();
  console.log(`✅ Production build found (BUILD_ID: ${buildId})`);
}

checkBuild();
