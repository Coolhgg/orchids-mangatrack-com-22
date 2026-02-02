#!/bin/bash
set -e

# Load environment variables if .env exists
if [ -f .env ]; then
  # Use a more robust way to load .env
  set -a
  source .env
  set +a
fi

echo "🛑 Stopping all processes..."
npx pm2 stop ecosystem.config.js || true

echo "🧹 Clearing stale Redis locks..."
# Use redis-cli if available, otherwise skip
if command -v redis-cli &> /dev/null; then
  # Pattern matching based on the checklist
  redis-cli --scan --pattern "mangatrack:*:lock:*" | xargs -r redis-cli DEL
  redis-cli --scan --pattern "mangatrack:*:workers:global" | xargs -r redis-cli DEL
  redis-cli --scan --pattern "mangatrack:*:scheduler:lock" | xargs -r redis-cli DEL
  echo "✅ Redis locks cleared."
else
  # Try to use a node script to clear redis if redis-cli is not available
  echo "⚠️  redis-cli not found, attempting lock clearance via node..."
  npx tsx -e "
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    async function clear() {
      const patterns = ['mangatrack:*:lock:*', 'mangatrack:*:workers:global', 'mangatrack:*:scheduler:lock'];
      for (const pattern of patterns) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
          console.log('Cleared ' + keys.length + ' keys for ' + pattern);
        }
      }
      process.exit(0);
    }
    clear().catch(err => { console.error(err); process.exit(1); });
  " || echo "❌ Failed to clear Redis locks via node."
fi

echo "📂 Cleaning up logs..."
rm -rf logs/*.log
mkdir -p logs

echo "🏗️  Rebuilding project..."
npm run build

echo "🚀 Starting API..."
npx pm2 start ecosystem.config.js --only mangatrack-api

# Wait for API to be ready
echo "Waiting for API to initialize..."
sleep 5

echo "🚀 Starting Workers (includes Scheduler)..."
npx pm2 start ecosystem.config.js --only mangatrack-workers

echo "📊 Current PM2 Status:"
npx pm2 status

echo "✅ Rebuild and restart complete. Running verification simulation..."

# Verification Simulation
echo "🔍 1. Simulating Search..."
npx tsx scripts/test-search.ts "One Piece"

echo "📥 2. Simulating Import (Draft/Check)..."
# Using curl as specified in the checklist
curl -s -X POST http://localhost:3002/api/library/import \
  -H "Content-Type: application/json" \
  -d '{"source": "mangadex", "url": "https://mangadex.org/title/ed569e2a-1436-4074-a63e-7973715f5a8a"}' | grep -q "id" && echo "✅ Import job accepted." || echo "❌ Import job failed."

echo "🔄 3. Simulating Sync Job..."
npx tsx scripts/simulate-sync.ts --force

echo "🏁 Verification complete. Check logs/ for detailed output."
