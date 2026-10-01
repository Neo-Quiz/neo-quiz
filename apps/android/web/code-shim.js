/* The code sandbox's only link with Kotlin (CodeSandbox.kt): injected at
   document start in the code origin ONLY, it gives the page the same
   `window.neoCode` as apps/windows/electron/code-preload.ts, over ONE
   WebMessagePort that Kotlin posts as the message "neo-code-port". There is
   no other channel: this WebView has no JavaScript interface and no message
   listener. The first port wins, a later one is ignored. */
(() => {
	"use strict";
	let port = null;
	let onJob = () => {};
	let onWarm = () => {};
	const outbox = [];
	const send = (m) => {
		const text = JSON.stringify(m);
		if (port) port.postMessage(text); else outbox.push(text);
	};
	window.addEventListener("message", (e) => {
		if (port || e.data !== "neo-code-port" || !e.ports || !e.ports[0]) return;
		port = e.ports[0];
		port.onmessage = (ev) => {
			let m;
			try { m = JSON.parse(ev.data); } catch { return; }
			if (m && m.type === "travail") onJob(m);
			else if (m && m.type === "chauffe") onWarm(m.language);
		};
		for (const text of outbox.splice(0)) port.postMessage(text);
	});
	Object.defineProperty(window, "neoCode", {
		value: Object.freeze({
			surTravail: (cb) => { onJob = cb; },
			surChauffe: (cb) => { onWarm = cb; },
			rendre: (id, res) => send({ type: "resultat", id, res }),
			pret: (id) => send({ type: "pret", id }),
		}),
	});
})();
