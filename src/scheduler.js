const cron = require('node-cron');
const { runProfileUpdate } = require('./automation');
const config = require('./config');
const logger = require('./logger');
const { randomDelay } = require('./utils/time');

let currentTask = null;

const executeWithRetry = async () => {
    try {
        await runProfileUpdate();
    } catch (e) {
        logger.error('First attempt failed. Retrying in a few minutes...');
        await randomDelay(60000, 300000); // 1 to 5 minutes delay
        try {
            logger.info('Starting retry attempt...');
            await runProfileUpdate();
        } catch (retryErr) {
            logger.error('Retry attempt also failed. Giving up for this cycle.');
        }
    }
};

const startScheduler = (schedule) => {
    const cronStr = schedule || config.cronSchedule;
    if (currentTask) {
        currentTask.stop();
    }
    logger.info(`Starting scheduler with expression: ${cronStr}`);
    
    currentTask = cron.schedule(cronStr, () => {
        logger.info('Cron job triggered!');
        executeWithRetry();
    });
};

const stopScheduler = () => {
    if (currentTask) {
        currentTask.stop();
        currentTask = null;
        logger.info('Scheduler stopped manually.');
    }
};

const isSchedulerRunning = () => {
    return currentTask !== null;
};

module.exports = { startScheduler, stopScheduler, executeWithRetry, isSchedulerRunning };
