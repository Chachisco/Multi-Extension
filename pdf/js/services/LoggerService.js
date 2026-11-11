import { LogEntry, LogLevel } from '../models/LogEntry.js';

export class LoggerService extends EventTarget {
    constructor(maxLogs = 200) {
        super();
        this.maxLogs = maxLogs;
        this.logs = []; // Histórico em memória
        this.currentFilename = 'Sistema';
    }

    setDocument(filename) {
        this.currentFilename = filename || 'Sistema';
    }

    _log(level, message, details = '') {
        const entry = new LogEntry({
            level,
            message,
            details: details instanceof Error ? (details.stack || details.message) : details,
            file: this.currentFilename
        });

        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        const consolePrefix = `[UniPDF][${entry.level.toUpperCase()}]`;
        if (level === LogLevel.ERROR) console.error(consolePrefix, message, details);
        else if (level === LogLevel.WARN) console.warn(consolePrefix, message, details);
        else if (level === LogLevel.DEBUG) console.debug(consolePrefix, message, details);
        else console.log(consolePrefix, message);

        this.dispatchEvent(new CustomEvent('new-log', { detail: entry }));
        return entry;
    }

    info(message, details = '') {
        return this._log(LogLevel.INFO, message, details);
    }

    warn(message, details = '') {
        return this._log(LogLevel.WARN, message, details);
    }

    error(message, details = '') {
        return this._log(LogLevel.ERROR, message, details);
    }

    success(message, details = '') {
        return this._log(LogLevel.SUCCESS, message, details);
    }

    debug(message, details = '') {
        return this._log(LogLevel.DEBUG, message, details);
    }

    getLogs(filterFile = null) {
        if (!filterFile) return [...this.logs];
        return this.logs.filter(l => l.file === filterFile);
    }

    clear() {
        this.logs = [];
        this.dispatchEvent(new CustomEvent('logs-cleared'));
    }
}

export const logger = new LoggerService();