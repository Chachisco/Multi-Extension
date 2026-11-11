export function parseRichText(str) {
    if (!str) return '';
    
    let html = str
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') 
        .replace(/\n/g, '<br>');

    // Setas e Lógica
    html = html.replace(/&lt;=&gt;/g, '⇔')
               .replace(/=&gt;/g, '⇒')
               .replace(/&lt;-/g, '←')
               .replace(/-&gt;/g, '→')
               .replace(/&gt;=/g, '≥')
               .replace(/&lt;=/g, '≤')
               .replace(/!=/g, '≠')
               .replace(/~=/g, '≈')
               .replace(/\\\+-/g, '±');

    // Greek alphabet and Math Symbols
    const symbolsMap = {
        '/alpha': 'α', '/Alpha': 'Α',
        '/beta': 'β', '/Beta': 'Β',
        '/gamma': 'γ', '/Gamma': 'Γ',
        '/delta': 'δ', '/Delta': 'Δ',
        '/epsilon': 'ε', '/Epsilon': 'Ε',
        '/zeta': 'ζ', '/Zeta': 'Ζ',
        '/eta': 'η', '/Eta':'Η',
        '/theta': 'θ', '/Theta': 'Θ',
        '/iota': 'ι', '/Iota': 'Ι',
        '/kappa': 'κ', '/Kappa': 'Κ',
        '/lambda': 'λ', '/Lambda': 'Λ',
        '/mu': 'μ', '/Mu': 'Μ',
        '/nu': 'ν', '/Nu': 'Ν',
        '/xi': 'ξ', '/Xi': 'Ξ',
        '/omicron': 'ο', '/Omicron': 'Ο',
        '/pi': 'π', '/Pi': 'Π',
        '/rho': 'ρ', '/Rho': 'Ρ',
        '/sigma': 'σ', '/Sigma': 'Σ',
        '/tau': 'τ', '/Tau': 'Τ',
        '/upsilon': 'υ', '/Upsilon': 'Υ',
        '/phi': 'φ', '/Phi': 'Φ',
        '/chi': 'χ', '/Chi': 'Χ',
        '/psi': 'ψ', '/Psi': 'Ψ',
        '/omega': 'ω', '/Omega': 'Ω',
        '/inf': '∞', '/int': '∫',
        '/iint': '∬', '/oint': '∮',
        '/sum': '∑', '/prod': '∏',
        '/nabla': '∇', '/part': '∂',
        '/sqrt': '√', '/pm': '±', '/mp': '∓', '/times': '×', '/div': '÷',
        '/cdot': '⋅', '/propto': '∝', '/neq': '≠', '/leq': '≤', '/geq': '≥',
        '/approx': '≈', '/equiv': '≡', '/sim': '∼', '/cong': '≅',
        '/forall': '∀', '/exists': '∃', '/nexists': '∄', '/in': '∈',
        '/notin': '∉', '/subset': '⊂', '/subseteq': '⊆', '/union': '∪',
        '/intersect': '∩', '/emptyset': '∅', '/and': '∧', '/or': '∨',
        '/not': '¬', '/therefore': '∴', '/because': '∵', '/->': '→',
        '/rightarrow': '→', '/<-': '←', '/leftarrow': '←', '/<->': '↔',
        '/leftrightarrow': '↔', '/=>': '⇒', '/Rightarrow': '⇒', '/<=>': '⇔',
        '/Leftrightarrow': '⇔', '/uparrow': '↑', '/downarrow': '↓',
        '/R': 'ℝ', '/N': 'ℕ', '/Z': 'ℤ', '/Q': 'ℚ', '/C': 'ℂ',
        '/degree': '°', '/angle': '∠', '/perp': '⊥', '/parallel': '∥', '/aleph': 'ℵ'
    };
    
    Object.keys(symbolsMap).forEach(key => {
        html = html.replace(new RegExp(key, 'g'), symbolsMap[key]);
    });

    // Formatação Markdown Base
    html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.08); padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 11.5px; color: #b9770e;">$1</code>');
    html = html.replace(/__(?!\s)(.*?)(?<!\s)__/g, '<u>$1</u>');
    html = html.replace(/\*\*(?!\s)(.*?)(?<!\s)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(?!\s)(.*?)(?<!\s)\*/g, '<em>$1</em>');
    html = html.replace(/==(?!\s)(.*?)(?<!\s)==/g, '<mark style="background: rgba(255, 215, 64, 0.6); padding: 0 3px; border-radius: 2px;">$1</mark>');
    html = html.replace(/\[ \]/g, '<input type="checkbox" disabled style="margin: 0 4px 0 0; vertical-align: middle;">');
    html = html.replace(/\[[xX]\]/g, '<input type="checkbox" checked disabled style="margin: 0 4px 0 0; vertical-align: middle;">');

    // Subscritos e Sobrescritos (Matemática)
    const base = '([a-zA-Z0-9α-ωΑ-Ω)\\]])';
    html = html.replace(new RegExp(base + '_\\\[([^\\]]+)\\\]', 'g'), '$1<sub>$2</sub>');
    html = html.replace(new RegExp(base + '\\\^\\\[([^\\]]+)\\\]', 'g'), '$1<sup>$2</sup>');
    html = html.replace(new RegExp(base + '_([a-zA-Z0-9]+)', 'g'), '$1<sub>$2</sub>');
    html = html.replace(new RegExp(base + '\\\^([a-zA-Z0-9]+)', 'g'), '$1<sup>$2</sup>');

    return html;
}