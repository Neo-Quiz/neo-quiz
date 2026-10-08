import type { ChatRecord } from "./chat-record";

/* ══════════════════════════════════════════════════════════
   WHICH SETTINGS TO APPLY WHEN A CHAT IS OPENED (pure)

   Switching to another conversation puts the composer back on the provider,
   model and effort of the LAST request sent in it. The stored values are
   plain labels: they are only compared against what this device offers right
   now, never used as anything else, and anything that does not match leaves
   the current choice alone.
══════════════════════════════════════════════════════════ */

export interface SwitchEnv {
	/** The provider is known, visible and usable on this device (not desktop-only on a phone...). */
	providerOffered(id: string): boolean;
	/** The model values the provider offers right now; empty for a provider with no model to pick. */
	models(provider: string): string[];
	/** The provider's own default model. */
	defaultModel(provider: string): string;
	/** The effort values valid for this provider and model. */
	efforts(provider: string, model: string): string[];
	current: { provider: string; model: string; effort: string };
}

export interface SwitchPatch { aiProvider?: string; aiModel?: string; aiEffort?: string }

/** The settings to save on opening `chat`, or `null` when nothing changes. */
export function settingsOnSwitch(chat: Pick<ChatRecord, "requests"> | null | undefined, env: SwitchEnv): SwitchPatch | null {
	const last = [...(chat?.requests ?? [])].reverse().find(q => q.provider);
	if (!last?.provider || !env.providerOffered(last.provider)) return null;
	const provider = last.provider;
	const known = env.models(provider);
	const sameProvider = provider === env.current.provider;
	let model = sameProvider ? env.current.model : env.defaultModel(provider);
	if (last.model && known.includes(last.model)) model = last.model;
	const patch: SwitchPatch = {};
	if (!sameProvider) patch.aiProvider = provider;
	if (model !== env.current.model || !sameProvider) patch.aiModel = model;
	// The effort only follows when the recorded model itself was applied.
	if (last.effort && model === last.model && env.efforts(provider, model).includes(last.effort) && last.effort !== env.current.effort) patch.aiEffort = last.effort;
	return Object.keys(patch).length ? patch : null;
}
