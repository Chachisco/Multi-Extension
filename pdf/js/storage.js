import { state } from './state.js';

export function annotationKey(pageNum) {
    return `${state.currentFilename}_pg${pageNum}_annotations`;
}

export function annotationId(annotation) {
    return JSON.stringify([
        annotation.mode,
        annotation.color,
        annotation.size,
        annotation.x,
        annotation.y,
        annotation.width,
        annotation.height
    ]);
}

export function saveState() {
    chrome.storage.local.set({
        [state.currentFilename + '_zoom']: state.currentScale,
        global_header_mode: state.headerMode
    });
}

export function readViewerState() {
    return new Promise(resolve => {
        chrome.storage.local.get([
            state.currentFilename,
            state.currentFilename + '_zoom',
            'global_header_mode'
        ], resolve);
    });
}