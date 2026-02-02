#!/bin/bash

# PM2 Production Setup Script
# Run this ONCE on your production server to enable 24/7 worker auto-restart

set -e

echo "🔧 Setting up PM2 for 24/7 operation..."

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 is not installed. Installing globally..."
    npm install -g pm2
fi

# Generate startup script for systemd
echo "📋 Generating PM2 startup script..."
pm2 startup systemd -u $USER --hp $HOME

# Start applications from ecosystem config
echo "🚀 Starting applications..."
pm2 start ecosystem.config.js --env production

# Save current process list
echo "💾 Saving PM2 process list..."
pm2 save

echo ""
echo "✅ PM2 setup complete!"
echo ""
echo "📊 Current PM2 status:"
pm2 status

echo ""
echo "🔄 Your workers will now auto-restart on:"
echo "   ✓ Application crash"
echo "   ✓ Server reboot"
echo "   ✓ Code deploy (via npm run deploy:prod)"
echo ""
echo "📝 Useful commands:"
echo "   pm2 status          - Check process status"
echo "   pm2 logs            - View all logs"
echo "   pm2 logs mangatrack-workers - View worker logs"
echo "   pm2 monit           - Real-time monitoring"
echo "   pm2 restart all     - Restart all processes"
