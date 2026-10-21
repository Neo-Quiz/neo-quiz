/** Keep disclosure contents mounted so reversing a toggle reverses the CSS transition. */
export function prepareDisclosure(body: HTMLElement, open: boolean): HTMLElement {
	body.classList.add("nq-disclosure");
	const inner = document.createElement("div");
	inner.className = "nq-disclosure-inner";
	inner.append(...Array.from(body.childNodes));
	body.append(inner);
	setDisclosureOpen(body, open);
	return inner;
}

export function setDisclosureOpen(body: HTMLElement, open: boolean): void {
	body.classList.toggle("is-disclosure-closed", !open);
	body.inert = !open;
	body.setAttribute("aria-hidden", String(!open));
}

/** Detach only after the mobile exit; each closing node owns its own fallback. */
export function dismissOverlay(element: HTMLElement): void {
	if (element.dataset.motionClosing) return;
	if (!document.body.classList.contains("is-mobile") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		element.remove();
		return;
	}
	element.dataset.motionClosing = "true";
	element.inert = true;
	element.classList.add("nq-overlay-closing");
	let timer = 0;
	const remove = (): void => {
		window.clearTimeout(timer);
		element.removeEventListener("animationend", onEnd);
		element.remove();
	};
	const onEnd = (event: AnimationEvent): void => {
		if (event.target === element && event.animationName === "nq-overlay-out") remove();
	};
	element.addEventListener("animationend", onEnd);
	timer = window.setTimeout(remove, 240);
}

const swaps = new WeakMap<HTMLElement, Animation>();

/** Animate replacement previews from their currently painted height, including a reversal. */
export function animateContentSwap(container: HTMLElement, update: () => void): void {
	const mobile = document.body.classList.contains("is-mobile");
	if (!mobile || window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof container.animate !== "function") {
		swaps.get(container)?.cancel();
		update();
		return;
	}
	const from = container.getBoundingClientRect().height;
	swaps.get(container)?.cancel();
	update();
	const to = container.getBoundingClientRect().height;
	const animation = container.animate([
		{ height: `${from}px`, overflow: "clip" },
		{ height: `${to}px`, overflow: "clip" },
	], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" });
	swaps.set(container, animation);
	const clear = (): void => { if (swaps.get(container) === animation) swaps.delete(container); };
	animation.onfinish = clear;
	animation.oncancel = clear;
}
