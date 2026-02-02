#!/bin/bash

# Deployment script for Vercel/CI
set -e

echo "🚀 Starting deployment pipeline..."

# 1. Generate Prisma Client (NO database connection required)
echo "🏗️  Generating Prisma Client..."
if npx prisma generate; then
  echo "✅ Prisma Client generated."
else
  echo "❌ ERROR: Prisma generation failed."
  exit 1
fi

# 2. Build Application
echo "📦 Building application..."
if next build; then
  echo "✨ Build completed successfully!"
else
  echo "❌ ERROR: Next.js build failed."
  exit 1
fi

echo "🏁 Deployment pipeline finished."
