import { Menu, Tray } from "electron";
import { LOG_PREFIX } from "../../../src/branding";

export interface TrayLabels {
	open: string;
	quit: string;
	tooltip: string;
}

export function createTray(opts: {
	iconPath: string;
	labels: () => TrayLabels;
	onOpen(): void;
	onQuit(): void;
}): { destroy(): void; refreshLabels(): void } | null {
	let tray: Tray;
	try {
		tray = new Tray(opts.iconPath);
	} catch (error) {
		console.error(LOG_PREFIX, "tray unavailable:", error);
		return null;
	}

	const refreshLabels = (): void => {
		const labels = opts.labels();
		tray.setToolTip(labels.tooltip);
		tray.setContextMenu(Menu.buildFromTemplate([
			{ label: labels.open, click: opts.onOpen },
			{ label: labels.quit, click: opts.onQuit },
		]));
	};

	tray.on("click", opts.onOpen);
	refreshLabels();

	return {
		destroy: () => tray.destroy(),
		refreshLabels,
	};
}
