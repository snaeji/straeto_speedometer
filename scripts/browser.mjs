#!/usr/bin/env node
/**
 * Browser automation helper for dev workflow.
 *
 * Usage:
 *   node scripts/browser.mjs screenshot [file]    — capture viewport to PNG
 *   node scripts/browser.mjs click <selector>      — click an element
 *   node scripts/browser.mjs eval <js>             — run JS in page, print result
 *   node scripts/browser.mjs wait <selector>       — wait for element to appear
 *   node scripts/browser.mjs start-collecting      — click Start Collecting button
 *   node scripts/browser.mjs stop-collecting       — click Stop Collecting button
 *   node scripts/browser.mjs reset                 — kill old browser session, start fresh
 *
 * The script connects to the running dev server at localhost:5173.
 * On first run it launches Chrome; subsequent runs reuse the same page.
 */

import puppeteer from 'puppeteer-core';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = 'http://localhost:5173';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WS_FILE = join(__dirname, '.browser-ws');
const SCREENSHOT_DIR = '/tmp';
const VIEWPORT = { width: 1440, height: 900 };
const DEBUG_PORT = 9222;

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
				await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 15000 });
			}
			return { browser, page };
		} catch {
			// stale endpoint, launch fresh
			try { unlinkSync(WS_FILE); } catch {}
		}
	}

	// Launch Chrome as a detached process with remote debugging
	// Use a separate user-data-dir so it doesn't merge with existing Chrome
	const userDataDir = join(__dirname, '.chrome-profile');
	const { spawn } = await import('child_process');
	const chromeProc = spawn(CHROME_PATH, [
		`--remote-debugging-port=${DEBUG_PORT}`,
		`--user-data-dir=${userDataDir}`,
		`--window-size=${VIEWPORT.width},${VIEWPORT.height + 100}`,
		'--window-position=0,25',
		'--no-first-run',
		'--no-default-browser-check',
		APP_URL,
	], {
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
	const pages = await browser.pages();
	let page = pages.find(p => p.url().includes('localhost:5173'));

	if (!page) {
		page = pages[0] || await browser.newPage();
		await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 15000 });
	}

	return { browser, page };
}

async function main() {
	const [cmd, ...args] = process.argv.slice(2);

	if (!cmd) {
		console.log('Usage: node scripts/browser.mjs <command> [args]');
		console.log('Commands: screenshot, click, eval, wait, start-collecting, stop-collecting, reset');
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

	try {
		switch (cmd) {
			case 'screenshot': {
				const file = args[0] || join(SCREENSHOT_DIR, `straeto-${Date.now()}.png`);
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

			case 'start-collecting': {
				const clicked = await page.evaluate(() => {
					const btn = Array.from(document.querySelectorAll('button'))
						.find(b => b.textContent?.trim() === 'Start Collecting');
					if (btn) { btn.click(); return true; }
					return false;
				});
				console.log(clicked ? 'Started collecting' : 'Button not found (already collecting?)');
				break;
			}

			case 'stop-collecting': {
				const clicked = await page.evaluate(() => {
					const btn = Array.from(document.querySelectorAll('button'))
						.find(b => b.textContent?.trim() === 'Stop Collecting');
					if (btn) { btn.click(); return true; }
					return false;
				});
				console.log(clicked ? 'Stopped collecting' : 'Button not found (not collecting?)');
				break;
			}

			case 'collect-and-screenshot': {
				// Compound: start collecting, wait, take screenshot — all in one call
				const wait = parseInt(args[0]) || 8;
				const outFile = args[1] || join(SCREENSHOT_DIR, `straeto-${Date.now()}.png`);

				// Start collecting if not already
				const started = await page.evaluate(() => {
					const btn = Array.from(document.querySelectorAll('button'))
						.find(b => b.textContent?.trim() === 'Start Collecting');
					if (btn) { btn.click(); return true; }
					return false;
				});
				if (started) console.log('Started collecting');

				await new Promise(r => setTimeout(r, wait * 1000));
				await page.screenshot({ path: outFile, fullPage: false });
				console.log(outFile);
				break;
			}

			case 'switch-mode': {
				// Switch mode and optionally screenshot
				const mode = args[0]; // live, playback, stats, heatmap
				const modeMap = { live: 3, playback: 4, stats: 5, heatmap: 6 };
				const idx = modeMap[mode];
				if (idx == null) { console.error('Usage: switch-mode <live|playback|stats|heatmap>'); process.exit(1); }
				await page.evaluate((i) => document.querySelectorAll('button')[i]?.click(), idx);
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
