import { state } from './state.js';

const btnToggle = document.getElementById('btn-toggle-sidebar');
const sidebar = document.getElementById('pdf-sidebar');
const tabOutline = document.getElementById('tab-outline');
const tabThumbnails = document.getElementById('tab-thumbnails');
const viewOutline = document.getElementById('outline-view');
const viewThumbnails = document.getElementById('thumbnails-view');
const viewport = document.getElementById('viewport');
let thumbnailsRendered = false;

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

if (btnToggle) {
    btnToggle.onclick = () => {
        sidebar.classList.toggle('closed');
        if (!sidebar.classList.contains('closed')) {
            loadOutline();
        }
    };
}

tabOutline.onclick = () => {
    tabOutline.classList.add('active'); tabThumbnails.classList.remove('active');
    viewOutline.classList.remove('hidden'); viewThumbnails.classList.add('hidden');
};

tabThumbnails.onclick = () => {
    tabThumbnails.classList.add('active'); tabOutline.classList.remove('active');
    viewThumbnails.classList.remove('hidden'); viewOutline.classList.add('hidden');
    if (!thumbnailsRendered) renderThumbnails();
};

export function toggleSidebarSide() {
    const isLeft = sidebar.classList.contains('pos-left');
    sidebar.classList.toggle('pos-left', !isLeft);
    sidebar.classList.toggle('pos-right', isLeft);
}

const btnSide = document.getElementById('btn-sidebar-side');
if (btnSide) {
    btnSide.onclick = toggleSidebarSide;
}

window.addEventListener('keydown', (e) => {
    if (!sidebar || sidebar.classList.contains('closed')) return;
    if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return;

    if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        sidebar.classList.remove('pos-left');
        sidebar.classList.add('pos-right');
    }

    if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        sidebar.classList.remove('pos-right');
        sidebar.classList.add('pos-left');
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
    viewThumbnails.innerHTML = '';

    for (let i = 1; i <= state.pdfDoc.numPages; i++) {
        const thumbWrapper = document.createElement('div');
        thumbWrapper.className = 'thumbnail-wrapper';
        thumbWrapper.id = `thumb-${i}`;
        
        const canvas = document.createElement('canvas');
        const label = document.createElement('div');
        label.className = 'thumbnail-label';
        label.textContent = i;

        thumbWrapper.appendChild(canvas);
        thumbWrapper.appendChild(label);
        viewThumbnails.appendChild(thumbWrapper);

        thumbWrapper.onclick = () => {
            if (document.getElementById(`page-wrapper-${i}`)) {
                scrollToPage(i);

                document.querySelectorAll('.thumbnail-wrapper').forEach(w => w.classList.remove('active'));
                thumbWrapper.classList.add('active');
            }
        };

        state.pdfDoc.getPage(i).then(page => {
            const viewport = page.getViewport({ scale: 0.2 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            page.render({ canvasContext: ctx, viewport: viewport });
        });
    }
}
