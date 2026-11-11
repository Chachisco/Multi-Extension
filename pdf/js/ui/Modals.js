import { appState } from '../core/AppState.js';
import { pdfEngine } from '../core/PdfEngine.js';
import { logger } from '../services/LoggerService.js';
import { t } from '../services/I18nService.js';

export class Modals {
    constructor(state = appState, engine = pdfEngine) {
        this.state = state;
        this.engine = engine;

        // 1. Elementos do Diálogo de Input
        this.modalInput = document.getElementById('modal-input');
        this.inputTitle = document.getElementById('modal-input-title');
        this.inputText = document.getElementById('modal-input-text');
        this.inputType = document.getElementById('modal-input-type');
        this.btnInputCancel = document.getElementById('btn-input-cancel');
        this.btnInputConfirm = document.getElementById('btn-input-confirm');

        // 2. Elementos do Modal de Merge
        this.modalMerge = document.getElementById('modal-merge');
        this.mergeFileInput = document.getElementById('merge-file-input');
        this.mergePageInput = document.getElementById('merge-page-input');
        this.btnMerge = document.getElementById('btn-merge-pdf');
        this.btnMergeCancel = document.getElementById('btn-merge-cancel');
        this.btnMergeConfirm = document.getElementById('btn-merge-confirm');
        this.pendingMergeBytes = null;

        // 3. Elementos do Preview de Burn-in
        this.modalPreview = document.getElementById('modal-preview');
        this.previewIframe = document.getElementById('preview-iframe');
        this.btnPreviewCancel = document.getElementById('btn-preview-cancel');
        this.btnPreviewConfirm = document.getElementById('btn-preview-confirm');
        this.pendingBurnInCallback = null;
        this.previewUrl = null;

        // 4. Elementos da Janela de Referência Flutuante (Preview rápido)
        this.refPreview = document.getElementById('reference-preview');
        this.refPageNumber = document.getElementById('ref-page-number');
        this.refZoomDisplay = document.getElementById('ref-zoom-display');
        this.refCanvas = document.getElementById('ref-canvas');
        this.refTextLayer = document.getElementById('ref-text-layer');
        this.refScale = 1.5;
        this.refCurrentPage = 1;

        // 5. Consola e Histórico de Logs
        this.cmdConsole = document.getElementById('cmd-console');
        this.logPanel = document.getElementById('log-history-panel');
        this.logContent = document.getElementById('log-content');
        this.btnLogToggle = document.getElementById('btn-log-history');
        this.btnCloseLogs = document.getElementById('btn-close-logs');
        this.logFilterCurrent = document.getElementById('log-filter-current');

        this._initEvents();
    }

    _initEvents() {
        this._setupMergeModal();
        this._setupBurnInModal();
        this._setupReferencePreview();
        this._setupLogConsole();
    }

    // =========================================================================
    // 1. DIÁLOGO PROMPT ASYNC REUTILIZÁVEL (askUserInput)
    // =========================================================================
    /**
     * Abre o modal de input e devolve uma Promise com a resposta do utilizador
     * @param {string} title
     * @param {string} [defaultValue='']
     * @param {boolean} [showTypeSelect=false]
     * @returns {Promise<{ text: string, type: string } | null>}
     */
    prompt(title, defaultValue = '', showTypeSelect = false) {
        return new Promise(resolve => {
            if (!this.modalInput) return resolve(null);

            this.inputTitle.textContent = title;
            this.inputText.value = defaultValue;
            this.inputType.classList.toggle('hidden', !showTypeSelect);

            this.modalInput.classList.remove('hidden');
            this.inputText.focus();
            this.inputText.select();

            const cleanup = () => {
                this.modalInput.classList.add('hidden');
                this.btnInputConfirm.onclick = null;
                this.btnInputCancel.onclick = null;
                this.inputText.onkeydown = null;
            };

            this.btnInputConfirm.onclick = () => {
                const text = this.inputText.value.trim();
                const type = this.inputType.value;
                cleanup();
                resolve({ text, type });
            };

            this.btnInputCancel.onclick = () => {
                cleanup();
                resolve(null);
            };

            this.inputText.onkeydown = e => {
                if (e.key === 'Enter') this.btnInputConfirm.click();
                if (e.key === 'Escape') this.btnInputCancel.click();
            };
        });
    }

