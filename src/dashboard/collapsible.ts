import { currentHost } from "../host/current";
import { ajouter } from "../dom";

/* ══════════════════════════════════════════════════════════
   COLLAPSIBLE — section repliable partagée (« Mes quiz » ET accueil).
   Extraite de quizzes-render.ts le 2026-07-28 : l'accueil doit parler
   la MÊME langue que « Mes quiz » (rangée 52px, chevron animé, libellé,
   badge compteur), et une copie du mécanisme aurait dupliqué avec lui
   les deux correctifs durement acquis (filet d'animation unique, pixels
   fantômes du compositeur — cf. dashboard-quizzes.css).
══════════════════════════════════════════════════════════ */

/** État de repli fourni par l'hôte (réglages persistés côté plugin). */
export interface CollapseDeps {
	isExpanded: (key: string) => boolean;
	toggleExpanded: (key: string) => void;
}

/* Bascule de repli partagée par un groupe (activité, UE, archivés, sections
   de l'accueil). `defaultOpen` (les sections sont OUVERTES par défaut —
   capture StudySmarter 2026-07-18) inverse la lecture du réglage : la clé
   présente dans quizzesExpandedFolders signifie alors « repliée par
   l'utilisateur ». */
export function wireCollapseToggle(
	deps: CollapseDeps,
	nodeEl: HTMLElement,
	head: HTMLButtonElement,
	chev: HTMLElement,
	key: string,
	defaultOpen = true
): void {
	const collapsed = defaultOpen ? deps.isExpanded(key) : !deps.isExpanded(key);
	// UN SEUL icône (chevron-right) : l'orientation « ouvert » est une ROTATION
	// CSS animée, pas un second icône — c'est ce qui rend la flèche fluide.
	currentHost().ui.setIcon(chev, "chevron-right");
	nodeEl.classList.toggle("is-collapsed", collapsed);
	head.setAttribute("aria-expanded", String(!collapsed));
	// Un SEUL filet et un SEUL listener transitionend vivants par nœud : des
	// clics enchaînés accumulaient les stopAnim des clics précédents, et un
	// filet orphelin retirait is-animating EN PLEINE animation suivante —
	// l'overflow (et désormais la visibility du repli stable) basculait en
	// plein mouvement.
	let animTimer = 0;
	let offEnd: (() => void) | null = null;
	head.addEventListener("click", () => {
		// Bascule PUREMENT CSS : le corps reste monté, sa hauteur s'anime
		// (grid-template-rows). On persiste l'état (toggleExpanded) mais SANS
		// rerender — un rerender détruirait le DOM et tuerait la transition.
		deps.toggleExpanded(key);
		// Purge du cycle d'animation précédent avant d'en ouvrir un nouveau.
		window.clearTimeout(animTimer);
		offEnd?.();
		// Clip pendant TOUTE la transition (is-animating), retiré à la fin : à
		// l'état ouvert stable le corps repasse en overflow visible, sinon il
		// rogne la carte quand elle se surélève au survol.
		nodeEl.classList.add("is-animating");
		const nowCollapsed = nodeEl.classList.toggle("is-collapsed");
		head.setAttribute("aria-expanded", String(!nowCollapsed));
		const body = nodeEl.querySelector<HTMLElement>(".qbd-quizzes-node-body");
		if (body) body.inert = nowCollapsed;
		const stopAnim = () => {
			window.clearTimeout(animTimer);
			offEnd?.();
			nodeEl.classList.remove("is-animating");
		};
		if (body) {
			const onEnd = (e: Event) => {
				const te = e as TransitionEvent;
				// Cibler le corps LUI-MÊME : un transitionend d'un descendant
				// bouillonne jusqu'ici et arrêterait l'animation trop tôt.
				if (te.target !== body || te.propertyName !== "grid-template-rows") return;
				stopAnim();
			};
			offEnd = () => {
				body.removeEventListener("transitionend", onEnd);
				offEnd = null;
			};
			body.addEventListener("transitionend", onEnd);
		}
		// Filet : reduced-motion (pas de transitionend) ou transition coupée.
		animTimer = window.setTimeout(stopAnim, 320);
	});
}

/* Section repliable générique : en-tête (chevron + libellé + badge) + corps.
   Le corps reste TOUJOURS monté pour animer la hauteur. Son enfant dédié
   sépare le clipping de la grille qui peint les bordures des cartes.
   `opts.headRow` reçoit la rangée de l'en-tête : l'appelant peut y greffer une
   action alignée à droite (« See all » de l'accueil) — un bouton ne peut pas
   vivre DANS le bouton d'en-tête. Retourne le conteneur du corps. */
export function renderCollapsibleSection(
	deps: CollapseDeps,
	parent: HTMLElement,
	key: string,
	label: string,
	total: number,
	opts?: {
		entryDelay?: () => string;
		defaultOpen?: boolean;
		rowClass?: string;
		headRow?: (row: HTMLElement) => void;
		/** Muted text right after the count ("· ≈ 1 h 10"): no box. */
		note?: string;
	}
): HTMLElement {
	const nodeEl = ajouter(parent, "div", "qbd-quizzes-node");
	// Cran de cascade d'entrée : la variable vit sur le nœud (héritée par le
	// head qui porte l'animation, cf. dashboard-quizzes.css).
	if (opts?.entryDelay) nodeEl.style.setProperty("--qbd-card-delay", opts.entryDelay());
	const row = opts?.rowClass ? ajouter(nodeEl, "div", opts.rowClass) : nodeEl;
	const head = ajouter(row, "button", "qbd-quizzes-node-head");
	head.type = "button";
	const chev = ajouter(head, "span", "qbd-quizzes-node-chevron");
	ajouter(head, "span", "qbd-quizzes-node-label", label);
	// En-tête de section — copie LITTÉRALE de StudySmarter (capture Ahmed
	// 2026-07-18) : chevron + libellé + BADGE compteur, rien d'autre.
	ajouter(head, "span", "qbd-quizzes-node-badge", String(total));
	if (opts?.note) {
		ajouter(head, "span", "qbd-count-sep qbd-quizzes-node-note");
		ajouter(head, "span", "qbd-quizzes-node-note", opts.note);
	}
	if (opts?.headRow && row !== nodeEl) opts.headRow(row);
	wireCollapseToggle(deps, nodeEl, head, chev, key, opts?.defaultOpen ?? true);
	const body = ajouter(nodeEl, "div", "qbd-quizzes-node-body");
	body.inert = nodeEl.classList.contains("is-collapsed");
	return ajouter(body, "div", "qbd-quizzes-node-clip");
}
