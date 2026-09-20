import { state } from './state.js';
import { reorderPDFPages, deleteSinglePage, rotateSinglePage } from './pdf_editor.js';



const btnToggle = document.getElementById('btn-toggle-sidebar');
const btnClose = document.getElementById('btn-close-sidebar');
const sidebar = document.getElementById('pdf-sidebar');
const tabOutline = document.getElementById('tab-outline');
const tabThumbnails = document.getElementById('tab-thumbnails');
const viewOutline = document.getElementById('outline-view');
const viewThumbnails = document.getElementById('thumbnails-view');
const viewport = document.getElementById('viewport');
let thumbnailsRendered = false;
let thumbnailObserver = null;

function scrollToPage(pageNum) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper || !viewport) return;

    document.getElementById('page-input').value = pageNum;
    viewport.scrollTo({
        top: Math.max(0, wrapper.offsetTop - 42),
        behavior: 'smooth'
    });
}

async function getOutlinePageNumber(item) {
    let destination = item.dest;
    if (typeof destination === 'string') {
        destination = await state.pdfDoc.getDestination(destination);
    }
    if (!Array.isArray(destination) || !destination[0]) return null;

    return (await state.pdfDoc.getPageIndex(destination[0])) + 1;
}

export function toggleSidebar() {
    sidebar.classList.toggle('closed');
    updateViewerLayout();
    if (!sidebar.classList.contains('closed')) {
        loadOutline();
    }
}

export function updateViewerLayout() {
    document.body.classList.toggle('sidebar-open-left', !sidebar.classList.contains('closed') && sidebar.classList.contains('pos-left'));
    document.body.classList.toggle('sidebar-open-right', !sidebar.classList.contains('closed') && sidebar.classList.contains('pos-right'));
}

if (btnToggle) btnToggle.onclick = toggleSidebar;
if (btnClose) btnClose.onclick = toggleSidebar;

tabOutline.onclick = () => {
    tabOutline.classList.add('active'); tabThumbnails.classList.remove('active');
    viewOutline.classList.remove('hidden'); viewThumbnails.classList.add('hidden');
};

tabThumbnails.onclick = () => {
    tabThumbnails.classList.add('active'); tabOutline.classList.remove('active');
    viewThumbnails.classList.remove('hidden'); viewOutline.classList.add('hidden');
    if (!thumbnailsRendered) renderThumbnails();
    else updateActiveThumbnail(Number(document.getElementById('page-input').value));
};

window.addEventListener('pdf-rotation-changed', () => {
    if (!thumbnailsRendered || viewThumbnails.classList.contains('hidden')) return;
    thumbnailsRendered = false;
    renderThumbnails();
});

window.addEventListener('pdf-document-loaded', () => {
    thumbnailObserver?.disconnect();
    thumbnailObserver = null;
    thumbnailsRendered = false;
    viewThumbnails.innerHTML = '';
    viewOutline.innerHTML = '';

    if (tabThumbnails.classList.contains('active') && !sidebar.classList.contains('closed')) {
        renderThumbnails();
    }
});

window.addEventListener('pdf-page-changed', event => {
    updateActiveThumbnail(event.detail.pageNum);
});

function updateActiveThumbnail(pageNum) {
    document.querySelectorAll('.thumbnail-wrapper').forEach(wrapper => {
        wrapper.classList.toggle('active', Number(wrapper.dataset.pageNumber) === pageNum);
    });
}

export function toggleSidebarSide() {
    const isLeft = sidebar.classList.contains('pos-left');
    sidebar.classList.toggle('pos-left', !isLeft);
    sidebar.classList.toggle('pos-right', isLeft);
    updateViewerLayout();
}

const btnSide = document.getElementById('btn-sidebar-side');
if (btnSide) {
    btnSide.onclick = toggleSidebarSide;
}

updateViewerLayout();

window.addEventListener('keydown', (e) => {
    if (!sidebar || sidebar.classList.contains('closed')) return;
    if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return;

    if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        sidebar.classList.remove('pos-left');
        sidebar.classList.add('pos-right');
        updateViewerLayout();
    }

    if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        sidebar.classList.remove('pos-right');
        sidebar.classList.add('pos-left');
        updateViewerLayout();
    }
});

// 3. CARREGAR O ÍNDICE NATIVO (OUTLINE)
async function loadOutline() {
    if (!state.pdfDoc || viewOutline.innerHTML !== '') return;
    
    try {
        const outline = await state.pdfDoc.getOutline();
        
        if (!outline || outline.length === 0) {
            viewOutline.innerHTML = '<div class="outline-item italic">Nenhum índice disponível neste PDF.</div>';
            return;
        }

        const renderItems = (items, depth = 0, target = viewOutline) => {
            items.forEach(item => {
                const hasChildren = item.items && item.items.length > 0;
                const group = document.createElement('div');
                group.className = 'outline-group';

                const row = document.createElement('div');
                row.className = 'outline-item';
                row.style.paddingLeft = `${depth * 15 + 8}px`; // Recua se for sub-capítulo

                if (hasChildren) {
                    const toggle = document.createElement('button');
                    toggle.className = 'outline-toggle';
                    toggle.type = 'button';
                    toggle.textContent = '-';
                    toggle.setAttribute('aria-label', `Recolher ${item.title}`);

                    const children = document.createElement('div');
                    children.className = 'outline-children';
                    toggle.onclick = event => {
                        event.stopPropagation();
                        const collapsed = children.classList.toggle('collapsed');
                        toggle.textContent = collapsed ? '+' : '-';
                        toggle.setAttribute('aria-label', `${collapsed ? 'Expandir' : 'Recolher'} ${item.title}`);
                    };
                    row.appendChild(toggle);
                    group.appendChild(row);

                    row.insertAdjacentText('beforeend', item.title);
                    renderItems(item.items, depth + 1, children);
                    group.appendChild(children);
                } else {
                    row.textContent = item.title;
                    group.appendChild(row);
                }

                row.title = item.title;
                row.onclick = async () => {
                        try {
                            const pageNum = await getOutlinePageNumber(item);
                            if (pageNum) scrollToPage(pageNum);
                        } catch (error) {
                            console.error('Erro ao navegar para o item do índice', error);
                        }
                };

                target.appendChild(group);
            });
        };
        
        renderItems(outline, 0, viewOutline);
    } catch (e) {
        console.error("Erro ao carregar o Índice", e);
    }
}

