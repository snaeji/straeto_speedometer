import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
const pages = await browser.pages();
const page = pages[0];
await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });

// Click Demo
await page.$$eval('button', btns => {
	const b = btns.find(b => b.textContent.trim() === 'Demo');
	if (b) b.click();
});
console.log('Demo started, waiting 20s for data...');
await new Promise(r => setTimeout(r, 20000));

// Click a bus marker
const markers = await page.$$('.bus-marker');
console.log(`Found ${markers.length} bus markers`);
if (markers.length > 5) {
	await markers[5].click();
	console.log('Clicked bus marker');
}
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: 'docs/speed-analysis/bus-selected.png' });

// Wait for more chart data
console.log('Waiting 20s for chart data...');
await new Promise(r => setTimeout(r, 20000));
await page.screenshot({ path: 'docs/speed-analysis/bus-chart.png' });

await browser.close();
console.log('Done');
