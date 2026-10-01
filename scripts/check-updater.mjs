/**
 * LA MISE À JOUR AUTOMATIQUE — le noyau pur qui traduit les événements
 * d'electron-updater en un état affichable (`apps/windows/electron/
 * mise-a-jour-etat.ts`). Éprouvé sans Electron ni réseau.
 *
 * Ce que ce script empêche : un état « prête » qui ne retomberait jamais
 * (le bouton du rail resterait après une erreur), un pourcentage qui
 * survivrait au téléchargement fini, et une version oubliée en route.
 *
 * LES CAS DU RÉGLAGE ONT DISPARU (2026-09-17) avec le drapeau `auto` : la
 * mise à jour automatique ne se coupe plus. Le dernier cas ci-dessous est ce
 * qui reste de cette règle, et il vaut CLIQUET : aucun état produit par le
 * noyau ne porte de drapeau `auto`. Le remettre, c'est réintroduire un mode
 * « mises à jour éteintes » qu'aucune interface ne rallumerait.
 *
 *     npm run check:updater
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/electron/mise-a-jour-etat.ts", ({ ETAT_INITIAL, transition }) => {
	const r = makeReporter("Mise à jour — transitions d'état");

	r.check("initial : inactif", ETAT_INITIAL, { phase: "inactif" });
	r.check("checking-for-update : vérification",
		transition(ETAT_INITIAL, { type: "checking-for-update" }), { phase: "verification" });
	r.check("update-available : téléchargement à 0 %, version connue",
		transition({ phase: "verification" }, { type: "update-available", version: "2.5.2" }),
		{ phase: "telechargement", version: "2.5.2", pourcent: 0, octetsRecus: null, octetsTotal: null });
	r.check("download-progress : le pourcentage est arrondi et borné",
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 0 }, { type: "download-progress", percent: 43.7 }),
		{ phase: "telechargement", version: "2.5.2", pourcent: 44, octetsRecus: null, octetsTotal: null });
	const dl = { phase: "telechargement", version: "2.5.2", pourcent: 0, octetsRecus: null, octetsTotal: null };
	r.check("download-progress : octets reçus et total portés par l'état",
		transition(dl, { type: "download-progress", percent: 41, transferred: 41_000_000, total: 100_000_000 }),
		{ phase: "telechargement", version: "2.5.2", pourcent: 41, octetsRecus: 41_000_000, octetsTotal: 100_000_000 });
	r.check("download-progress : octets reçus jamais négatifs ni au-delà du total",
		[
			transition(dl, { type: "download-progress", percent: 1, transferred: -5, total: 100 }),
			transition(dl, { type: "download-progress", percent: 100, transferred: 250, total: 100 }),
		].map(e => [e.octetsRecus, e.octetsTotal]),
		[[0, 100], [100, 100]]);
	r.check("download-progress : total nul, négatif, absent ou NaN → aucun octet (pas de « 0 Mo / 0 Mo »)",
		[
			transition(dl, { type: "download-progress", percent: 5, transferred: 0, total: 0 }),
			transition(dl, { type: "download-progress", percent: 5, transferred: 10, total: -1 }),
			transition(dl, { type: "download-progress", percent: 5, transferred: 10 }),
			transition(dl, { type: "download-progress", percent: 5, transferred: 10, total: NaN }),
		].map(e => [e.octetsRecus, e.octetsTotal]),
		[[null, null], [null, null], [null, null], [null, null]]);
	r.check("download-progress : un total connu mais des octets reçus absents → 0 reçu",
		(e => [e.octetsRecus, e.octetsTotal])(transition(dl, { type: "download-progress", percent: 0, total: 80 })),
		[0, 80]);
	r.check("update-downloaded : prête, sans pourcentage",
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 99 }, { type: "update-downloaded", version: "2.5.2" }),
		{ phase: "prete", version: "2.5.2" });
	r.check("update-downloaded : les octets sont oubliés",
		"octetsRecus" in transition({ ...dl, octetsRecus: 5, octetsTotal: 9 }, { type: "update-downloaded", version: "2.5.2" }), false);
	r.check("error : les octets sont oubliés",
		"octetsRecus" in transition({ ...dl, octetsRecus: 5, octetsTotal: 9 }, { type: "error", message: "x" }), false);
	r.check("update-not-available : à jour, sans version",
		transition({ phase: "verification" }, { type: "update-not-available" }),
		{ phase: "a-jour" });
	r.check("error : erreur avec message, version et pourcentage oubliés",
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 10 }, { type: "error", message: "net::ERR_INTERNET_DISCONNECTED" }),
		{ phase: "erreur", message: "net::ERR_INTERNET_DISCONNECTED" });
	r.check("une erreur APRÈS prête ne retire pas la mise à jour téléchargée",
		transition({ phase: "prete", version: "2.5.2" }, { type: "error", message: "x" }),
		{ phase: "prete", version: "2.5.2" });

	/* Le cliquet : aucune transition ne rend un état porteur d'un drapeau
	   `auto`, sur aucun chemin. */
	const tous = [
		ETAT_INITIAL,
		transition(ETAT_INITIAL, { type: "checking-for-update" }),
		transition({ phase: "verification" }, { type: "update-available", version: "2.5.2" }),
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 0 }, { type: "download-progress", percent: 50 }),
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 99 }, { type: "update-downloaded", version: "2.5.2" }),
		transition({ phase: "verification" }, { type: "update-not-available" }),
		transition({ phase: "verification" }, { type: "error", message: "x" }),
	];
	r.check("aucun état ne porte de drapeau « auto »", tous.some(e => "auto" in e), false);

	r.done();
});
