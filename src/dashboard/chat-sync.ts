import { LOG_PREFIX } from "../branding";
import { notifyChatsChanged } from "./chat-session";
import { attachChatBackend, flushChats, reloadFromBackend } from "./chat-store";
import type { ChatBackend } from "./chat-store";

export interface ChatSyncDeps { files: ChatBackend & { load(): Promise<void>; refresh(): Promise<void> } }

/** Loads the synced chat files, moves the store onto them, and returns the two hooks the shell needs. */
export async function startChatSync(deps: ChatSyncDeps): Promise<{ afterSync(): Promise<boolean>; flush(): Promise<void> }> {
	await deps.files.load();
	try {
		await attachChatBackend(deps.files);
	} catch (e) {
		console.warn(LOG_PREFIX, "chats not moved to the synced folder yet (will retry at next start):", e);
	}
	return {
		/** Called after Syncthing delivered something: re-reads the other devices' files; true when the view changed. */
		async afterSync() {
			await deps.files.refresh();
			const changed = reloadFromBackend();
			if (changed) notifyChatsChanged();
			return changed;
		},
		flush: flushChats,
	};
}
