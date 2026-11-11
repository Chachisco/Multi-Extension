import { PdfElement, ElementType } from '../models/PdfElement.js';
import { BibliographyItem } from '../models/BibliographyItem.js';

export class PdfParser {
    constructor() {
        // Detection patterns for each element
        this.patterns = [
            {
                type: ElementType.FIGURE,
                regex: /\b(?:Fig(?:ure|ura|s)?\.?|Image|Imagem|Diagram(?:a)?|Gr[áa]fico|Graph|Chart|Plot|Map|Mapa|Plate)\s*#?\s*\d+(?:[\.\-_]\d+)*[a-z]?\b/gi
            },
            {
                type: ElementType.TABLE,
                regex: /\b(?:Tab(?:le|ela|s)?\.?|Quadro|Matrix|Matriz)\s*#?\s*\d+(?:[\.\-_]\d+)*[a-z]?\b/gi
            },
            {
                type: ElementType.EQUATION,
                regex: /\b(?:Eq(?:uation|ua[çc][ãa]o|s)?\.?|Formula|F[óo]rmula|Reaction|Rea[çc][ãa]o)\s*#?\s*(?:\(?\d+(?:[\.\-_]\d+)*[a-z]?\)?)|\(\d+(?:[\.\-_]\d+)+[a-z]?\)/gi
            },
            {
                type: ElementType.OTHER,
                regex: /\b(?:Alg(?:orithm|oritmo)?\.?|Scheme|Esquema|Listing|Listagem|Code|C[óo]digo|Snippet|App(?:endix)?|Ap[êe]ndice|Annex|Anexo|Box|Caixa)\s*#?\s*\d+(?:[\.\-_]\d+)*[a-z]?\b/gi
            }
        ];

        // Expressions to distinguish labels from mentions
        this.captionSeparatorRegex = /^\s*[:\.\-—–]\s+[A-ZÁÉÍÓÚÂÊÔÃÕ]/;
        this.mentionPrefixRegex = /(?:ver|veja|vide|see|in|on|at|na|no|da|do|pela|pelo|from|of|\()\s*$/i;
        this.mentionVerbRegex = /^\s+(?:mostra|indica|apresenta|ilustra|demonstra|shows|presents|indicates|illustrates|depicts|is|are|foi|foram)\b/i;
    }

    /**
     * Analyze document in search of figures, tables and equations
     * @param {Object} pdfDoc - Instância do documento PDF.js
     * @param {Function} [onProgress] - Callback opcional para reportar progresso: (current, total) => {}
     * @returns {Promise<PdfElement[]>}
     */
    async extractElements(pdfDoc, onProgress = null) {
        if (!pdfDoc) return [];
        const totalPages = pdfDoc.numPages;
        const results = [];

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const pageElements = await this.extractPageElements(pdfDoc, pageNum);
            results.push(...pageElements);

            if (typeof onProgress === 'function') {
                onProgress(pageNum, totalPages);
            }
        }

        return results;
    }

    /**
     * Analyze one page
     * @param {Object} pdfDoc
     * @param {number} pageNum
     * @returns {Promise<PdfElement[]>}
     */
    async extractPageElements(pdfDoc, pageNum) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        const { fullText, textMapping } = this._buildTextWithCoordinates(textContent);
        const elements = [];

        for (const { type, regex } of this.patterns) {
            let match;
            regex.lastIndex = 0;

            while ((match = regex.exec(fullText)) !== null) {
                const matchStart = match.index;
                const matchEnd = match.index + match[0].length;

                const prefix = fullText.substring(Math.max(0, matchStart - 40), matchStart);
                const suffix = fullText.substring(matchEnd, Math.min(fullText.length, matchEnd + 100));

                const isCaption = this._determineIfCaption(type, fullText, matchStart, matchEnd, prefix, suffix);

                const blockEnd = fullText.indexOf('\n', matchStart);
                const safeEnd = blockEnd !== -1 ? Math.min(blockEnd, matchEnd + 120) : matchEnd + 120;
                let context = fullText.substring(matchStart, safeEnd).trim().replace(/\s+/g, ' ');

                if (context.length > 150) {
                    context = context.substring(0, 150) + '...';
                }

                const mapItem = textMapping.slice().reverse().find(m => m.index <= matchStart) || textMapping[0];

                elements.push(new PdfElement({
                    pageNum,
                    type,
                    isCaption,
                    matchText: match[0],
                    fullText: context,
                    destX: mapItem ? mapItem.x : null,
                    destY: mapItem ? mapItem.y : null,
                    destW: mapItem ? mapItem.w : 40,
                    isManual: false
                }));
            }
        }

