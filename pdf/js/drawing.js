import { state } from './state.js';
import { record } from './history.js';

let isDrawing = false;
let currentPath = [];
let activeCanvas = null;
let activeCtx = null;
let currentPageNum = null;

function drawingKey(pageNum) {
    return `${state.currentFilename}_pg${pageNum}_drawings`;
}

function saveDrawingStorage(pageNum) {
    chrome.storage.local.set({ [drawingKey(pageNum)]: state.drawings?.[pageNum] || [] });
}

export function setupDrawingTools() {
    document.querySelectorAll('.drawing-canvas').forEach(canvas => {
        canvas.classList.toggle('active', state.freehandActive);
    });
}

export function initDrawingLayer(wrapper, pageNum) {
    const canvas = wrapper.querySelector('.drawing-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const finishDrawing = () => {
        if (!isDrawing || activeCanvas !== canvas) return;
        isDrawing = false;
        if (currentPath.length < 2) {
            currentPath = [];
            return;
        }

        const drawing = {
            path: [...currentPath],
            color: state.currentAnnotationColor,
            size: state.currentAnnotationSize
        };
        state.drawings = state.drawings || {};
        state.drawings[pageNum] = state.drawings[pageNum] || [];
        state.drawings[pageNum].push(drawing);
        saveDrawingStorage(pageNum);
        record({
            label: 'Desenho livre',
            undo: () => {
                state.drawings[pageNum] = (state.drawings[pageNum] || []).filter(item => item !== drawing);
                redrawCanvas(pageNum);
                saveDrawingStorage(pageNum);
            },
            redo: () => {
                state.drawings[pageNum] = state.drawings[pageNum] || [];
                if (!state.drawings[pageNum].includes(drawing)) state.drawings[pageNum].push(drawing);
                redrawCanvas(pageNum);
                saveDrawingStorage(pageNum);
            }
        });
        currentPath = [];
    };

    canvas.onmousedown = event => {
        if (!state.freehandActive) return;
        isDrawing = true;
        currentPageNum = pageNum;
        activeCanvas = canvas;
        activeCtx = ctx;
        const rect = canvas.getBoundingClientRect();
        const point = {
            x: (event.clientX - rect.left) / rect.width,
            y: (event.clientY - rect.top) / rect.height
        };
        currentPath = [point];
        ctx.beginPath();
        ctx.moveTo(point.x * canvas.width, point.y * canvas.height);
        ctx.strokeStyle = state.currentAnnotationColor;
        ctx.lineWidth = state.currentAnnotationSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    };
    canvas.onmousemove = event => {
        if (!isDrawing || activeCanvas !== canvas) return;
        const rect = canvas.getBoundingClientRect();
        const point = {
            x: (event.clientX - rect.left) / rect.width,
            y: (event.clientY - rect.top) / rect.height
        };
        currentPath.push(point);
        activeCtx.lineTo(point.x * canvas.width, point.y * canvas.height);
        activeCtx.stroke();
    };
    canvas.onmouseup = finishDrawing;
    canvas.onmouseleave = finishDrawing;
    canvas.classList.toggle('active', state.freehandActive);

    // apagar quer anotações quer desenhos
    wrapper.addEventListener('click', (event) => {
        if (!state.eraserActive) return;
        
        if (event.target.classList.contains('annotation-mark')) return;

        const rect = canvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;

        const drawings = state.drawings[pageNum] || [];
        let removeIndex = -1;
        let strokeToRemove = null;

        for (let i = drawings.length - 1; i >= 0; i--) {
            const stroke = drawings[i];
            
            const isHit = stroke.path.some(p => {
                const px = p.x * rect.width;
                const py = p.y * rect.height;
                const dist = Math.sqrt(Math.pow(px - clickX, 2) + Math.pow(py - clickY, 2));
                return dist < (stroke.size / 2 + 6);
            });

            if (isHit) {
                removeIndex = i;
                strokeToRemove = stroke;
                break;
            }
        }

        if (removeIndex !== -1) {
            state.drawings[pageNum].splice(removeIndex, 1);
            redrawCanvas(pageNum);
            saveDrawingStorage(pageNum);
            
            record({
                label: 'Apagar desenho',
                undo: () => {
                    state.drawings[pageNum].splice(removeIndex, 0, strokeToRemove);
                    redrawCanvas(pageNum);
                    saveDrawingStorage(pageNum);
                },
                redo: () => {
                    state.drawings[pageNum].splice(removeIndex, 1);
                    redrawCanvas(pageNum);
                    saveDrawingStorage(pageNum);
                }
            });
        }
    });
}

function drawStoredPath(pageNum, path, color, size) {
    const canvas = document.querySelector(`#page-wrapper-${pageNum} .drawing-canvas`);
    if (!canvas || path.length < 2) return;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(path[0].x * canvas.width, path[0].y * canvas.height);
    path.slice(1).forEach(point => ctx.lineTo(point.x * canvas.width, point.y * canvas.height));
    ctx.stroke();
}

function redrawCanvas(pageNum) {
    const canvas = document.querySelector(`#page-wrapper-${pageNum} .drawing-canvas`);
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    (state.drawings?.[pageNum] || []).forEach(drawing => {
        drawStoredPath(pageNum, drawing.path, drawing.color, drawing.size);
    });
}

export function resizeDrawingCanvas(pageNum, width, height) {
    const canvas = document.querySelector(`#page-wrapper-${pageNum} .drawing-canvas`);
    if (!canvas) return;
    canvas.width = Math.floor(width);
    canvas.height = Math.floor(height);
    canvas.style.width = `${Math.floor(width)}px`;
    canvas.style.height = `${Math.floor(height)}px`;
    redrawCanvas(pageNum);
}

export async function loadDrawingsForPage(pageNum) {
    state.drawings = state.drawings || {};
    const key = drawingKey(pageNum);
    const result = await chrome.storage.local.get(key);
    state.drawings[pageNum] = result[key] || [];
    redrawCanvas(pageNum);
}