import puppeteer from 'puppeteer-core';
import { readFileSync } from 'fs';

const ws = readFileSync('scripts/.browser-ws', 'utf-8').trim();
const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
const pages = await browser.pages();
const page = pages.find(p => p.url().includes('localhost:5173'));
if (!page) { console.log('no page'); process.exit(1); }

// Reinstall console capture
await page.evaluate(() => {
  window.__captureLogs = [];
  const orig = console.log;
  console.log = (...args) => {
    window.__captureLogs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    orig(...args);
  };
});

// Move mouse over chart canvas
await page.mouse.move(886, 780);
await new Promise(r => setTimeout(r, 500));
await page.mouse.move(700, 780);
await new Promise(r => setTimeout(r, 500));
await page.mouse.move(600, 780);
await new Promise(r => setTimeout(r, 500));

const logs = await page.evaluate(() => window.__captureLogs || []);
console.log(JSON.stringify(logs.slice(-20), null, 2));

browser.disconnect();
