/**
 * Central service to act upon the database
 */
export class StorageAdapter {
    async get(key) { throw new Error('Not implemented'); }
    async getMultiple(keys) { throw new Error('Not implemented'); }
    async getAll() { throw new Error('Not implemented'); }
    async set(key, value) { throw new Error('Not implemented'); }
    async setMultiple(entries) { throw new Error('Not implemented'); }
    async remove(key) { throw new Error('Not implemented'); }
    async removeMultiple(keys) { throw new Error('Not implemented'); }
}

/**
 * For chrome (chrome.storage.local)
 */
export class ChromeStorageAdapter extends StorageAdapter {
    _call(method, args) {
        return new Promise((resolve, reject) => {
            chrome.storage.local[method](...args, result => {
                const error = chrome.runtime?.lastError;
                if (error) reject(new Error(error.message));
                else resolve(result);
            });
        });
    }

    async get(key) {
        const result = await this._call('get', [[key]]);
        return result[key];
    }

    async getMultiple(keys) {
        return this._call('get', [keys]);
    }

    async getAll() {
        return this._call('get', [null]);
    }

    async set(key, value) {
        return this._call('set', [{ [key]: value }]);
    }

    async setMultiple(entries) {
        return this._call('set', [entries]);
    }

    async remove(key) {
        return this._call('remove', [[key]]);
    }

    async removeMultiple(keys) {
        return this._call('remove', [keys]);
    }
}

/**
 * Firefox alternative
 */
export class FirefoxStorageAdapter extends StorageAdapter {
    async get(key) {
        const result = await browser.storage.local.get(key);
        return result[key];
    }

    async getMultiple(keys) {
        return await browser.storage.local.get(keys);
    }

    async getAll() {
        return await browser.storage.local.get(null);
    }

    async set(key, value) {
        await browser.storage.local.set({ [key]: value });
    }

    async setMultiple(entries) {
        await browser.storage.local.set(entries);
    }

    async remove(key) {
        await browser.storage.local.remove(key);
    }

    async removeMultiple(keys) {
        await browser.storage.local.remove(keys);
    }
}

/**
 * Local alternative
 */
export class LocalStorageAdapter extends StorageAdapter {
    async get(key) {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : null;
    }
    async getMultiple(keys) {
        const result = {};
        for (const k of keys) {
            const v = localStorage.getItem(k);
            if (v !== null) result[k] = JSON.parse(v);
        }
        return result;
    }
    async getAll() {
        const result = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            try { result[k] = JSON.parse(localStorage.getItem(k)); } catch (_) {}
        }
        return result;
    }
    async set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }
    async setMultiple(entries) {
        for (const [k, v] of Object.entries(entries)) {
            localStorage.setItem(k, JSON.stringify(v));
        }
    }
    async remove(key) {
        localStorage.removeItem(key);
    }
    async removeMultiple(keys) {
        for (const k of keys) localStorage.removeItem(k);
    }
}

/**
 * Serviço de Armazenamento Principal da Aplicação
 */
