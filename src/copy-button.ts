import { ajouter } from "./dom";
import { currentHost } from "./host/current";

/** THE copy button of a block of code or text, one look everywhere (validated
    on the install window's command, 2026-10-19 rule: always this button, never
    a worded one). A square in the block's top right corner, the icon ALONE:
    the word doubled a pictogram everyone knows, in a corner where room is
    tight. The label lives off screen (a button without an accessible name is
    mute for a screen reader) and says "Copied" after the click. Revealed on
    hover of the block, on keyboard focus and while the confirmation lasts;
    always shown without a mouse (`dashboard-ai.css`, `.qbd-install-copy`).
    After a successful copy the icon AND the label change for 1.5 s: the icon
    alone changing while the word stayed read as an invitation to click again. */
export function addCopyButton(
	block: HTMLElement,
	copy: () => Promise<boolean>,
	labels: { copy: string; copied: string },
): HTMLButtonElement {
	const host = currentHost();
	block.classList.add("qbd-copy-host");
	const button = ajouter(block, "button", "qbd-btn qbd-install-copy");
	button.type = "button";
	const icon = ajouter(button, "span", "qbd-btn-icon qbd-btn-icon--sm");
	host.ui.setIcon(icon, "copy");
	const label = ajouter(button, "span", "qbd-sr-only", labels.copy);
	let timer: number | undefined;
	button.addEventListener("click", async () => {
		const ok = await copy().catch(() => false);
		if (!ok) return;
		icon.replaceChildren();
		host.ui.setIcon(icon, "check");
		label.textContent = labels.copied;
		button.dataset.copie = "1";
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			icon.replaceChildren();
			host.ui.setIcon(icon, "copy");
			label.textContent = labels.copy;
			delete button.dataset.copie;
		}, 1500);
	});
	return button;
}
