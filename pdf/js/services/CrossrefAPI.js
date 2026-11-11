import { logger } from './LoggerService.js';

export class CrossrefAPI {
    constructor() {
        this.baseUrl = 'https://api.crossref.org/works';
    }

    async searchWork(query) {
        if (!query || query.trim().length < 5) return null;

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            logger.warn('Sem ligação à Internet. Não é possível consultar metadados no Crossref.');
            return null;
        }

        try {
            const url = `${this.baseUrl}?query.bibliographic=${encodeURIComponent(query)}&rows=1`;
            const res = await fetch(url);
            
            if (!res.ok) {
                logger.warn(`Crossref indisponível ou resposta inválida (Status: ${res.status})`);
                return null;
            }

            const data = await res.json();
            const item = data.message?.items?.[0];
            if (!item) {
                logger.info('Nenhum artigo correspondente encontrado no Crossref.');
                return null;
            }

            logger.success(`Metadados encontrados: ${item.title?.[0] || 'Artigo'}`);
            return this._formatWork(item);

        } catch (e) {
            logger.error('Falha ao comunicar com a API do Crossref.', e);
            return null;
        }
    }

    /**
     * Obtains metadata for a DOI
     * @param {string} doi
     */
    async getByDoi(doi) {
        if (!doi) return null;
        try {
            const res = await fetch(`${this.baseUrl}/${encodeURIComponent(doi)}`);
            if (!res.ok){
                logger.warn(`Crossref indisponível ou resposta inválida (Status: ${res.status})`);
                return null;
            }
            const data = await res.json();
            return this._formatWork(data.message);
        } catch (e) {
            console.warn('Erro ao consultar DOI:', e);
            return null;
        }
    }

    _formatWork(item) {
        return {
            title: item.title?.[0] || 'Sem título',
            doi: item.DOI,
            url: item.URL,
            year: item.issued?.['date-parts']?.[0]?.[0] || 'n.d.',
            authors: (item.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim()).join(', '),
            journal: item['container-title']?.[0] || '',
            publisher: item.publisher || ''
        };
    }
}

export const crossrefAPI = new CrossrefAPI();