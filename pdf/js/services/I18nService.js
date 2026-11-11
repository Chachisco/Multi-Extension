/**
 * Serviço de Internacionalização (i18n) para WebExtensions e Fallback Web
 */
export class I18nService {
    constructor() {
        this.hasNativeI18n = typeof chrome !== 'undefined' && Boolean(chrome.i18n?.getMessage);
    }

    /**
     * Translates a key.
     * @param {string} key - A chave definida no messages.json
     * @param {string} [fallback=''] - Texto padrão caso a chave não exista
     * @param {string|string[]} [substitutions] - Valores para substituir $1, $2, etc.
     * @returns {string}
     */
    t(key, fallback = '', substitutions = null) {
        if (!key) return fallback;

        if (this.hasNativeI18n) {
            try {
                const message = chrome.i18n.getMessage(key, substitutions);
                if (message) return message;
            } catch (e) {
                console.warn(`[i18n] Erro ao obter tradução para: ${key}`, e);
            }
        }

        // Se não houver tradução nativa ou faltar a chave, usa o fallback com interpolação básica
        if (!fallback) return key;

        if (substitutions) {
            const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
            return fallback.replace(/\$(\d+)/g, (_, idx) => subs[Number(idx) - 1] ?? '');
        }

        return fallback;
    }

    /**
     * Percorre o DOM e traduz automaticamente elementos com atributos data-i18n
     * Exemplo: <span data-i18n="save_btn">Guardar</span>
     * Exemplo: <button data-i18n-title="pin_note_title">...</button>
     */
    translateDOM(root = document) {
        // 1. Traduz texto interno
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            const fallback = el.textContent.trim();
            el.textContent = this.t(key, fallback);
        });

        // 2. Traduz tooltips (title)
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.dataset.i18nTitle;
            const fallback = el.getAttribute('title') || '';
            el.setAttribute('title', this.t(key, fallback));
        });

        // 3. Traduz placeholders de inputs
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            const fallback = el.getAttribute('placeholder') || '';
            el.setAttribute('placeholder', this.t(key, fallback));
        });
    }
}

export const i18n = new I18nService();
export const t = (key, fallback, subs) => i18n.t(key, fallback, subs);