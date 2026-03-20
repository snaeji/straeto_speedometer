#!/usr/bin/env node
/**
 * Browser automation helper for dev workflow.
 *
 * Usage:
 *   node scripts/browser.mjs screenshot [file]    — capture viewport to PNG
 *   node scripts/browser.mjs click <selector>      — click an element
 *   node scripts/browser.mjs eval <js>             — run JS in page, print result
 *   node scripts/browser.mjs wait <selector>       — wait for element to appear
 *   node scripts/browser.mjs start-recording       — click Start Recording button
 *   node scripts/browser.mjs stop-recording        — click Stop Recording button
 *   node scripts/browser.mjs reset                 — kill old browser session, start fresh
 *
 * The script connects to the running dev server at localhost:5173.
 * On first run it launches Chrome; subsequent runs reuse the same page.
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = 'http://localhost:5173';
const WS_FILE = join(__dirname, '.browser-ws');

function findChrome() {
	// 1. Explicit env override
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

	// 2. Standard macOS Chrome
	const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
	if (existsSync(macChrome)) return macChrome;

	// 3. Puppeteer's bundled Chrome for Testing
	const cacheDir = join(process.env.HOME || '', '.cache', 'puppeteer', 'chrome');
	if (existsSync(cacheDir)) {
		const versions = fs.readdirSync(cacheDir).filter(d => d.startsWith('mac')).sort().reverse();
		for (const v of versions) {
			const candidates = [
				join(cacheDir, v, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
				join(cacheDir, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
			];
			for (const c of candidates) {
				if (existsSync(c)) return c;
			}
		}
	}

	// 4. Linux/CI fallbacks
	for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
		if (existsSync(p)) return p;
	}

	throw new Error('No Chrome binary found. Set CHROME_PATH env var or install Chrome.');
}

const CHROME_PATH = findChrome();
const SCREENSHOT_DIR = '/tmp';
const VIEWPORT = { width: 1440, height: 900 };
const DEBUG_PORT = 9222;
// Use headed mode only when explicitly requested (HEADED=1)
const HEADLESS = !process.env.HEADED;

async function connectOrLaunch() {
	// Try reconnecting to an existing browser
	if (existsSync(WS_FILE)) {
		const wsEndpoint = readFileSync(WS_FILE, 'utf-8').trim();
		try {
			const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
			const pages = await browser.pages();
			let page = pages.find(p => p.url().includes('localhost:5173'));
			if (!page) {
				page = await browser.newPage();
				await page.setViewport(VIEWPORT);
				await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
			}
			return { browser, page };
		} catch {
			// stale endpoint, launch fresh
			try { unlinkSync(WS_FILE); } catch {}
		}
	}

	// Launch Chrome as a detached process with remote debugging
	const userDataDir = join(__dirname, '.chrome-profile');
	const { spawn } = await import('child_process');
	const chromeArgs = [
		`--remote-debugging-port=${DEBUG_PORT}`,
		`--user-data-dir=${userDataDir}`,
		`--window-size=${VIEWPORT.width},${VIEWPORT.height + 100}`,
		'--no-first-run',
		'--no-default-browser-check',
	];
	if (HEADLESS) {
		chromeArgs.push('--headless=new', '--disable-gpu');
	} else {
		chromeArgs.push('--window-position=0,25');
	}
	chromeArgs.push(APP_URL);

	const chromeProc = spawn(CHROME_PATH, chromeArgs, {
		detached: true,
		stdio: 'ignore',
	});
	chromeProc.unref();

	// Wait for Chrome's debug port to be ready
	let wsEndpoint = '';
	for (let i = 0; i < 30; i++) {
		try {
			const resp = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
			const data = await resp.json();
			wsEndpoint = data.webSocketDebuggerUrl;
			break;
		} catch {
			await new Promise(r => setTimeout(r, 500));
		}
	}

	if (!wsEndpoint) throw new Error('Chrome failed to start');
	writeFileSync(WS_FILE, wsEndpoint);

	const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });

	// Chrome was launched with APP_URL but may still be loading — poll for it
	let page = null;
	for (let i = 0; i < 20; i++) {
		const pages = await browser.pages();
		page = pages.find(p => p.url().includes('localhost:5173'));
		if (page) break;
		await new Promise(r => setTimeout(r, 500));
	}

	if (!page) {
		page = (await browser.pages())[0] || await browser.newPage();
		await page.setViewport(VIEWPORT);
		await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
	}

	// Ensure viewport is set for headless screenshots
	await page.setViewport(VIEWPORT);

	return { browser, page };
}

async function main() {
	const [cmd, ...args] = process.argv.slice(2);

	if (!cmd) {
		console.log('Usage: node scripts/browser.mjs <command> [args]');
		console.log('Commands: screenshot, click, eval, wait, start-recording, stop-recording, play-pause, switch-mode, reset');
		process.exit(0);
	}

	// Reset: kill old session
	if (cmd === 'reset') {
		if (existsSync(WS_FILE)) {
			try {
				const ws = readFileSync(WS_FILE, 'utf-8').trim();
				const browser = await puppeteer.connect({ browserWSEndpoint: ws });
				await browser.close();
			} catch {}
			try { unlinkSync(WS_FILE); } catch {}
		}
		console.log('Browser session reset. Next command will launch fresh.');
		process.exit(0);
	}

	const { browser, page } = await connectOrLaunch();

	// Helper: wait for the app to be visually ready
	async function waitForApp() {
		await page.waitForSelector('button', { timeout: 5000 }).catch(() => {});
		// Let the renderer settle after viewport/navigation changes
		await new Promise(r => setTimeout(r, 500));
	}

	try {
		switch (cmd) {
			case 'screenshot': {
				const file = args[0] || join(SCREENSHOT_DIR, `straeto-${Date.now()}.png`);
				await waitForApp();
				await page.screenshot({ path: file, fullPage: false });
				console.log(file);
				break;
			}

			case 'click': {
				const selector = args[0];
				if (!selector) { console.error('Usage: click <selector>'); process.exit(1); }
				await page.waitForSelector(selector, { timeout: 5000 });
				await page.click(selector);
				console.log(`Clicked: ${selector}`);
				break;
			}

			case 'eval': {
				const js = args.join(' ');
				if (!js) { console.error('Usage: eval <javascript>'); process.exit(1); }
				const result = await page.evaluate((code) => {
					return new Function(`return (${code})`)();
				}, js);
				console.log(JSON.stringify(result, null, 2));
				break;
			}

			case 'wait': {
				const selector = args[0];
				const timeout = parseInt(args[1]) || 10000;
				await page.waitForSelector(selector, { timeout });
				console.log(`Found: ${selector}`);
				break;
			}

			case 'start-recording': {
				const clicked = await page.evaluate(() => {
					const btn = Array.from(document.querySelectorAll('button'))
						.find(b => b.textContent?.trim() === 'Start Recording');
					if (btn) { btn.click(); return true; }
					return false;
				});
				console.log(clicked ? 'Started recording' : 'Button not found (already recording?)');
				break;
			}

			case 'stop-recording': {
				const clicked = await page.evaluate(() => {
					const btn = Array.from(document.querySelectorAll('button'))
						.find(b => b.textContent?.trim() === 'Stop Recording');
					if (btn) { btn.click(); return true; }
					return false;
				});
				console.log(clicked ? 'Stopped recording' : 'Button not found (not recording?)');
				break;
			}

			case 'record-and-screenshot': {
				// Compound: start recording, wait, take screenshot — all in one call
				const wait = parseInt(args[0]) || 8;
				const outFile = args[1] || join(SCREENSHOT_DIR, `straeto-${Date.now()}.png`);

				// Start recording if not already
				const started = await page.evaluate(() => {
					const btn = Array.from(document.querySelectorAll('button'))
						.find(b => b.textContent?.trim() === 'Start Recording');
					if (btn) { btn.click(); return true; }
					return false;
				});
				if (started) console.log('Started recording');

				await new Promise(r => setTimeout(r, wait * 1000));
				await page.screenshot({ path: outFile, fullPage: false });
				console.log(outFile);
				break;
			}

			case 'click-text': {
				// Click a button by its text content
				const text = args.join(' ');
				if (!text) { console.error('Usage: click-text <button text>'); process.exit(1); }
				const found = await page.$$eval('button', (buttons, searchText) => {
					const btn = buttons.find(b => b.textContent?.trim() === searchText);
					if (btn) { btn.click(); return true; }
					return false;
				}, text);
				console.log(found ? `Clicked: "${text}"` : `Button "${text}" not found`);
				break;
			}

		case 'play-pause': {
				const clicked = await page.evaluate(() => {
					// Find the play/pause button by looking for transport-control SVGs in the bottom playback bar
					const btns = Array.from(document.querySelectorAll('button'));
					const playBtn = btns.find(b => {
						const svg = b.querySelector('svg');
						if (!svg) return false;
						// Play icon has "M8 5v14l11-7z", Pause icon has "M6 19h4V5H6v14zm8-14v14h4V5h-4z"
						const paths = b.querySelectorAll('path');
						return Array.from(paths).some(p => {
							const d = p.getAttribute('d') || '';
							return d.includes('8 5v14') || d.includes('6 4h4v16');
						});
					});
					if (playBtn) { playBtn.click(); return true; }
					return false;
				});
				console.log(clicked ? 'Toggled play/pause' : 'Play button not found');
				break;
			}

		case 'switch-mode': {
				// Switch mode and optionally screenshot
				const mode = args[0]; // live, playback, stats, heatmap
				const modeNames = { live: 'Live', playback: 'Playback', stats: 'Stats', heatmap: 'Heatmap' };
				const label = modeNames[mode];
				if (!label) { console.error('Usage: switch-mode <live|playback|stats|heatmap>'); process.exit(1); }
				await page.evaluate((name) => {
					const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === name);
					if (btn) btn.click();
				}, label);
				console.log(`Switched to ${mode}`);

				if (args[1]) {
					await new Promise(r => setTimeout(r, 1000));
					await page.screenshot({ path: args[1], fullPage: false });
					console.log(args[1]);
				}
				break;
			}

			default:
				console.error(`Unknown command: ${cmd}`);
				process.exit(1);
		}
	} finally {
		browser.disconnect();
		process.exit(0);
	}
}

main().catch(err => {
	console.error(err.message);
	process.exit(1);
});
