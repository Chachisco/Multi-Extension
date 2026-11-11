import { logger } from '../services/LoggerService.js';

const ACTION_ICONS = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4z"/></svg>',
    highlight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
    underline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 20h16"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>',
    textbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>',
    apply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>'
};

export class SelectionToolbar {
    constructor(container = document.body) {
        this.element = document.createElement('div');
        this.element.className = 'pdf-selection-toolbar';
        this.element.hidden = true;
        this.container = container;
        this.container.appendChild(this.element);

        window.addEventListener('resize', () => this.position());
        window.addEventListener('scroll', () => this.position(), true);
    }

    show(target, actions, controls = []) {
        this.target = target;
        this.element.replaceChildren();

        controls.forEach(control => this.element.appendChild(control));
        actions.forEach(({ label, title = label, icon, onClick }) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.title = title;
            button.setAttribute('aria-label', label);
            if (ACTION_ICONS[icon]) {
                button.innerHTML = ACTION_ICONS[icon];
            } else {
                button.textContent = label;
            }
            button.addEventListener('click', event => {
                event.stopPropagation();
                Promise.resolve().then(onClick).catch(error => {
                    logger.error('Não foi possível executar a ação do objeto selecionado.', error);
                });
            });
            this.element.appendChild(button);
        });

        this.element.hidden = false;
        this.position();
    }

    showAt(rect, actions, controls = []) {
        this.show({
            isConnected: true,
            getBoundingClientRect: () => rect
        }, actions, controls);
    }

    position() {
        if (this.element.hidden || !this.target?.isConnected || !this.target.getBoundingClientRect) return;

        const rect = this.target.getBoundingClientRect();
        const toolbarRect = this.element.getBoundingClientRect();
        const left = Math.max(8, Math.min(
            rect.left,
            window.innerWidth - toolbarRect.width - 8
        ));
        const top = rect.top >= toolbarRect.height + 16
            ? rect.top - toolbarRect.height - 8
            : rect.bottom + 8;

        this.element.style.left = `${left}px`;
        this.element.style.top = `${Math.max(8, Math.min(top, window.innerHeight - toolbarRect.height - 8))}px`;
    }

    hide() {
        this.element.hidden = true;
        this.target = null;
        this.element.replaceChildren();
    }
}
