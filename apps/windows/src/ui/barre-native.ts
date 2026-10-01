/* ══════════════════════════════════════════════════════════
   THE NATIVE BOTTOM BAR (Android phone, T13e)

   The Android 12 stretch overscroll is drawn over the WHOLE WebView, so a bar
   fixed inside the page stretched along with the content. Neo Calendar's bar
   does not move: it is outside the scrolling view. Here the page keeps being
   the source of truth for the bar (the four buttons of the rail, their labels,
   which one is active, whether the bar shows at all) and publishes it to
   Kotlin (`neoPlatform.barre`, drawn by `NavBarView.kt`), which draws it under
   the WebView; a tap comes back as the index of the button, and this module
   clicks it. The page's own bar is hidden (`mobile.css`, `.nq-bar-native`).

   ICONS are rasterised here, from the rail's own SVGs, in both states
   (outline, and the filled shape of the active tab): the page's CSS decides
   what each state looks like, so the values are read from COMPUTED styles of
   an offscreen clone and written inline into the SVG before it is drawn.
══════════════════════════════════════════════════════════ */

interface PontBarre {
	barre(etat: unknown): void;
	surBarreClic(rappel: (index: number) => void): void;
}

const TAILLE_PX = 100;
const ACTIVE = "qbd-nav-item--active";

function boutons(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>(".qbd-sidebar .qbd-nav-item"));
}

/** The rail icon of `btn` as a PNG data URL, drawn as it looks when the tab is `active`. */
async function icone(btn: HTMLElement, active: boolean): Promise<{ png: string; couleur: string }> {
	const clone = btn.cloneNode(true) as HTMLElement;
	clone.style.setProperty("position", "absolute", "important");
	clone.style.setProperty("visibility", "hidden", "important");
	for (const el of [clone, ...Array.from(clone.querySelectorAll<HTMLElement | SVGElement>("*"))]) el.style.setProperty("transition", "none", "important");
	btn.parentElement?.append(clone);
	try {
		clone.classList.toggle(ACTIVE, active);
		const couleur = getComputedStyle(clone).color;
		const svg = clone.querySelector("svg");
		if (!svg) return { png: "", couleur };
		for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
			const cs = getComputedStyle(el);
			const st = (el as SVGElement).style;
			for (const p of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity"]) st.setProperty(p, cs.getPropertyValue(p));
		}
		svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		svg.setAttribute("width", String(TAILLE_PX));
		svg.setAttribute("height", String(TAILLE_PX));
		const image = new Image();
		image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = TAILLE_PX;
		canvas.getContext("2d")?.drawImage(image, 0, 0, TAILLE_PX, TAILLE_PX);
		return { png: canvas.toDataURL("image/png"), couleur };
	} finally {
		clone.remove();
	}
}

export function installBarreNative(pont: PontBarre): void {
	let envoye = "";
	let dernier = "";
	let encours = false;
	let replanifie = false;

	const publier = async (): Promise<void> => {
		if (encours) { replanifie = true; return; }
		encours = true;
		try {
			const barre = document.querySelector<HTMLElement>(".qbd-sidebar");
			const visible = document.body.classList.contains("is-mobile") && !!barre && !document.querySelector("#neo-quiz-root > .qbd-qz");
			if (!visible || !barre) {
				dernier = "";
				if (envoye !== "cache") { envoye = "cache"; pont.barre({ visible: false }); }
				return;
			}
			const cs = getComputedStyle(barre);
			// Cheap check first: the icons are only redrawn when the bar itself changed.
			const rapide = JSON.stringify(boutons().map(b => [b.querySelector(".qbd-nav-label")?.textContent, b.classList.contains(ACTIVE), b.classList.contains("qbd-nav-item--placeholder")]));
			if (rapide === dernier) return;
			const items = [];
			let muted = "";
			let active = "";
			for (const btn of boutons()) {
				const on = btn.classList.contains(ACTIVE);
				const label = btn.querySelector(".qbd-nav-label")?.textContent ?? "";
				const off = await icone(btn, false);
				const onIcone = await icone(btn, true);
				muted = off.couleur;
				active = onIcone.couleur;
				items.push({ label, active: on, placeholder: btn.classList.contains("qbd-nav-item--placeholder"), off: off.png, on: onIcone.png });
			}
			const etat = { visible: true, bg: cs.backgroundColor, line: cs.borderTopColor, muted, active, items };
			dernier = rapide;
			envoye = "visible";
			pont.barre(etat);
		} catch (e) {
			console.warn("[neo-quiz] native bar not published", e);
		} finally {
			encours = false;
			if (replanifie) { replanifie = false; planifier(); }
		}
	};

	let rafId = 0;
	const planifier = (): void => {
		if (rafId) return;
		rafId = requestAnimationFrame(() => { rafId = 0; void publier(); });
	};

	pont.surBarreClic((index) => {
		const btn = boutons()[index];
		if (btn && !btn.classList.contains("qbd-nav-item--placeholder")) btn.click();
	});

	// From here the page's own bar stays hidden (mobile.css).
	document.documentElement.classList.add("nq-bar-native");
	const racine = document.getElementById("neo-quiz-root") ?? document.body;
	new MutationObserver(planifier).observe(racine, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
	new MutationObserver(planifier).observe(document.body, { attributes: true, attributeFilter: ["class"] });
	window.matchMedia("(max-width: 600px)").addEventListener("change", planifier);
	planifier();
}
