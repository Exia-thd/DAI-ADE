#!/usr/bin/env node
/**
 * Render the application icon and write build/icon.ico.
 *
 *   npx electron scripts/make-icon.js
 *
 * No image library: Electron renders the mark and `nativeImage` resizes it, and
 * the .ico is assembled here. A Vista-era ICO may hold PNG data directly, so
 * the container is a 6-byte header plus one 16-byte directory entry per size —
 * small enough to write correctly by hand and one fewer dependency to keep
 * building on Windows.
 *
 * The mark is the product's own idea: a small core with structure assembled
 * around it. The core never grows; the rings are what you build.
 */

'use strict';

const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'build');
const SIZES = [256, 128, 64, 48, 32, 16];

const MARK = `
<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 256px; height: 256px; background: transparent; }
  svg { display: block; }
</style>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b74dd"/>
      <stop offset="1" stop-color="#0a3f8f"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="256" height="256" rx="56" fill="url(#bg)"/>
  <g fill="none" stroke="#ffffff" stroke-linecap="round">
    <circle cx="128" cy="128" r="34" stroke-width="0" fill="#ffffff" opacity=".97"/>
    <circle cx="128" cy="128" r="62" stroke-width="10" opacity=".85"
            stroke-dasharray="150 60" transform="rotate(-35 128 128)"/>
    <circle cx="128" cy="128" r="88" stroke-width="9" opacity=".6"
            stroke-dasharray="190 90" transform="rotate(115 128 128)"/>
  </g>
</svg>
`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256, height: 256, show: false, frame: false, transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(MARK));
  win.webContents.setFrameRate(30);
  win.setContentSize(256, 256);
  await new Promise((r) => setTimeout(r, 1200));
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 400));

  const base = await win.webContents.capturePage();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pngs = SIZES.map((size) => ({
    size,
    data: (size === base.getSize().width ? base : base.resize({ width: size, height: size, quality: 'best' })).toPNG(),
  }));

  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), pngs[0].data);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(pngs));

  console.log(`build/icon.png  ${base.getSize().width}x${base.getSize().height}`);
  console.log(`build/icon.ico  ${SIZES.join(', ')}`);
  app.exit(0);
});

/** ICONDIR + one ICONDIRENTRY per image, then the PNG payloads. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    // 256 is stored as 0: the field is one byte, so 256 does not fit.
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2);                // palette entries
    entry.writeUInt8(0, 3);                // reserved
    entry.writeUInt16LE(1, 4);             // colour planes
    entry.writeUInt16LE(32, 6);            // bits per pixel
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}