async function renderThumbnails() {
    if (!state.pdfDoc) return;
    thumbnailsRendered = true;
    thumbnailObserver?.disconnect();
    viewThumbnails.innerHTML = '';

    for (let i = 1; i <= state.pdfDoc.numPages; i++) {
        const thumbWrapper = document.createElement('div');
        thumbWrapper.className = 'thumbnail-wrapper';
        thumbWrapper.id = `thumb-${i}`;
        thumbWrapper.dataset.pageNumber = i;
        
        const canvas = document.createElement('canvas');
        const label = document.createElement('div');
        label.className = 'thumbnail-label';
        label.textContent = i;

        // --- CRIAR O MENU FLUTUANTE DE AÇÕES ---
        const actions = document.createElement('div');
        actions.className = 'thumbnail-actions show-right'; // Padrão à direita
        
        // Botão Rodar 90º
        const btnRotate = document.createElement('button');
        btnRotate.title = "Rodar Página";
        btnRotate.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.66-5.65"/></svg>`;
        btnRotate.onclick = (e) => {
            e.stopPropagation();
            console.log("Rodar página", i);
            rotateSinglePage(i, 90)
        };

        // Botão Apagar Página
        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn-thumb-delete';
        btnDelete.title = "Apagar Página";
        btnDelete.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
        btnDelete.onclick = (e) => {
            e.stopPropagation();
             if (state.pdfDoc.numPages <= 1) {
                alert("Não podes apagar a única página do documento!");
                return;
            }
            if(confirm(`Tens a certeza que queres apagar a página ${i}?`)) {
                console.log("Apagar página", i);
                deleteSinglePage(i)
            }
        };

        thumbWrapper.draggable = true;
        
        thumbWrapper.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', i);
            thumbWrapper.style.opacity = '0.5';
        };
        
        thumbWrapper.ondragend = () => {
            thumbWrapper.style.opacity = '1';
            document.querySelectorAll('.thumbnail-wrapper').forEach(w => w.classList.remove('drag-over'));
        };
        
        thumbWrapper.ondragover = (e) => {
            e.preventDefault();
        };

        // Entrar na zona: Adiciona a linha azul
        thumbWrapper.ondragenter = (e) => {
            e.preventDefault();
            thumbWrapper.classList.add('drag-over');
        };

        // Sair da zona: Remove a linha azul
        thumbWrapper.ondragleave = (e) => {
            thumbWrapper.classList.remove('drag-over');
        };

        thumbWrapper.ondrop = (e) => {
            e.preventDefault();
            thumbWrapper.classList.remove('drag-over');
            const fromPage = parseInt(e.dataTransfer.getData('text/plain'), 10);
            const toPage = i;

            if (fromPage !== toPage && fromPage) {
                reorderPDFPages(fromPage, toPage);
            }
        };

        actions.appendChild(btnRotate);
        actions.appendChild(btnDelete);

        thumbWrapper.onmouseenter = () => {
            const rect = thumbWrapper.getBoundingClientRect();
            const sidebarRect = viewThumbnails.getBoundingClientRect();
            if (rect.right > sidebarRect.right - 50) {
                actions.classList.replace('show-right', 'show-left');
            } else {
                actions.classList.replace('show-left', 'show-right');
            }
        };

        thumbWrapper.appendChild(canvas);
        thumbWrapper.appendChild(actions);
        thumbWrapper.appendChild(label);
        viewThumbnails.appendChild(thumbWrapper);

        thumbWrapper.onclick = () => {
            scrollToPage(i);
            document.querySelectorAll('.thumbnail-wrapper').forEach(w => w.classList.remove('active'));
            thumbWrapper.classList.add('active');
        };
    }

    thumbnailObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting || entry.target.dataset.rendered === 'true') return;
            renderThumbnail(entry.target);
        });
    }, { root: viewThumbnails.parentElement, rootMargin: '160px' });
    document.querySelectorAll('.thumbnail-wrapper').forEach(wrapper => thumbnailObserver.observe(wrapper));
    updateActiveThumbnail(Number(document.getElementById('page-input').value));
}

async function renderThumbnail(wrapper) {
    const pageNum = Number(wrapper.dataset.pageNumber);
    const canvas = wrapper.querySelector('canvas');
    const page = await state.pdfDoc.getPage(pageNum);
    const thumbnailViewport = page.getViewport({ scale: 0.3, rotation: (page.rotate || 0) + state.pageRotation });
    canvas.width = Math.ceil(thumbnailViewport.width);
    canvas.height = Math.ceil(thumbnailViewport.height);
    await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: thumbnailViewport
    }).promise;
    wrapper.dataset.rendered = 'true';
}
