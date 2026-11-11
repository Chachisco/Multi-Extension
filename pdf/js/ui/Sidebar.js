import { appState } from '../core/AppState.js';
import { pdfEngine } from '../core/PdfEngine.js';
import { pdfParser } from '../services/PdfParser.js';
import { jumpTo } from '../utils/navigation.js';
import { logger } from '../services/LoggerService.js';
import { t } from '../services/I18nService.js';

export class Sidebar {
    constructor(state = appState, engine = pdfEngine) {
        this.state = state;
        this.engine = engine;

        // Elementos DOM principais
        this.sidebarEl = document.getElementById('pdf-sidebar');
        this.btnToggle = document.getElementById('btn-toggle-sidebar');
        this.btnClose = document.getElementById('btn-close-sidebar');
        this.btnSide = document.getElementById('btn-sidebar-side');

        // Separadores (Tabs)
        this.tabOutline = document.getElementById('tab-outline');
        this.tabThumbnails = document.getElementById('tab-thumbnails');
        this.tabFigures = document.getElementById('tab-figures');
        this.tabRefs = document.getElementById('tab-refs');
        this.tabBookmarks = document.getElementById('tab-bookmarks');

        // Vistas de Conteúdo (Views)
        this.viewOutline = document.getElementById('outline-view');
        this.viewThumbnails = document.getElementById('thumbnails-view');
        this.viewFigures = document.getElementById('figures-view');
        this.viewRefs = document.getElementById('refs-view');
        this.viewBookmarks = document.getElementById('bookmarks-view');

        // Estados de Cache
        this.thumbnailsRendered = false;
        this.thumbnailObserver = null;
        this.biblioLoaded = false;
        this.outlineLoaded = false;
        this.bookmarksRenderId = 0;

        this._initEvents();
    }

    _initEvents() {
        // 1. Botões de Abrir / Fechar / Trocar de Lado
        if (this.btnToggle) this.btnToggle.onclick = () => this.toggle();
        if (this.btnClose) this.btnClose.onclick = () => this.toggle();
        if (this.btnSide) this.btnSide.onclick = () => this.toggleSide();

        // 2. Cliques nos Separadores
        this.tabOutline?.addEventListener('click', () => {
            this._switchTab(this.tabOutline, this.viewOutline);
            if (!this.outlineLoaded) this.loadOutline();
        });

        this.tabThumbnails?.addEventListener('click', () => {
            this._switchTab(this.tabThumbnails, this.viewThumbnails);
            if (!this.thumbnailsRendered) this.renderThumbnails();
        });

        this.tabFigures?.addEventListener('click', () => {
            this._switchTab(this.tabFigures, this.viewFigures);
            this.renderFiguresList();
        });

        this.tabRefs?.addEventListener('click', () => {
            this._switchTab(this.tabRefs, this.viewRefs);
            if (!this.biblioLoaded) this.loadBibliography();
        });

        this.tabBookmarks?.addEventListener('click', () => {
            this._switchTab(this.tabBookmarks, this.viewBookmarks);
            this.renderBookmarksList();
        });

        // 3. Eventos globais da aplicação
        window.addEventListener('pdf-document-loaded', () => this._onNewDocumentLoaded());
        window.addEventListener('page-in-view', e => this._updateActiveThumbnail(e.detail.pageNum));
        window.addEventListener('bookmarks-updated', () => {
            if (this.tabBookmarks?.classList.contains('active')) this.renderBookmarksList();
        });
        window.addEventListener('elements-updated', () => {
            if (this.tabFigures?.classList.contains('active')) this.renderFiguresList();
        });

        // 4. Recebe o atalho de teclado Alt+Seta vindo do ShortcutManager
        window.addEventListener('sidebar-set-side', e => this.setSide(e.detail));

        this._setupFiguresToolbar();
    }

    // =========================================================================
    // NAVEGAÇÃO E POSICIONAMENTO DA SIDEBAR
    // =========================================================================
    _switchTab(activeTab, activeView) {
        [this.tabOutline, this.tabThumbnails, this.tabFigures, this.tabRefs, this.tabBookmarks]
            .forEach(t => t?.classList.remove('active'));
        [this.viewOutline, this.viewThumbnails, this.viewFigures, this.viewRefs, this.viewBookmarks]
            .forEach(v => v?.classList.add('hidden'));

        activeTab?.classList.add('active');
        activeView?.classList.remove('hidden');
    }

