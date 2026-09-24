/* ══════════════════════════════════════════════════════════
   ICON SUGGEST — icônes proposées d'après le NOM du module + son UE
   (demande Ahmed 2026-07-19). Table de mots-clés → icônes Lucide :
   on concatène nom + UE (minuscule, sans accents) et chaque règle
   dont un mot-clé apparaît verse ses icônes, dédupliquées, dans
   l'ordre des règles. Zéro correspondance = pas de suggestion (le
   picker affiche juste sa grille). Domaines orientés informatique
   (les modules d'Ahmed : réseau, cyber, système…) + académique large.

   LA PREMIÈRE SUGGESTION EST AUSSI L'ICÔNE PAR DÉFAUT d'un module sans
   choix (`moduleIcon`, module-icons.ts) : un livre partout ne disait rien
   de la matière (Ahmed, 2026-09-24). L'ordre des règles compte donc : la
   plus SPÉCIFIQUE d'abord (« Ethical Hacking » est du hacking avant d'être
   de la sécurité ; « Architecture logicielle » de la conception avant du
   code).

   Un mot-clé se cherche en DÉBUT DE MOT, et en MOT ENTIER s'il fait trois
   lettres ou moins : « ui » trouvait « outils », « os » et « systeme »
   trouvaient « écosystème ». Un préfixe (« securit », « reseau ») couvre
   ses dérivés.
══════════════════════════════════════════════════════════ */

interface Rule {
	keys: string[];
	icons: string[];
}

const RULES: Rule[] = [
	{ keys: ["hacking", "hacker", "pentest", "osint", "exploit", "attaque", "intrusion", "ctf", "tryhackme"], icons: ["hat-glasses", "scan-search", "bug", "shield-alert"] },
	{ keys: ["soc", "siem", "incident", "supervision", "detection"], icons: ["siren", "radar", "activity"] },
	{ keys: ["audit", "conformite", "iso", "norme"], icons: ["clipboard-check", "file-check", "list-checks"] },
	{ keys: ["veille", "actualite", "information"], icons: ["radar", "newspaper", "rss"] },
	{ keys: ["conception", "architecture", "uml", "modelisation", "urbanisation"], icons: ["blocks", "workflow", "layers", "component"] },
	{ keys: ["python", "java", "rust", "golang", "kotlin", "php"], icons: ["braces", "code", "terminal", "file-code"] },
	{ keys: ["scripting", "script", "shell", "bash", "powershell", "ligne de commande"], icons: ["square-terminal", "terminal", "file-code"] },
	{ keys: ["ccna", "cisco", "reseau", "network", "routage", "routeur", "commutation", "lan", "wan", "tcp"], icons: ["router", "network", "wifi", "share-2"] },
	{ keys: ["cloud", "infrastructure", "virtualis", "conteneur", "docker", "kubernetes", "devops"], icons: ["cloud", "server", "container", "boxes"] },
	{ keys: ["cyber", "securit", "protection", "chiffrement", "cryptograph", "vulnerab", "forensic"], icons: ["shield-check", "shield", "lock", "key-round", "fingerprint"] },
	{ keys: ["parc informatique", "poste de travail", "helpdesk", "support"], icons: ["monitor", "laptop", "wrench"] },
	{ keys: ["systeme", "exploitation", "administration", "serveur", "server", "os", "unix", "linux", "windows"], icons: ["server-cog", "server", "monitor-cog", "hard-drive"] },
	{ keys: ["programmation", "developpement", "logiciel", "code", "algorithm", "poo", "objet", "compilation"], icons: ["code", "braces", "terminal", "file-code"] },
	{ keys: ["web", "internet", "html", "frontend", "javascript", "site"], icons: ["globe", "code-xml", "layout-panel-top"] },
	{ keys: ["base de donnee", "donnee", "data", "sql", "bdd", "nosql"], icons: ["database", "table-2"] },
	{ keys: ["math", "calcul", "statistique", "algebre", "analyse", "probabilit"], icons: ["sigma", "calculator", "square-function"] },
	{ keys: ["physique", "chimie", "biologie", "science"], icons: ["atom", "flask-conical", "microscope"] },
	{ keys: ["electronique", "circuit", "materiel", "hardware", "microcontroleur", "processeur"], icons: ["cpu", "circuit-board", "memory-stick"] },
	{ keys: ["ia", "intelligence artificielle", "machine learning", "apprentissage automatique", "neuron", "big data", "llm"], icons: ["brain", "bot", "sparkles"] },
	{ keys: ["collaborat", "equipe", "teamwork"], icons: ["users", "messages-square", "handshake"] },
	{ keys: ["projet", "gestion", "management", "agile", "scrum", "moa", "maitrise d'ouvrage", "hackathon"], icons: ["briefcase", "list-checks", "kanban"] },
	{ keys: ["professionnel", "carriere", "stage", "entreprise"], icons: ["briefcase-business", "id-card", "handshake"] },
	{ keys: ["english", "anglais", "langue", "language", "intercultural", "interculturel"], icons: ["languages", "globe", "book-a"] },
	{ keys: ["communication", "expression", "redaction", "oral", "verbale"], icons: ["message-square", "mic", "presentation"] },
	{ keys: ["design", "graphique", "ergonomie", "ux", "ui", "interface"], icons: ["palette", "pen-tool", "layout-dashboard"] },
	{ keys: ["droit", "juridique", "rgpd", "legal", "ethique", "responsable"], icons: ["scale", "gavel", "file-badge"] },
	{ keys: ["template", "modele", "gabarit"], icons: ["layout-template", "copy"] },
	{ keys: ["economie", "comptabilit", "finance", "marketing"], icons: ["trending-up", "chart-line", "coins"] },
];

/** Normalise (minuscule + retrait des diacritiques) pour un match robuste. */
function norm(s: string): string {
	return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function echapper(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Le mot-clé apparaît-il en début de mot (et en mot entier s'il est court) ? */
function trouve(hay: string, key: string): boolean {
	const k = norm(key);
	const fin = k.length <= 3 ? "(?![a-z0-9])" : "";
	return new RegExp(`(?<![a-z0-9])${echapper(k)}${fin}`).test(hay);
}

/**
 * Icônes suggérées pour un module d'après son nom et son UE (max `limit`).
 * Renvoie une liste dédupliquée, dans l'ordre des règles.
 */
export function suggestIcons(name: string, ue: string | null | undefined, limit = 6): string[] {
	const hay = norm(`${name} ${ue ?? ""}`);
	const out: string[] = [];
	for (const rule of RULES) {
		if (rule.keys.some(k => trouve(hay, k))) {
			for (const ic of rule.icons) if (!out.includes(ic)) out.push(ic);
		}
	}
	return out.slice(0, limit);
}

/** Toutes les icônes que les règles peuvent proposer (contrôle : chacune doit
    exister dans le catalogue Lucide de l'hôte). */
export function iconesDesRegles(): string[] {
	return [...new Set(RULES.flatMap(r => r.icons))];
}
