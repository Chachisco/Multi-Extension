export const LogLevel = Object.freeze({
    DEBUG: 'debug',
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error'
});

export class LogEntry {
    /**
     * @param {Object} params
     * @param {string} params.level - 'info' | 'warning' | 'error' | 'success'
     * @param {string} params.message
     * @param {string} [params.details='']
     * @param {string} [params.file='']
     * @param {boolean} params.isDebug - True | False
     * @param {Date} [params.timestamp]
     */
    constructor({
        level = LogLevel.INFO,
        message = '',
        details = '',
        file = 'Sistema',
        isDebug = false,
        timestamp = new Date()
    } = {}) {
        this.level = this._normalizeLevel(level);
        this.message = message;
        this.details = typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details || '');
        this.file = file || 'Sistema';
        this.isDebug = Boolean(isDebug);
        this.timestamp = timestamp instanceof Date ? timestamp : new Date();
    }

    _normalizeLevel(level) {
        if (level === 'warn') return LogLevel.WARN;
        return Object.values(LogLevel).includes(level) ? level : LogLevel.INFO;
    }

    getFormattedTime() {
        return this.timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    /**
     * Texto formatado para cópia direta para a área de transferência
     */
    toClipboardString() {
        let text = `[${this.level.toUpperCase()}][${this.getFormattedTime()}][${this.file}] ${this.message}`;
        if (this.details) {
            text += `\n\nDetalhes:\n${this.details}`;
        }
        return text;
    }
}