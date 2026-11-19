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
        this.refPageInput = document.getElementById('ref-page-input');
        this.refPageCount = document.getElementById('ref-page-count');
        this.refZoom = document.getElementById('ref-zoom');
        this.refCanvas = document.getElementById('ref-canvas');
        this.refTextLayer = document.getElementById('ref-text-layer');
        this.refScale = 1.5;
        this.refCurrentPage = 1;
        this.refRenderTask = null;
        this.refWheelTimer = null;
        this.refRenderId = 0;

        // 5. Consola e Histórico de Logs
        this.cmdConsole = document.getElementById('cmd-console');
        this.logPanel = document.getElementById('log-history-panel');
        this.logContent = document.getElementById('log-content');
        this.btnLogToggle = document.getElementById('btn-log-history');
        this.btnCloseLogs = document.getElementById('btn-close-logs');
        this.logFilterDebug = document.getElementById('log-filter-debug');

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
        document.getElementById('reference-preview')?.addEventListener('wheel', e => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            e.stopPropagation();

            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.refScale = Math.max(0.1, Math.min(5.0, this.refScale + delta));

            // Atualiza logo o texto do input de zoom para sentires resposta instantânea
            if (this.refZoom) {
                this.refZoom.value = `${Math.round(this.refScale * 100)}%`;
            }

            // Debounce: só manda desenhar no canvas quando a rajada de scroll parar (40ms)
            clearTimeout(this.refWheelTimer);
            this.refWheelTimer = setTimeout(() => {
                this.showReferencePreview(this.refCurrentPage);
            }, 40);
        });

        window.addEventListener('preview-zoom', e => {
            const { delta, reset } = e.detail;
            if (reset) {
                this.refScale = 1.5; // valor padrão do preview
            } else {
                const newScale = this.refScale + delta;
                this.refScale = Math.max(0.1, Math.min(5.0, newScale));
            }
            this.showReferencePreview(this.refCurrentPage);
        });

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
            this.refScale = Math.min(5.0, this.refScale + 0.1);
            this.showReferencePreview(this.refCurrentPage);
        });

        document.getElementById('btn-ref-zoom-out')?.addEventListener('click', () => {
            this.refScale = Math.max(0.5, this.refScale - 0.1);
            this.showReferencePreview(this.refCurrentPage);
        });

        document.getElementById('btn-ref-split')?.addEventListener('click', () => {
            document.body.classList.toggle('split-mode');
        });

        if(this.refPageInput){
            this.refPageInput.onchange = () => {
                const total = this.state.currentSession?.pdfDoc?.numPages || 1;
                let page = parseInt(this.refPageInput.value, 10);
                
                // Valida se é um número e limita entre 1 e o total
                if (isNaN(page) || page < 1) page = 1;
                if (page > total) page = total;

                this.showReferencePreview(page);
            };

            this.refPageInput.onkeydown = e => {
                if (e.key === 'Enter') {
                    this.refPageInput.blur();
                }
            };
        }

        if (this.refZoom) {
            this.refZoom.onchange = () => {
                const value = parseInt(this.refZoom.value, 10);
                if (!isNaN(value)) {
                    const newScale = value / 100;
                    this.refScale = Math.max(0.1, Math.min(5.0, newScale));

                    this.showReferencePreview(this.refCurrentPage);
                }
            };

            // Para atualizar logo ao carregar na tecla Enter:
            this.refZoom.onkeydown = e => {
                if (e.key === 'Enter') {
                    this.refZoom.blur(); // Dispara o onchange automaticamente
                }
            };
        }

        this._setupWindowResizers();
    }

    async showReferencePreview(pageNum, labelText = null, destY = null) {
        const pdfDoc = this.state.currentSession?.pdfDoc;
        if (!this.refPreview || !pdfDoc) return;
        
        const renderId = ++this.refRenderId;
        const totalPages = pdfDoc.numPages;
        
        this.refCurrentPage = pageNum;
        if (this.refPageInput) {
            this.refPageInput.value = pageNum;
            this.refPageInput.max = totalPages;
        }
        if (this.refPageCount) this.refPageCount.textContent = totalPages;
        if (this.refZoom) this.refZoom.value = `${Math.round(this.refScale * 100)}%`;

        this.refPreview.classList.remove('hidden');

        if (this.refRenderTask) {
            this.refRenderTask.cancel();
            this.refRenderTask = null;
        }

        try {
            const page = await pdfDoc.getPage(pageNum);
            if (renderId !== this.refRenderId) return;

            const vp = page.getViewport({ scale: this.refScale, rotation: (page.rotate || 0) + this.state.pageRotation });
            const dpr = window.devicePixelRatio || 1;

            this.refCanvas.width = Math.floor(vp.width * dpr);
            this.refCanvas.height = Math.floor(vp.height * dpr);
            this.refCanvas.style.width = `${Math.floor(vp.width)}px`;
            this.refCanvas.style.height = `${Math.floor(vp.height)}px`;

            const ctx = this.refCanvas.getContext('2d', { alpha: false });

            this.refRenderTask = page.render({
                canvasContext: ctx,
                viewport: vp,
                transform: [dpr, 0, 0, dpr, 0, 0]
            });

            await this.refRenderTask.promise;
            this.refRenderTask = null;
            if (renderId !== this.refRenderId) return;

            if (destY !== null && destY !== undefined) {
                const bodyContainer = this.refPreview.querySelector('.ref-body');
                const htmlY = vp.height - (destY * this.refScale);
                bodyContainer.scrollTop = Math.max(0, htmlY - (bodyContainer.clientHeight / 2));
            }

        } catch (e) {
            if (e.name === 'RenderingCancelledException') {
                return;
            }
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

        if (this.logFilterDebug) {
            this.logFilterDebug.onchange = () => this.renderLogs();
        }
    }

    _showToast(entry) {
        if (!this.cmdConsole || entry.isDebug || entry.level === 'debug') return;

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

        const currentFile = logger.currentFilename || this.state.currentSession?.filename || 'Sistema';
        if (entry.file !== currentFile) return;

        const showDebug = document.getElementById('log-filter-debug')?.checked;
        if (entry.isDebug && !showDebug) return;

        const div = document.createElement('div');
        div.className = 'log-item';
        div.title = t('click_to_copy_log', 'Clica para copiar o registo');
        
        // [Level] [time] (file) message & stack
        div.innerHTML = `
            <span class="log-badge ${entry.level}">[${entry.level.toUpperCase()}]</span>
            <span class="log-time">[${entry.getFormattedTime()}]</span>
            <span class="log-file">(${entry.file})</span>
            <span class="log-text">${entry.message}</span>
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
        const currentFile = logger.currentFilename || this.state.currentSession?.filename || 'Sistema';
        const filter = this.logFilterDebug?.checked ? currentFile : null;

        const list = logger.getLogs(filter);
        if (list.length === 0) {
            this.logContent.innerHTML = `<div style="color:#666; text-align:center; margin-top:20px; font-style:italic;">${t('no_logs', 'Nenhum registo disponível.')}</div>`;
            return;
        }

        list.forEach(entry => this._appendLogItem(entry));
    }
}

export const modals = new Modals();