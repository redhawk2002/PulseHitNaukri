const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Ensure root logs directory exists
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Rotating file transport: caps at 5MB per file, keeps max 3 days of logs
const rotatingTransport = new DailyRotateFile({
  filename: path.join(logDir, 'automation-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '5m',       // Max 5MB per log file
  maxFiles: '3d',      // Delete logs older than 3 days
  zippedArchive: false, // Don't compress (saves CPU on free tier)
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
  ),
  transports: [
    new winston.transports.Console(),
    rotatingTransport
  ]
});

module.exports = logger;
