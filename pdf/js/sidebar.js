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
            loadOutline(); // Tenta carregar o índice quando abre
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
    if (!thumbnailsRendered) renderThumbnails(); // Só desenha as fotos das páginas na primeira vez!
};

async function loadOutline() {
    if (!state.pdfDoc || viewOutline.innerHTML !== '') return;
    
    try {
        const outline = await state.pdfDoc.getOutline();
        
        if (!outline || outline.length === 0) {
            viewOutline.innerHTML = '<div class="outline-item italic">Nenhum índice disponível neste PDF.</div>';
            return;
        }

        const renderItems = (items, depth = 0) => {
            items.forEach(item => {
                const div = document.createElement('div');
                div.className = 'outline-item';
                div.textContent = item.title;
                div.title = item.title;
                div.style.paddingLeft = `${depth * 15 + 8}px`;

                    div.onclick = async () => {
                        try {
                            const pageNum = await getOutlinePageNumber(item);
                            if (pageNum) scrollToPage(pageNum);
                        } catch (error) {
                            console.error('Erro ao navegar para o item do índice', error);
                        }
                };
                
                viewOutline.appendChild(div);
                
                if (item.items && item.items.length > 0) {
                    renderItems(item.items, depth + 1);
                }
            });
        };
        
        renderItems(outline);
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
