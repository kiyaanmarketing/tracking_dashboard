#!/bin/bash
# Run once after codespace restart to install Puppeteer Chrome dependencies
sudo apt-get install -y \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libnss3 \
  libnspr4 \
  libpango-1.0-0 \
  libcairo2 \
  libcups2t64 \
  libxkbcommon0 \
  libdrm2 \
  libgbm1 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libx11-xcb1 \
  libasound2t64

echo "✅ Puppeteer dependencies installed. Now run: npm start"