export class StorageService {
    /**
     * @param {StorageAdapter} [adapter]
     */
    constructor(adapter = null) {
        if (adapter) {
            this.adapter = adapter;
            return;
        }

        // Em StorageService.js:
        // 1. Prioridade: Firefox / W3C Standard (só o Firefox tem 'browser' nativo)
        if (typeof browser !== 'undefined' && browser.storage?.local) {
            this.adapter = new FirefoxStorageAdapter();
        } 
        // 2. Chrome / Edge / Opera (têm 'chrome', mas não 'browser')
        else if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            this.adapter = new ChromeStorageAdapter();
        } 
        // 3. Fallback Web
        else {
            this.adapter = new LocalStorageAdapter();
        }
    }

    /**
     * Allows to change adapter in runtime (might be changed due to usecase... )
     */
    setAdapter(newAdapter) {
        if (newAdapter instanceof StorageAdapter) {
            this.adapter = newAdapter;
        }
    }

    // key generator
    _prefix(filename) {
        return `${filename}_pg`;
    }

    _key(filename, pageNum, type) {
        return `${this._prefix(filename)}${pageNum}_${type}`;
    }

    async loadPageItems(filename, pageNum, type) {
        const key = this._key(filename, pageNum, type);
        const data = await this.adapter.get(key);
        return Array.isArray(data) ? data : [];
    }

    async savePageItems(filename, pageNum, type, items) {
        const key = this._key(filename, pageNum, type);
        const serializable = items.map(item => (typeof item.toJSON === 'function' ? item.toJSON() : item));
        await this.adapter.set(key, serializable);
    }

    async loadAllForFile(filename, typeSuffix) {
        const all = await this.adapter.getAll();
        const prefix = this._prefix(filename);
        const results = [];

        for (const [key, val] of Object.entries(all)) {
            if (key.startsWith(prefix) && key.endsWith(`_${typeSuffix}`) && Array.isArray(val)) {
                const pageText = key.slice(prefix.length, -(`_${typeSuffix}`).length);
                if (!/^\d+$/.test(pageText)) continue;
                const pageNum = Number(pageText);
                results.push({ pageNum, data: val });
            }
        }
        results.sort((a, b) => a.pageNum - b.pageNum);
        return results;
    }

    // Migration / reordering (used in page order edits)
    async syncAfterPageEdit(filename, action, p1, p2, keepNotes = false) {
        const items = await this.adapter.getAll();
        const prefix = this._prefix(filename);
        const newStorage = {};
        const keysToRemove = [];

        Object.keys(items).forEach(key => {
            if (!key.startsWith(prefix)) return;

            const parts = key.substring(prefix.length).split('_');
            const pageNum = parseInt(parts[0], 10);
            const suffix = parts.slice(1).join('_');

            let newPageNum = pageNum;

            if (action === 'DELETE') {
                if (pageNum === p1) {
                    if (!keepNotes || suffix !== 'notes') {
                        keysToRemove.push(key);
                        return;
                    }
                    newPageNum = p1;
                } else if (pageNum > p1) {
                    newPageNum = pageNum - 1;
                }
            } else if (action === 'MOVE') {
                const from = p1;
                const to = p2;
                if (pageNum === from) newPageNum = to;
                else if (from < to && pageNum > from && pageNum <= to) newPageNum = pageNum - 1;
                else if (from > to && pageNum >= to && pageNum < from) newPageNum = pageNum + 1;
            } else if (action === 'INSERT') {
                const insertAt = p1;
                const numAdded = p2;
                if (pageNum >= insertAt) {
                    newPageNum = pageNum + numAdded;
                }
            }

            if (newPageNum !== pageNum) {
                keysToRemove.push(key);
            }
            const targetKey = `${prefix}${newPageNum}_${suffix}`;
            if (action === 'DELETE' && keepNotes && suffix === 'notes' && newStorage[targetKey]) {
                newStorage[targetKey] = [...newStorage[targetKey], ...items[key]];
            } else {
                newStorage[targetKey] = items[key];
            }
        });

        if (keysToRemove.length > 0) {
            await this.adapter.removeMultiple(keysToRemove);
        }
        if (Object.keys(newStorage).length > 0) {
            await this.adapter.setMultiple(newStorage);
        }
    }

    /**
     * Register or updates a doc in the annotated PDFs index
     */
    async registerDocument(filename, metadata = {}) {
        const indexKey = 'unipdf_documents_index';
        const index = (await this.adapter.get(indexKey)) || {};
        
        index[filename] = {
            filename,
            title: metadata.title || filename,
            lastOpened: Date.now(),
            pageCount: metadata.pageCount || 0,
            ...metadata
        };
        
        await this.adapter.set(indexKey, index);
    }

    /**
     * Return all docs with saved extension data
     */
    async listAnnotatedDocuments() {
        const indexKey = 'unipdf_documents_index';
        return (await this.adapter.get(indexKey)) || {};
    }

    /**
     * Deletes extension data associated to a PDF
     */
    async purgeDocument(filename) {
        const all = await this.adapter.getAll();
        const prefix = `${filename}_`;
        const keysToDelete = Object.keys(all).filter(k => k.startsWith(prefix));
        
        const indexKey = 'unipdf_documents_index';
        const index = (await this.adapter.get(indexKey)) || {};
        delete index[filename];
        
        keysToDelete.push(indexKey);
        await this.adapter.removeMultiple(keysToDelete);
        await this.adapter.set(indexKey, index);
    }
}

export const storageService = new StorageService();