#!/bin/bash

# Script to debug n8n-nodes-upload-post node with auto-reload
# Usage: ./debug.sh [--watch]

set -e  # Exit if any error occurs

# Function that executes the complete build and restart process
build_and_restart() {
    echo "📦 Building project..."
    npm run build

    echo "🔗 Linking package..."
    npm link

    echo "📂 Changing to ~/.n8n/custom directory..."
    mkdir -p ~/.n8n/custom
    cd ~/.n8n/custom

    if [ ! -f package.json ]; then
        echo "📄 Initializing package.json in ~/.n8n/custom..."
        npm init -y
    fi

    echo "🛑 Stopping n8n if running..."
    pkill -f "n8n start" || true  # Do not fail if no process is running

    echo "🔗 Linking n8n-nodes-upload-post in ~/.n8n/custom..."
    npm link n8n-nodes-upload-post

    echo "🎯 Starting n8n..."
    n8n start &
}

# Get the absolute path of the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$1" = "--watch" ]; then
    # Watch mode: only execute build_and_restart
    build_and_restart
else
    # Initial mode: execute build_and_restart and then start the watcher
    echo "🚀 Starting debug process with auto-reload..."
    build_and_restart

    # Use nodemon to watch for changes in TypeScript files
    echo "👀 Watching for changes in .ts files..."
    cd "$PROJECT_DIR"  # Return to project directory to use nodemon
    npx nodemon \
        --watch "nodes/**/*.ts" \
        --watch "credentials/**/*.ts" \
        --ext ts \
        --exec "$PROJECT_DIR/debug.sh --watch"
fi
