const express = require('express');
const basicAuth = require('express-basic-auth');
const helmet = require('helmet');
const path = require('path');
const { startScheduler, executeWithRetry } = require('./src/scheduler');
const config = require('./src/config');
const logger = require('./src/logger');
const fs = require('fs');
const cron = require('node-cron');

const args = process.argv.slice(2);

logger.info('ProfilePulse initialized.');

if (args.includes('--manual')) {
    logger.info('Manual run triggered via CLI.');
    executeWithRetry().then(() => {
        logger.info('Manual run completed.');
        process.exit(0);
    });
} else {
    // Start Web Server & Scheduler Environment
    const app = express();
    const port = process.env.PORT || 8080;

    app.use(helmet({ contentSecurityPolicy: false })); // Security headers (CSP disabled for inline styles/scripts)
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Basic API Auth Check
    const authUsers = {};
    const pw = config.dashboardPassword || 'admin';
    authUsers['admin'] = pw;
    
    app.use(basicAuth({
        users: authUsers,
        challenge: true,
        realm: 'ProfilePulse Automation',
    }));

    // Serve static frontend
    app.use(express.static(path.join(__dirname, 'public')));

    // Endpoints
    
    // Status endpoint
    app.get('/api/status', (req, res) => {
        const { isSchedulerRunning } = require('./src/scheduler');
        res.json({
            status: isSchedulerRunning() ? 'running' : 'stopped',
            cronSchedule: config.cronSchedule,
            headless: config.headless
        });
    });

    // Start/Stop scheduler
    app.post('/api/toggle-scheduler', (req, res) => {
        const { startScheduler, stopScheduler, isSchedulerRunning } = require('./src/scheduler');
        if (isSchedulerRunning()) {
            stopScheduler();
            res.json({ success: true, message: 'Scheduler stopped.' });
        } else {
            startScheduler();
            res.json({ success: true, message: 'Scheduler started.' });
        }
    });

    // Execute run manually
    app.post('/api/manual', async (req, res) => {
        logger.info('Manual execution requested from Dashboard');
        // Do not await if it takes long, just trigger async
        executeWithRetry().catch(err => logger.error(`API execute failed: ${err.message}`));
        res.json({ success: true, message: 'Execution started! Check dashboard logs.' });
    });

    // Set new schedule logic
    app.post('/api/schedule', (req, res) => {
       const newSchedule = req.body.schedule;
       if(!newSchedule) {
           return res.status(400).json({success: false, message: 'Missing schedule string.' });
       }
       // Validate CRON expression before accepting
       if (!cron.validate(newSchedule)) {
           return res.status(400).json({success: false, message: 'Invalid CRON expression.' });
       }
       logger.info(`Dashboard requested schedule update to ${newSchedule}`);
       
       config.cronSchedule = newSchedule;
       startScheduler(newSchedule);

       // Update env file
       try {
           const envPath = path.join(__dirname, '.env');
           let envContent = '';
           if(fs.existsSync(envPath)) {
               envContent = fs.readFileSync(envPath, 'utf8');
               if (envContent.includes('CRON_SCHEDULE=')) {
                   envContent = envContent.replace(/CRON_SCHEDULE=.*/g, `CRON_SCHEDULE="${newSchedule}"`);
               } else {
                   envContent += `\nCRON_SCHEDULE="${newSchedule}"`;
               }
           } else {
               envContent = `CRON_SCHEDULE="${newSchedule}"\n`;
           }
           fs.writeFileSync(envPath, envContent);
           logger.info('Successfully persisted schedule to .env file');
       } catch(e) {
           logger.warn(`Could not save schedule to .env: ${e.message}`);
       }

       res.json({ success: true, message: 'Schedule updated successfully!' }); 
    });

    // Get logs logic
    app.get('/api/logs', (req, res) => {
        try {
            const logsDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logsDir)) {
                return res.json({ success: true, logs: [] });
            }
            // Find the latest log file (rotating files are named automation-YYYY-MM-DD.log)
            const logFiles = fs.readdirSync(logsDir)
                .filter(f => f.startsWith('automation') && f.endsWith('.log'))
                .sort()
                .reverse();
            
            if (logFiles.length === 0) {
                return res.json({ success: true, logs: [] });
            }
            const latestLog = path.join(logsDir, logFiles[0]);
            const logs = fs.readFileSync(latestLog, 'utf8');
            const lines = logs.split('\n').filter(Boolean).slice(-50);
            res.json({ success: true, logs: lines });
        } catch(e) {
            res.status(500).json({ success: false, message: 'Failed to read logs.' });
        }
    });

    app.listen(port, () => {
        logger.info(`Dashboard server running on http://localhost:${port}`);
        logger.info('Running background scheduler...');
        startScheduler();

        // Keep Render free-tier service awake by self-pinging every 14 minutes
        const SELF_URL = process.env.RENDER_EXTERNAL_URL;
        if (SELF_URL) {
            logger.info(`Self-ping enabled for ${SELF_URL}`);
            setInterval(() => {
                require('https').get(SELF_URL, () => {}).on('error', () => {});
            }, 14 * 60 * 1000);
        }
    });
}