    toggle() {
        this.sidebarEl.classList.toggle('closed');
        this._updateViewerLayout();

        if (!this.sidebarEl.classList.contains('closed') && this.tabOutline?.classList.contains('active')) {
            if (!this.outlineLoaded) this.loadOutline();
        }
    }

    toggleSide() {
        const isLeft = this.sidebarEl.classList.contains('pos-left');
        this.setSide(isLeft ? 'right' : 'left');
    }

    setSide(side) {
        this.sidebarEl.classList.toggle('pos-left', side === 'left');
        this.sidebarEl.classList.toggle('pos-right', side === 'right');
        this._updateViewerLayout();
    }

    _updateViewerLayout() {
        const isOpen = !this.sidebarEl.classList.contains('closed');
        document.body.classList.toggle('sidebar-open-left', isOpen && this.sidebarEl.classList.contains('pos-left'));
        document.body.classList.toggle('sidebar-open-right', isOpen && this.sidebarEl.classList.contains('pos-right'));
    }

    _onNewDocumentLoaded() {
        this.thumbnailsRendered = false;
        this.outlineLoaded = false;
        this.biblioLoaded = false;
        this.thumbnailObserver?.disconnect();

        if (this.viewOutline) this.viewOutline.innerHTML = '';
        if (this.viewThumbnails) this.viewThumbnails.innerHTML = '';
        const refsList = document.getElementById('refs-list');
        const bookmarksList = document.getElementById('bookmarks-list');
        if (refsList) refsList.innerHTML = '';
        if (bookmarksList) bookmarksList.innerHTML = '';

        if (this.sidebarEl.classList.contains('closed')) return;
        if (this.tabOutline?.classList.contains('active')) this.loadOutline();
        else if (this.tabThumbnails?.classList.contains('active')) this.renderThumbnails();
        else if (this.tabFigures?.classList.contains('active')) this.renderFiguresList();
        else if (this.tabRefs?.classList.contains('active')) this.loadBibliography();
        else if (this.tabBookmarks?.classList.contains('active')) this.renderBookmarksList();
    }

    // =========================================================================
    // 1. SEPARADOR: ÍNDICE NATIVO (OUTLINE)
    // =========================================================================
    async loadOutline() {
        const pdfDoc = this.state.currentSession?.pdfDoc;
        if (!pdfDoc || !this.viewOutline) return;

        try {
            const outline = await pdfDoc.getOutline();
            this.viewOutline.innerHTML = '';

            if (!outline || outline.length === 0) {
                this.viewOutline.innerHTML = `<div class="outline-item italic">${t('no_outline_available', 'Nenhum índice disponível neste PDF.')}</div>`;
                this.outlineLoaded = true;
                return;
            }

            const renderItems = (items, depth = 0, target = this.viewOutline) => {
                items.forEach(item => {
                    const hasChildren = item.items && item.items.length > 0;
                    const group = document.createElement('div');
                    group.className = 'outline-group';

                    const row = document.createElement('div');
                    row.className = 'outline-item';
                    row.style.paddingLeft = `${depth * 14 + 8}px`;

                    const toggleWrapper = document.createElement('div');
                    toggleWrapper.className = 'outline-toggle-wrapper';

                    if (hasChildren) {
                        const toggleBtn = document.createElement('button');
                        toggleBtn.className = 'outline-toggle';
                        toggleBtn.textContent = '-';

                        const children = document.createElement('div');
                        children.className = 'outline-children';

                        toggleBtn.onclick = e => {
                            e.stopPropagation();
                            const collapsed = children.classList.toggle('collapsed');
                            toggleBtn.textContent = collapsed ? '+' : '-';
                        };

                        toggleWrapper.appendChild(toggleBtn);
                        row.appendChild(toggleWrapper);
                        row.insertAdjacentText('beforeend', item.title);
                        group.appendChild(row);

                        renderItems(item.items, depth + 1, children);
                        group.appendChild(children);
                    } else {
                        row.appendChild(toggleWrapper);
                        row.insertAdjacentText('beforeend', item.title);
                        group.appendChild(row);
                    }

                    row.title = item.title;
                    row.onclick = async () => {
                        let dest = item.dest;
                        if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
                        if (Array.isArray(dest) && dest[0]) {
                            const pageIndex = await pdfDoc.getPageIndex(dest[0]);
                            jumpTo(pageIndex + 1, { align: 'top' });
                        }
                    };

                    target.appendChild(group);
                });
            };

            renderItems(outline, 0, this.viewOutline);
            this.outlineLoaded = true;

        } catch (e) {
            this.viewOutline.innerHTML = `<div class="outline-item italic">${t('outline_load_failed', 'Não foi possível carregar o índice deste PDF.')}</div>`;
            logger.error('Erro ao carregar índice do PDF', e);
        }
    }