        return elements;
    }

    _determineIfCaption(type, fullText, matchStart, matchEnd, prefix, suffix) {
        const hasCaptionSeparator = this.captionSeparatorRegex.test(suffix);
        const hasMentionPrefix = this.mentionPrefixRegex.test(prefix);
        const hasVerbContinuation = this.mentionVerbRegex.test(suffix);
        const isInsideParentheses = prefix.trim().endsWith('(') || suffix.trim().startsWith(')');

        if (type === ElementType.EQUATION) {
            const paragraph = fullText.substring(Math.max(0, matchStart - 100), Math.min(fullText.length, matchEnd + 20));
            const isShortLine = !paragraph.includes('\n') || paragraph.split('\n').pop().length < 80;
            return isShortLine && !isInsideParentheses && !hasMentionPrefix;
        }

        if (hasCaptionSeparator && !hasMentionPrefix && !isInsideParentheses) {
            return true;
        }
        if (!hasMentionPrefix && !hasVerbContinuation && !isInsideParentheses) {
            return /^\s+[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(suffix);
        }
        if (prefix.trim() === '' || prefix.endsWith('\n')) {
            return true;
        }

        return false;
    }

    /**
     * Searches document last pages for the references
     * @param {Object} pdfDoc
     * @param {number} [maxPagesToScan=20] - Max num of pages from end to search for bib
     * @returns {Promise<BibliographyItem[]>}
     */
    async extractBibliography(pdfDoc, maxPagesToScan = 20) {
        if (!pdfDoc) return [];
        
        const totalPages = pdfDoc.numPages;
        const startPage = Math.max(1, totalPages - maxPagesToScan + 1);

        let fullText = '';
        const textMapping = [];

        for (let i = startPage; i <= totalPages; i++) {
            const page = await pdfDoc.getPage(i);
            const textContent = await page.getTextContent();

            for (const item of textContent.items) {
                if (item.str.trim() === '') {
                    fullText += ' ';
                    continue;
                }
                textMapping.push({
                    index: fullText.length,
                    pageNum: i,
                    x: item.transform[4],
                    y: item.transform[5],
                    w: item.width || 50
                });
                fullText += item.str + ' ';
            }
            fullText += '\n\n';
        }

        // 2. Searches numeric sequences like: [1], [2] ou 1., 2.
        const potentialRefRegex = /(?:\[(\d+)\]|\b(\d+)\.\s)/g;
        let match;
        const sequences = [];
        let currentSeq = [];
        let expectedNum = 1;
        let refStyle = null; // 1 -> "[1]", 2 -> "1."

        while ((match = potentialRefRegex.exec(fullText)) !== null) {
            const num = parseInt(match[1] || match[2], 10);
            const isBracket = match[1] !== undefined;
            const currentStyle = isBracket ? 1 : 2;

            if (num === 1) {
                if (currentSeq.length > 0) sequences.push(currentSeq);
                currentSeq = [{
                    num,
                    style: currentStyle,
                    index: match.index,
                    length: match[0].length,
                    map: textMapping.slice().reverse().find(m => m.index <= match.index) || textMapping[0]
                }];
                expectedNum = 2;
                refStyle = currentStyle;
                continue;
            }

            if (currentSeq.length > 0 && currentStyle === refStyle) {
                if (num >= expectedNum && num <= expectedNum + 2) {
                    currentSeq.push({
                        num,
                        style: currentStyle,
                        index: match.index,
                        length: match[0].length,
                        map: textMapping.slice().reverse().find(m => m.index <= match.index) || textMapping[0]
                    });
                    expectedNum = num + 1;
                }
            }
        }
        if (currentSeq.length > 0) sequences.push(currentSeq);

        sequences.sort((a, b) => b.length - a.length);
        const bestSequence = sequences[0];

        if (!bestSequence || bestSequence.length < 3) {
            return [];
        }

        // 3. Assembles BibliographyItem with the text delimited within indexes
        const bibliography = [];
        for (let i = 0; i < bestSequence.length; i++) {
            const current = bestSequence[i];
            const next = bestSequence[i + 1];

            const startExtract = current.index + current.length;
            const endExtract = next ? next.index : fullText.length;

            let content = fullText.substring(startExtract, endExtract).trim();

            if (!next) {
                const stopMatch = /\n\s*\n|\b(?:Acknowledgments|Appendix|Supplementary|Author contributions|Data availability)\b/i.exec(content);
                if (stopMatch) {
                    content = content.substring(0, stopMatch.index).trim();
                }
                if (content.length > 500) content = content.substring(0, 500) + '...';
            }

            content = content.replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ');

            if (content.length > 0) {
                bibliography.push(new BibliographyItem({
                    pageNum: current.map ? current.map.pageNum : startPage,
                    num: current.num,
                    style: current.style,
                    text: content,
                    pdfX: current.map ? current.map.x : null,
                    pdfY: current.map ? current.map.y : null,
                    pdfW: current.map ? current.map.w : 50
                }));
            }
        }

        return bibliography;
    }

    // utils function
    _buildTextWithCoordinates(textContent) {
        let fullText = '';
        const textMapping = [];

        for (const item of textContent.items) {
            if (item.str.trim() === '') {
                fullText += ' ';
                continue;
            }

            textMapping.push({
                index: fullText.length,
                x: item.transform[4],
                y: item.transform[5],
                w: item.width || 40
            });

            fullText += item.str;
            if (item.hasEOL) fullText += '\n';
            else fullText += ' ';
        }

        return { fullText, textMapping };
    }
}

export const pdfParser = new PdfParser();