    // =========================================================================
    // 2. MODAL DE JUNTAR (MERGE) PDFs
    // =========================================================================
    _setupMergeModal() {
        if (this.btnMerge && this.mergeFileInput) {
            this.btnMerge.onclick = () => this.mergeFileInput.click();
        }

        if (this.mergeFileInput) {
            this.mergeFileInput.onchange = async () => {
                const file = this.mergeFileInput.files?.[0];
                if (!file) return;

                this.pendingMergeBytes = await file.arrayBuffer();
                const numPages = this.state.currentSession?.pdfDoc?.numPages || 1;
                this.mergePageInput.placeholder = t('merge_at_end_placeholder', `(Padrão: Fim da página $1)`, [numPages]);
                this.mergePageInput.value = '';
                this.mergePageInput.max = numPages + 1;
                this.modalMerge?.classList.remove('hidden');
                this.mergeFileInput.value = '';
            };
        }

        if (this.btnMergeCancel) {
            this.btnMergeCancel.onclick = () => {
                this.modalMerge?.classList.add('hidden');
                this.pendingMergeBytes = null;
            };
        }

        if (this.btnMergeConfirm) {
            this.btnMergeConfirm.onclick = () => {
                this.modalMerge?.classList.add('hidden');
                const targetPage = parseInt(this.mergePageInput.value, 10) || null;
                if (this.pendingMergeBytes) {
                    window.dispatchEvent(new CustomEvent('merge-pdf-requested', {
                        detail: { bytes: this.pendingMergeBytes, targetPage }
                    }));
                    this.pendingMergeBytes = null;
                }
            };
        }
    }

    // =========================================================================
    // 3. MODAL DE PRÉ-VISUALIZAÇÃO DE BURN-IN
    // =========================================================================
    _setupBurnInModal() {
        if (this.btnPreviewCancel) {
            this.btnPreviewCancel.onclick = () => {
                this.modalPreview?.classList.add('hidden');
                this._clearBurnInPreview();
                window.dispatchEvent(new CustomEvent('burn-in-preview-cancelled'));
            };
        }

        if (this.btnPreviewConfirm) {
            this.btnPreviewConfirm.onclick = () => {
                this.modalPreview?.classList.add('hidden');
                const onConfirm = this.pendingBurnInCallback;
                this._clearBurnInPreview();
                window.dispatchEvent(new CustomEvent('burn-in-preview-cancelled'));
                if (typeof onConfirm === 'function') onConfirm();
            };
        }
    }

    openBurnInPreview(blobUrl, onConfirmCallback) {
        if (!this.modalPreview) return;
        if (this.previewUrl && this.previewUrl !== blobUrl) URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = blobUrl;
        this.previewIframe.src = blobUrl + '#toolbar=1&navpanes=1&view=FitH';
        this.pendingBurnInCallback = onConfirmCallback;
        this.modalPreview.classList.remove('hidden');
    }

    _clearBurnInPreview() {
        const previewUrl = this.previewUrl;
        this.previewUrl = null;
        this.previewIframe.src = '';
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        this.pendingBurnInCallback = null;
    }

    // =========================================================================
    // 4. JANELA FLUTUANTE DE REFERÊNCIA (PREVIEW RÁPIDO / SPLIT-SCREEN)
    // =========================================================================
    _setupReferencePreview() {
        document.getElementById('btn-close-ref')?.addEventListener('click', () => {
            this.refPreview?.classList.add('hidden');
            document.body.classList.remove('split-mode');
        });

        document.getElementById('btn-ref-prev')?.addEventListener('click', () => {
            if (this.refCurrentPage > 1) this.showReferencePreview(this.refCurrentPage - 1);
        });

        document.getElementById('btn-ref-next')?.addEventListener('click', () => {
            const total = this.state.currentSession?.pdfDoc?.numPages || 1;
            if (this.refCurrentPage < total) this.showReferencePreview(this.refCurrentPage + 1);
        });

        document.getElementById('btn-ref-zoom-in')?.addEventListener('click', () => {
            this.refScale = Math.min(5.0, this.refScale + 0.25);
            this.showReferencePreview(this.refCurrentPage);
        });

        document.getElementById('btn-ref-zoom-out')?.addEventListener('click', () => {
            this.refScale = Math.max(0.5, this.refScale - 0.25);
            this.showReferencePreview(this.refCurrentPage);
        });

        document.getElementById('btn-ref-split')?.addEventListener('click', () => {
            document.body.classList.toggle('split-mode');
        });

        this._setupWindowResizers();
    }