    // =========================================================================
    // 2. SEPARADOR: MINIATURAS (LAZY LOADING + DRAG & DROP)
    // =========================================================================
    async renderThumbnails() {
        const pdfDoc = this.state.currentSession?.pdfDoc;
        if (!pdfDoc || !this.viewThumbnails) return;

        this.thumbnailsRendered = true;
        this.thumbnailObserver?.disconnect();
        this.viewThumbnails.innerHTML = '';

        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'thumbnail-wrapper';
            wrapper.dataset.pageNumber = i;

            const canvas = document.createElement('canvas');
            const label = document.createElement('div');
            label.className = 'thumbnail-label';
            label.textContent = i;

            const actions = document.createElement('div');
            actions.className = 'thumbnail-actions show-right';
            actions.innerHTML = `
                <button class="btn-thumb-preview" title="${t('open_page_preview', 'Abrir pré-visualização')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="btn-thumb-rotate" title="${t('btn_rotate_page', 'Rodar Página')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.66-5.65"/></svg>
                </button>
                <button class="btn-thumb-delete" title="${t('btn_delete_page', 'Apagar Página')}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            `;

            this._setupThumbnailDragDrop(wrapper, i);

            wrapper.appendChild(canvas);
            wrapper.appendChild(actions);
            wrapper.appendChild(label);

            wrapper.onclick = () => jumpTo(i, { align: 'top' });
            actions.querySelector('.btn-thumb-preview').onclick = e => {
                e.stopPropagation();
                window.showReferencePreview?.(i, `Pág. ${i}`);
            };
            actions.querySelector('.btn-thumb-rotate').onclick = e => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('page-edit-requested', { detail: { action: 'rotate', pageNum: i } }));
            };
            actions.querySelector('.btn-thumb-delete').onclick = e => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('page-edit-requested', { detail: { action: 'delete', pageNum: i } }));
            };
            this.viewThumbnails.appendChild(wrapper);
        }

        // Observador que só desenha miniaturas visíveis no scroll
        this.thumbnailObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting || entry.target.dataset.rendered === 'true') return;
                this._renderSingleThumbnail(entry.target);
            });
        }, { root: this.viewThumbnails.parentElement, rootMargin: '120px' });

        document.querySelectorAll('.thumbnail-wrapper').forEach(w => this.thumbnailObserver.observe(w));
    }

    async _renderSingleThumbnail(wrapper) {
        const pageNum = Number(wrapper.dataset.pageNumber);
        const page = await this.engine.getPage(pageNum);
        const canvas = wrapper.querySelector('canvas');
        const vp = page.getViewport({ scale: 0.25, rotation: (page.rotate || 0) + this.state.pageRotation });

        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);

        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        wrapper.dataset.rendered = 'true';
    }

    _setupThumbnailDragDrop(wrapper, pageNum) {
        wrapper.draggable = true;
        wrapper.ondragstart = e => {
            e.dataTransfer.setData('text/plain', String(pageNum));
            wrapper.style.opacity = '0.5';
        };
        wrapper.ondragend = () => {
            wrapper.style.opacity = '1';
            document.querySelectorAll('.thumbnail-wrapper').forEach(w => w.classList.remove('drag-over'));
        };
        wrapper.ondragover = e => e.preventDefault();
        wrapper.ondragenter = () => wrapper.classList.add('drag-over');
        wrapper.ondragleave = () => wrapper.classList.remove('drag-over');
        wrapper.ondrop = e => {
            e.preventDefault();
            wrapper.classList.remove('drag-over');
            const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
            if (from && from !== pageNum) {
                logger.info(`Reordenar página de ${from} para ${pageNum}`);
                window.dispatchEvent(new CustomEvent('reorder-page', { detail: { from, to: pageNum } }));
            }
        };
    }

    _updateActiveThumbnail(pageNum) {
        document.querySelectorAll('.thumbnail-wrapper').forEach(w => {
            w.classList.toggle('active', Number(w.dataset.pageNumber) === pageNum);
        });
    }

    // =========================================================================
    // 3. SEPARADOR: FIGURAS, TABELAS E EQUAÇÕES
    // =========================================================================
    _setupFiguresToolbar() {
        const btnFilter = document.getElementById('btn-figures-filter');
        const btnSort = document.getElementById('btn-figures-sort');
        const btnSearchToggle = document.getElementById('btn-figures-search-toggle');
        const searchContainer = document.getElementById('figures-search-container');
        const searchInput = document.getElementById('figures-search');

        if (btnFilter) {
            btnFilter.onclick = () => {
                const filters = ['Tudo', 'Figura', 'Tabela', 'Equação', 'Outros'];
                const manager = this.state.currentSession?.elements;
                if (!manager) return;
                const next = filters[(filters.indexOf(manager.activeFilter) + 1) % filters.length];
                manager.setFilter(next);
                btnFilter.textContent = next;
                this.renderFiguresList();
            };
        }

        if (btnSort) {
            btnSort.onclick = () => {
                const manager = this.state.currentSession?.elements;
                if (!manager) return;
                const next = manager.activeSort === 'Agrupado' ? 'Texto' : 'Agrupado';
                manager.setSort(next);
                btnSort.textContent = next;
                this.renderFiguresList();
            };
        }

        if (btnSearchToggle && searchContainer) {
            btnSearchToggle.onclick = () => {
                const isHidden = searchContainer.classList.toggle('hidden');
                if (!isHidden && searchInput) searchInput.focus();
                else if (searchInput) {
                    searchInput.value = '';
                    this.state.currentSession?.elements?.setSearch('');
                    this.renderFiguresList();
                }
            };
        }

        if (searchInput) {
            searchInput.oninput = e => {
                this.state.currentSession?.elements?.setSearch(e.target.value);
                this.renderFiguresList();
            };
        }
    }

    renderFiguresList() {
        const listContainer = document.getElementById('figures-list');
        const manager = this.state.currentSession?.elements;
        if (!listContainer || !manager) return;

        listContainer.innerHTML = '';
        const visible = manager.getVisibleElements();

        const createRow = fig => {
            const row = document.createElement('div');
            row.className = 'outline-item';
            row.style.cssText = 'display:flex; gap:8px; align-items:flex-start; margin-bottom:6px; border-bottom:1px solid #333; padding-bottom:6px; position:relative;';

            row.innerHTML = `
                <div style="flex: 0 0 60px; display:flex; flex-direction:column; gap:2px;">
                    <strong style="color:${fig.getColor()}; font-size:11px;">[${fig.type}]</strong>
                    <span style="color:#888; font-size:10px;">Pág. ${fig.pageNum}</span>
                </div>
                <div style="flex:1; color:${fig.isMention ? '#999' : '#ddd'}; font-size:12px; line-height:1.3; overflow-wrap:anywhere;">
                    ${fig.isMention ? '<em>Citação:</em> ' : ''}${fig.fullText}
                </div>
            `;

            if (fig.isManual) {
                const delBtn = document.createElement('button');
                delBtn.textContent = '×';
                delBtn.style.cssText = 'position:absolute; top:2px; right:2px; background:transparent; border:none; color:#e51400; cursor:pointer; font-size:16px; font-weight:bold;';
                delBtn.onclick = async e => {
                    e.stopPropagation();
                    if (confirm(t('confirm_delete_element', 'Apagar este elemento?'))) {
                        await manager.removeManualElement(fig.id, fig.pageNum);
                        this.renderFiguresList();
                    }
                };
                row.appendChild(delBtn);
            }

            row.onclick = () => {
                jumpTo(fig.pageNum, {
                    pdfY: fig.destY,
                    htmlY: fig.htmlY,
                    align: 'center',
                    flashX: fig.destX,
                    flashW: fig.destW
                });
            };

            return row;
        };

        if (manager.activeSort === 'Agrupado') {
            const { captions, mentions } = visible;
            if (captions.length > 0) {
                const title = document.createElement('strong');
                title.style.cssText = 'color:#fff; font-size:13px; display:block; padding:5px 0;';
                title.textContent = t('captions_detected', 'Legendas Detetadas');
                listContainer.appendChild(title);
                captions.forEach(f => listContainer.appendChild(createRow(f)));
            }
            if (mentions.length > 0) {
                const title = document.createElement('strong');
                title.style.cssText = 'color:#888; font-size:12px; display:block; padding:12px 0 5px 0;';
                title.textContent = t('mentions_detected', 'Menções no Texto');
                listContainer.appendChild(title);
                mentions.forEach(f => listContainer.appendChild(createRow(f)));
            }
        } else {
            visible.forEach(f => listContainer.appendChild(createRow(f)));
        }

        if (listContainer.innerHTML === '') {
            listContainer.innerHTML = `<div class="outline-item italic">${t('no_elements_found', 'Nenhum elemento encontrado.')}</div>`;
        }
    }

    // =========================================================================
    // 4. SEPARADOR: BIBLIOGRAFIA / REFERÊNCIAS
    // =========================================================================
    async loadBibliography() {
        const listContainer = document.getElementById('refs-list');
        const pdfDoc = this.state.currentSession?.pdfDoc;
        if (!listContainer || !pdfDoc) return;

        listContainer.innerHTML = `<div class="outline-item italic">${t('parsing_bibliography', 'A processar referências...')}</div>`;

        try {
            const refs = await pdfParser.extractBibliography(pdfDoc);
            listContainer.innerHTML = '';

            if (refs.length === 0) {
                listContainer.innerHTML = `<div class="outline-item italic">${t('no_biblio_found', 'Nenhuma bibliografia reconhecida.')}</div>`;
                return;
            }

            refs.forEach(ref => {
                const row = document.createElement('div');
                row.className = 'outline-item';
                row.style.cssText = 'white-space:normal; line-height:1.4; margin-bottom:8px; border-bottom:1px solid #333; padding-bottom:8px;';
                row.innerHTML = `<strong style="color:#0376db;">${ref.getFormattedLabel()}</strong> <span style="color:#ddd; font-size:12px;">${ref.text}</span>`;

                row.onclick = () => {
                    jumpTo(ref.pageNum, { pdfY: ref.pdfY, align: 'center', flashX: ref.pdfX, flashW: ref.pdfW * 3 });
                };
                listContainer.appendChild(row);
            });

            this.biblioLoaded = true;
        } catch (e) {
            listContainer.innerHTML = `<div class="outline-item italic">${t('bibliography_load_failed', 'Não foi possível carregar as referências.')}</div>`;
            logger.error('Erro na extração de bibliografia', e);
        }
    }

    // =========================================================================
    // 5. SEPARADOR: MARCADORES (BOOKMARKS COM HISTÓRICO E EDIÇÃO)
    // =========================================================================
    async renderBookmarksList() {
        const listContainer = document.getElementById('bookmarks-list');
        const bmkManager = this.state.currentSession?.bookmarks;
        if (!listContainer || !bmkManager) return;

        const renderId = ++this.bookmarksRenderId;
        let all;
        try {
            all = await bmkManager.getAllBookmarks();
        } catch (error) {
            if (renderId !== this.bookmarksRenderId) return;
            listContainer.innerHTML = '';
            listContainer.textContent = t('bookmarks_load_failed', 'Não foi possível carregar os marcadores.');
            logger.error('Não foi possível carregar os marcadores guardados.', error);
            return;
        }
        if (renderId !== this.bookmarksRenderId) return;
        listContainer.innerHTML = '';

        if (all.length === 0) {
            listContainer.innerHTML = `<div class="outline-item italic">${t('no_bookmarks_created', 'Nenhum marcador criado.<br><br><b>Alt+Click</b> no PDF para criar um na margem.')}</div>`;
            return;
        }

        all.forEach(bmk => {
            const row = document.createElement('div');
            row.className = 'outline-item';
            row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:6px; border-bottom:1px solid #333;';

            const info = document.createElement('div');
            info.style.cssText = 'flex:1; cursor:pointer; overflow:hidden; text-overflow:ellipsis;';
            info.innerHTML = `<strong style="color:#aaa;">Pág ${bmk.pageNum}</strong> - <span style="color:#ddd; font-size:12px;">${bmk.title}</span>`;
            info.onclick = () => jumpTo(bmk.pageNum, { htmlY: bmk.y, align: 'center' });

            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex; gap:4px;';

            // Editar Título
            const btnEdit = document.createElement('button');
            btnEdit.className = 'list-action-btn';
            btnEdit.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
            btnEdit.onclick = async () => {
                const newTitle = prompt(t('rename_bookmark', 'Novo nome do marcador:'), bmk.title);
                if (newTitle && newTitle.trim()) {
                    await bmkManager.updateTitle(bmk.id, bmk.pageNum, newTitle.trim());
                }
            };

            // Apagar Marcador
            const btnDel = document.createElement('button');
            btnDel.className = 'list-action-btn delete-btn';
            btnDel.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
            btnDel.onclick = async () => {
                await bmkManager.removeBookmark(bmk.id, bmk.pageNum);
            };

            actions.appendChild(btnEdit);
            actions.appendChild(btnDel);
            row.appendChild(info);
            row.appendChild(actions);
            listContainer.appendChild(row);
        });
    }
}