#!/bin/bash
# ---------------------------------------------------------
# PHX Tameshigiri - Deployment Script
# ---------------------------------------------------------

echo "🚀 Starting deployment for PHX Tameshigiri..."

# Pull the latest changes from the production branch
echo "⬇️ Pulling latest changes from origin/production..."
git checkout production
git pull origin production

# Rebuild and restart the Docker containers
echo "🐳 Rebuilding Docker image and restarting containers..."
sudo docker compose up -d --build

# Remove unused/dangling docker images to save space
echo "🧹 Cleaning up dangling images..."
sudo docker image prune -f

echo "✅ Deployment completed successfully!"
