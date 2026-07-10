const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Capture console logs
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  // Wait for login and login
  await page.waitForSelector('input[placeholder="Username"]');
  await page.type('input[placeholder="Username"]', 'andi_trade');
  await page.type('input[placeholder="Password"]', 'andi_trade');
  await page.click('button.auth-btn');

  // Wait for Order Book to appear
  await page.waitForSelector('.ob-row', { timeout: 5000 });

  // Type price and lot
  const priceInput = await page.$('input.qo-input[type="number"]');
  // the first input is price, second is lot. We need to find them exactly.
  const inputs = await page.$$('input.qo-input[type="number"]');
  
  await inputs[0].click({ clickCount: 3 });
  await inputs[0].type('5004');
  
  await inputs[1].click({ clickCount: 3 });
  await inputs[1].type('10');

  // Click BUY
  console.log('Clicking BUY button...');
  await page.click('#btn-buy');

  // Wait a bit for WS response
  await new Promise(r => setTimeout(r, 2000));
  
  // Check if there is any error toast
  const errorToast = await page.$('.qo-error');
  if (errorToast) {
    const text = await page.evaluate(el => el.textContent, errorToast);
    console.log('ERROR TOAST VISIBLE:', text);
  } else {
    console.log('No error toast visible.');
  }

  // Check my orders
  const myOrders = await page.$$('.mo-row');
  console.log(`Number of active orders in My Orders panel: ${myOrders.length}`);
  
  await browser.close();
})();
