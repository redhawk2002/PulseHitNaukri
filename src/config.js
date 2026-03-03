require('dotenv').config();
const logger = require('./logger');

const config = {
  naukriEmail: process.env.NAUKRI_EMAIL,
  naukriPassword: process.env.NAUKRI_PASSWORD,
  cronSchedule: process.env.CRON_SCHEDULE || '0 9,21 * * *',
  headless: process.env.HEADLESS_BROWSER !== 'false',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin'
};

if (!config.naukriEmail || !config.naukriPassword) {
  logger.error('CRITICAL: NAUKRI_EMAIL or NAUKRI_PASSWORD is missing in .env file.');
  process.exit(1);
}

if (config.dashboardPassword === 'admin') {
  logger.warn('SECURITY WARNING: Using default dashboard password ("admin"). Please set DASHBOARD_PASSWORD in your .env file!');
}

module.exports = config;
