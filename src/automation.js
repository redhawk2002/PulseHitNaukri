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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--start-maximized'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // 1. Inject saved session cookies to bypass login (avoids OTP on new IPs)
    const rawCookies = process.env.NAUKRI_COOKIES;
    if (!rawCookies) {
      throw new Error('NAUKRI_COOKIES env var is not set. Please export cookies from your browser and set this variable in Render.');
    }
    let cookies;
    try {
      cookies = JSON.parse(rawCookies);
    } catch (e) {
      throw new Error(`Failed to parse NAUKRI_COOKIES: ${e.message}`);
    }

    // Map cookie-editor format to Playwright format
    const playwrightCookies = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: c.expirationDate ? Math.floor(c.expirationDate) : -1,
      httpOnly: c.httpOnly || false,
      secure: c.secure || false,
      sameSite: (() => {
        const s = (c.sameSite || '').toLowerCase();
        if (s === 'strict') return 'Strict';
        if (s === 'lax') return 'Lax';
        return 'None';
      })()
    }));

    await context.addCookies(playwrightCookies);
    logger.info(`Injected ${playwrightCookies.length} session cookies. Skipping login form.`);

    const page = await context.newPage();

    // 2. Verify session is valid by navigating to the user homepage
    logger.info('Verifying session by navigating to Naukri homepage...');
    await page.goto('https://www.naukri.com/mnjuser/homepage', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 3000);

    if (page.url().includes('login')) {
      throw new Error('Session cookies are expired or invalid. Please re-export cookies from your browser and update NAUKRI_COOKIES in Render.');
    }
    logger.info('Session verified. Logged in successfully via cookies.');
    
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
            await randomDelay(3000, 4000);
            
            const allChips = page.locator('span, div, a').filter({ hasText: /^Python$/i });
            const chipCount = await allChips.count();
            
            if (chipCount > 0) {
                logger.info(`Found ${chipCount} element(s) matching "Python". Attempting removal...`);
                for (let i = 0; i < chipCount; i++) {
                    const chip = allChips.nth(i);
                    try {
                        if (await chip.isVisible()) {
                            const closeBtn = chip.locator('xpath=./following-sibling::*[1] | ..//*[contains(@class,"close") or contains(@class,"cross") or contains(@class,"remove") or contains(@class,"del")]').first();
                            
                            if (await closeBtn.count() > 0 && await closeBtn.isVisible()) {
                                logger.info('Found delete (✕) button for Python chip. Clicking...');
                                await closeBtn.click();
                                await randomDelay(1000, 2000);
                                logger.info('Python chip removed successfully.');
                                break;
                            } else {
                                const xText = chip.locator('xpath=..//span[text()="×" or text()="✕" or text()="x" or text()="X"]').first();
                                if (await xText.count() > 0) {
                                    logger.info('Found ✕ text element. Clicking...');
                                    await xText.click();
                                    await randomDelay(1000, 2000);
                                    logger.info('Python chip removed successfully.');
                                    break;
                                }
                            }
                        }
                    } catch (e) {
                        logger.warn(`Could not remove chip at index ${i}: ${e.message}`);
                    }
                }
            } else {
                logger.info('No existing "Python" chip found. Skipping removal pass.');
            }
            
            // Save after removal (even if Python wasn't found, save to close the modal)
            logger.info('PASS 1: Clicking Save...');
            let saveBtn = page.getByRole('button', { name: 'Save' });
            if (await saveBtn.count() > 0 && await saveBtn.isVisible()) {
                await saveBtn.click();
            } else {
                const fallbackSave = page.locator('button:has-text("Save")').filter({ state: 'visible' }).last();
                await fallbackSave.click();
            }
            
            await randomDelay(5000, 7000);
            logger.info('PASS 1: Save completed. Python removed from profile.');
            
            // ============================================================
            // PASS 2: Re-open Key Skills popup and Add "Python" back
            // ============================================================
            logger.info('=== PASS 2: Re-adding Python skill ===');
            
            // Re-navigate to ensure we're on the profile page (modal might have closed)
            await page.goto('https://www.naukri.com/mnjuser/profile?id=&altresid', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await randomDelay(3000, 5000);
            
            // Re-find the edit icon
            let editIcon2 = null;
            const skillsHeadings2 = page.locator('*:has-text("Key skills")').filter({ hasText: /^Key skills$/ });
            const headingCount2 = await skillsHeadings2.count();
            
            for (let i = 0; i < headingCount2; i++) {
                const heading = skillsHeadings2.nth(i);
                if (await heading.isVisible()) {
                    const potentialIcon = heading.locator('xpath=ancestor::div[1]//span[contains(@class, "edit") or contains(@class, "icon-edit")] | ancestor::div[2]//span[contains(@class, "edit") or contains(@class, "icon-edit")] | ancestor::div[3]//span[contains(@class, "edit") or contains(@class, "icon-edit")]').first();
                    if (await potentialIcon.count() > 0) {
                        editIcon2 = potentialIcon;
                        break;
                    }
                }
            }
            
            if (!editIcon2 || await editIcon2.count() === 0) {
                editIcon2 = page.locator('.widgetHead:has-text("Key skills")').locator('..').locator('.edit').first();
            }
            
            if (editIcon2 && await editIcon2.count() > 0) {
                logger.info('PASS 2: Found Key skills edit icon! Clicking...');
                await editIcon2.click();
                await randomDelay(3000, 4000);
            } else {
                throw new Error('PASS 2: Could not find Key skills edit icon.');
            }
            
            // Find the "Add skills" input
            let skillInput = null;
            const selectors = [
                'input[placeholder*="Add skill" i]',
                'input[placeholder*="skill" i]',
                'input.sugInp',
                '#skillInput',
                '.inputDiv input',
                'input[type="text"]',
            ];
            
            for (const sel of selectors) {
                const el = page.locator(sel).first();
                try {
                    if (await el.count() > 0 && await el.isVisible({ timeout: 2000 })) {
                        skillInput = el;
                        logger.info(`PASS 2: Found skill input using selector: "${sel}"`);
                        break;
                    }
                } catch (e) { /* continue */ }
            }
            
            if (!skillInput) {
                const addSkillsText = page.getByPlaceholder('Add skills');
                if (await addSkillsText.count() > 0) {
                    skillInput = addSkillsText;
                } else {
                    throw new Error('PASS 2: Cannot locate the "Add skills" input field.');
                }
            }
            
            // Click input and type Python
            logger.info('PASS 2: Clicking on "Add skills" input field...');
            await skillInput.scrollIntoViewIfNeeded();
            await skillInput.click({ force: true });
            await randomDelay(1000, 1500);
            
            logger.info('PASS 2: Typing "Python" using keyboard...');
            await page.keyboard.press('Control+a');
            await page.keyboard.press('Backspace');
            await randomDelay(500, 800);
            await page.keyboard.type('Python', { delay: 200 });
            logger.info('PASS 2: Finished typing "Python". Waiting for suggestions...');
            await randomDelay(3000, 4000);
            
            // Select from suggestions
            let suggestionClicked = false;
            const sugSelectors = [
                'ul.sugList li', '.sugList li', 'ul[class*="sug"] li',
                '.Sbody li', 'div[class*="suggestion"] li', 'li[class*="sug"]',
            ];
            
            for (const sugSel of sugSelectors) {
                const sug = page.locator(sugSel).filter({ hasText: /Python/i }).first();
                try {
                    if (await sug.count() > 0 && await sug.isVisible({ timeout: 1000 })) {
                        logger.info(`PASS 2: Found suggestion using "${sugSel}". Clicking...`);
                        await sug.click();
                        suggestionClicked = true;
                        break;
                    }
                } catch (e) { /* continue */ }
            }
            
            if (!suggestionClicked) {
                logger.info('PASS 2: No suggestion dropdown. Pressing Enter...');
                await page.keyboard.press('Enter');
            }
            
            await randomDelay(2000, 3000);
            
            // Save after adding Python
            logger.info('PASS 2: Clicking Save...');
            saveBtn = page.getByRole('button', { name: 'Save' });
            if (await saveBtn.count() > 0 && await saveBtn.isVisible()) {
                await saveBtn.click();
            } else {
                const fallbackSave = page.locator('button:has-text("Save")').filter({ state: 'visible' }).last();
                await fallbackSave.click();
            }
            
            await randomDelay(5000, 7000);
            logger.info('PASS 2: Save completed. Python re-added to profile.');
            logger.info('Successfully executed Key Skills two-pass toggle update.');
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
            const logsDir = path.join(__dirname, '../logs');
            const screenshotPath = path.join(logsDir, `error-${dateStr}.png`);
            await pages[0].screenshot({ path: screenshotPath });
            logger.info(`Saved error screenshot to ${screenshotPath}`);
            
            // Cleanup: keep only the 3 most recent error screenshots to save disk space
            try {
              const fs = require('fs');
              const errorScreenshots = fs.readdirSync(logsDir)
                .filter(f => f.startsWith('error-') && f.endsWith('.png'))
                .sort()
                .reverse();
              errorScreenshots.slice(3).forEach(old => {
                fs.unlinkSync(path.join(logsDir, old));
                logger.info(`Cleaned up old error screenshot: ${old}`);
              });
            } catch (cleanupErr) { /* ignore cleanup errors */ }
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
