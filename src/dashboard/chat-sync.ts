import { LOG_PREFIX } from "../branding";
import { notifyChatsChanged } from "./chat-session";
import { attachChatBackend, flushChats, reloadFromBackend } from "./chat-store";
import type { ChatBackend } from "./chat-store";
import { refreshRemoteGenerations, setRemoteReader } from "./remote-generations";
import type { RemoteGenerations } from "./remote-generations";
import { OWN_REQUESTS_EVERY_MS, refreshOwnRequests, setRequestFiles } from "./ai-remote";
import type { RequestFiles } from "./ai-remote";

export interface ChatSyncDeps {
	files: ChatBackend & RequestFiles & {
		load(): Promise<void>;
		refresh(): Promise<void>;
		/** Every other device's generations file (`generations/<device>.json`), read fresh. */
		readGenerations(): Promise<RemoteGenerations[]>;
	};
}

/** Loads the synced chat files, moves the store onto them, and returns the two hooks the shell needs. */
export async function startChatSync(deps: ChatSyncDeps): Promise<{ afterSync(): Promise<boolean>; flush(): Promise<void> }> {
	await deps.files.load();
	try {
		await attachChatBackend(deps.files);
	} catch (e) {
		console.warn(LOG_PREFIX, "chats not moved to the synced folder yet (will retry at next start):", e);
	}
	setRemoteReader(() => deps.files.readGenerations());
	// The phone's own requests: read now, after each delivery, and every few seconds while it is open.
	setRequestFiles(deps.files);
	void refreshOwnRequests();
	setInterval(() => void refreshOwnRequests(), OWN_REQUESTS_EVERY_MS);
	return {
		/** Called after Syncthing delivered something: re-reads the other devices' files and generations; true when the view changed. */
		async afterSync() {
			await deps.files.refresh();
			const changed = reloadFromBackend();
			if (changed) notifyChatsChanged();
			// The generations repaint their listeners themselves; only the chats are reported here.
			await refreshRemoteGenerations();
			await refreshOwnRequests();
			return changed;
		},
		flush: flushChats,
	};
}
