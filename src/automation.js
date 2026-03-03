const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const config = require('./config');
const logger = require('./logger');
const path = require('path');
const { randomDelay } = require('./utils/time');

async function runProfileUpdate() {
  logger.info('Starting Naukri Profile Update automation...');
  let browser;
  try {
    browser = await chromium.launch({
      headless: config.headless,
      args: ['--start-maximized']
    });

    const context = await browser.newContext({
      viewport: null, // use window size
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    
    const page = await context.newPage();

    // 1. Navigate to Login Page
    logger.info('Navigating to login page...');
    await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded' });
    await randomDelay(2000, 4000);

    // 2. Login
    logger.info('Entering credentials...');
    await page.fill('#usernameField', config.naukriEmail);
    await randomDelay();
    await page.fill('#passwordField', config.naukriPassword);
    await randomDelay(500, 1500);
    
    // Check if there is a common login button selector and click it
    // Using a more exact selector to avoid matching "Use OTP to Login" button
    const loginButton = page.locator('button[type="submit"].blue-btn:has-text("Login")');
    await loginButton.click();
    
    // Wait for navigation after login (could be a redirect to homepage or user dashboard)
    logger.info('Waiting for login to complete...');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => logger.warn('Network idle timeout after login, proceeding anyway...'));
    await randomDelay(3000, 5000);

    // Check if the current URL looks logged in, or if there's an error message
    if (page.url().includes('login')) {
        // Look for error message on login page
        const errorMsg = await page.locator('.err-msg').count() > 0 ? await page.locator('.err-msg').first().textContent() : 'Unknown login error';
        throw new Error(`Login failed. Still on login page. Possible Error: ${errorMsg}`);
    }
    
    // 3. Navigate to Profile
    logger.info('Navigating to profile page...');
    await page.goto('https://www.naukri.com/mnjuser/profile', { waitUntil: 'domcontentloaded' });
    await randomDelay(3000, 5000);

    // 4. Implement Update logic
    logger.info('Applying profile update strategy: Key Skills Toggle...');
    try {
        logger.info('Attempting to find Key skills section...');
        
        // Find the "Key skills" section and its edit icon
        let editIcon = null;
        
        // Locate headings that exactly match 'Key skills'
        const skillsHeadings = page.locator('*:has-text("Key skills")').filter({ hasText: /^Key skills$/ });
        const headingCount = await skillsHeadings.count();
        
        for (let i = 0; i < headingCount; i++) {
            const heading = skillsHeadings.nth(i);
            if (await heading.isVisible()) {
                const potentialIcon = heading.locator('xpath=ancestor::div[1]//span[contains(@class, "edit") or contains(@class, "icon-edit")] | ancestor::div[2]//span[contains(@class, "edit") or contains(@class, "icon-edit")] | ancestor::div[3]//span[contains(@class, "edit") or contains(@class, "icon-edit")]').first();
                if (await potentialIcon.count() > 0) {
                    editIcon = potentialIcon;
                    break;
                }
            }
        }
        
        // Fallback for classic layout
        if (!editIcon || await editIcon.count() === 0) {
            editIcon = page.locator('.widgetHead:has-text("Key skills")').locator('..').locator('.edit').first();
        }

        if (editIcon && await editIcon.count() > 0) {
            logger.info('Found Key skills edit icon! Clicking...');
            await editIcon.click();
            await randomDelay(2000, 3000);
            
            // Wait for modal input to be visible (Naukri usually uses .sugInp or an input with 'skill' placeholder)
            const skillInput = page.locator('input[placeholder*="skills" i], input[id*="skill" i], .sugInp, input[type="text"]').first();
            await skillInput.waitFor({ state: 'visible', timeout: 5000 });
            
            // Delete the 'Python' skill chip if it exists to safely toggle it without duplication errors
            // Look for a chip containing 'Python' and its closing/delete 'X' button
            const pythonChip = page.locator('span, div, li').filter({ hasText: /^Python$/i }).locator('xpath=ancestor-or-self::*//i[contains(@class,"cross") or contains(@class,"remove") or text()="x" or text()="X"] | ancestor-or-self::*//span[contains(@class,"cross") or contains(@class,"remove")]').first();
            
            if (await pythonChip.count() > 0 && await pythonChip.isVisible()) {
                 logger.info('Found existing Python skill chip. Removing it first...');
                 await pythonChip.click();
                 await randomDelay(1000, 2000);
            }
            
            logger.info('Adding Python skill...');
            await skillInput.fill('');
            await skillInput.fill('Python');
            await randomDelay(1000, 2000);
            
            // Naukri skills usually require pressing Enter to select from the dropdown
            await skillInput.press('Enter');
            await randomDelay(1500, 2500);
            
            logger.info('Clicking Save...');
            const saveBtn = page.locator('button').filter({ hasText: /^Save$/ }).filter({ state: 'visible' }).first();
            await saveBtn.click();
            
            await randomDelay(3000, 5000);
            logger.info('Successfully executed Key Skills update.');
        } else {
            throw new Error('Could not find Key skills edit icon.');
        }
    } catch (e) {
        logger.warn(`Key Skills update failed: ${e.message}`);
        throw new Error(`Automation step failed: ${e.message}`);
    }

    // Wait for success toast or modal to close
    logger.info('Waiting for save to confirm...');
    await randomDelay(3000, 5000);

  } catch (error) {
    logger.error(`Automation failed: ${error.message}`);
    if (browser) {
      const contexts = browser.contexts();
      if (contexts.length > 0) {
        const pages = contexts[0].pages();
        if (pages.length > 0) {
            const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
            const screenshotPath = path.join(__dirname, `../logs/error-${dateStr}.png`);
            await pages[0].screenshot({ path: screenshotPath });
            logger.info(`Saved error screenshot to ${screenshotPath}`);
        }
      }
    }
    throw error; // Rethrow to be caught by scheduler for retries
  } finally {
    if (browser) {
      await browser.close();
      logger.info('Browser closed.');
    }
  }
}

module.exports = {
  runProfileUpdate
};
