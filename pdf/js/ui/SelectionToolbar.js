import { logger } from '../services/LoggerService.js';

const ACTION_ICONS = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>'
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

    show(target, actions) {
        this.target = target;
        this.element.replaceChildren();

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

    position() {
        if (this.element.hidden || !this.target?.isConnected) return;

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