    async showReferencePreview(pageNum, labelText = null, destY = null) {
        const pdfDoc = this.state.currentSession?.pdfDoc;
        if (!this.refPreview || !pdfDoc) return;

        this.refCurrentPage = pageNum;
        if (this.refPageNumber) this.refPageNumber.textContent = pageNum;
        if (this.refZoomDisplay) this.refZoomDisplay.textContent = `${Math.round(this.refScale * 100)}%`;

        this.refPreview.classList.remove('hidden');

        try {
            const page = await pdfDoc.getPage(pageNum);
            const vp = page.getViewport({ scale: this.refScale, rotation: (page.rotate || 0) + this.state.pageRotation });

            const dpr = window.devicePixelRatio || 1;
            this.refCanvas.width = Math.floor(vp.width * dpr);
            this.refCanvas.height = Math.floor(vp.height * dpr);
            this.refCanvas.style.width = `${Math.floor(vp.width)}px`;
            this.refCanvas.style.height = `${Math.floor(vp.height)}px`;

            const ctx = this.refCanvas.getContext('2d', { alpha: false });
            await page.render({ canvasContext: ctx, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;

            // Scroll para a posição certa do elemento
            if (destY !== null && destY !== undefined) {
                const bodyContainer = this.refPreview.querySelector('.ref-body');
                const htmlY = vp.height - (destY * this.refScale);
                bodyContainer.scrollTop = Math.max(0, htmlY - (bodyContainer.clientHeight / 2));
            }

        } catch (e) {
            logger.error('Erro ao renderizar pré-visualização de referência', e);
        }
    }

    _setupWindowResizers() {
        const resizers = this.refPreview?.querySelectorAll('[class^="resizer"]');
        if (!resizers) return;

        let isResizing = false;
        let origW, origH, origX, origY, currResizer;

        resizers.forEach(r => {
            r.addEventListener('mousedown', e => {
                e.preventDefault();
                isResizing = true;
                currResizer = r.className;
                origW = this.refPreview.getBoundingClientRect().width;
                origH = this.refPreview.getBoundingClientRect().height;
                origX = e.pageX;
                origY = e.pageY;
            });
        });

        window.addEventListener('mousemove', e => {
            if (!isResizing || document.body.classList.contains('split-mode')) return;
            if (currResizer.includes('left')) {
                const newW = origW + (origX - e.pageX);
                if (newW > 300) this.refPreview.style.width = `${newW}px`;
            }
            if (currResizer.includes('top')) {
                const newH = origH + (origY - e.pageY);
                if (newH > 350) this.refPreview.style.height = `${newH}px`;
            }
        });

        window.addEventListener('mouseup', () => { isResizing = false; });
    }

    // =========================================================================
    // 5. NOTIFICAÇÕES TOAST E HISTÓRICO DE LOGS
    // =========================================================================
    _setupLogConsole() {
        // Escuta os eventos emitidos pelo LoggerService
        logger.addEventListener('new-log', e => {
            const entry = e.detail;
            this._showToast(entry);
            this._appendLogItem(entry);
        });

        if (this.btnLogToggle && this.logPanel) {
            this.btnLogToggle.onclick = () => {
                const isHidden = this.logPanel.classList.toggle('hidden');
                this.btnLogToggle.classList.toggle('active', !isHidden);
            };
        }

        if (this.btnCloseLogs) {
            this.btnCloseLogs.onclick = () => {
                this.logPanel?.classList.add('hidden');
                this.btnLogToggle?.classList.remove('active');
            };
        }

        if (this.logFilterCurrent) {
            this.logFilterCurrent.onchange = () => this.renderLogs();
        }
    }

    _showToast(entry) {
        if (!this.cmdConsole || entry.level === 'debug') return;

        const toast = document.createElement('div');
        toast.className = `cmd-msg ${entry.level}`;
        const prefix = `[${entry.level.toUpperCase()}] `;
        toast.textContent = `${prefix}${entry.message}`;

        this.cmdConsole.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    _appendLogItem(entry) {
        if (!this.logContent) return;
        const currentFile = this.state.currentSession?.filename || 'Sistema';
        if (this.logFilterCurrent?.checked && entry.file !== currentFile) return;

        const div = document.createElement('div');
        div.className = `log-item ${entry.level}`;
        div.title = t('click_to_copy_log', 'Clica para copiar o registo');
        div.innerHTML = `
            <span class="time">[${entry.getFormattedTime()}]</span>
            <span class="file">(${entry.file})</span>
            ${entry.message}
        `;

        div.onclick = async () => {
            await navigator.clipboard.writeText(entry.toClipboardString());
            div.dataset.copyState = 'copied';
            setTimeout(() => delete div.dataset.copyState, 1200);
        };

        this.logContent.appendChild(div);
        this.logContent.scrollTop = this.logContent.scrollHeight;
    }

    renderLogs() {
        if (!this.logContent) return;
        this.logContent.innerHTML = '';
        const currentFile = this.state.currentSession?.filename || 'Sistema';
        const filter = this.logFilterCurrent?.checked ? currentFile : null;

        const list = logger.getLogs(filter);
        if (list.length === 0) {
            this.logContent.innerHTML = `<div style="color:#666; text-align:center; margin-top:20px; font-style:italic;">${t('no_logs', 'Nenhum registo disponível.')}</div>`;
            return;
        }

        list.forEach(entry => this._appendLogItem(entry));
    }
}

export const modals = new Modals();