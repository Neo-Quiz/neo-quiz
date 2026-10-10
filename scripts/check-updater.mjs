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
	/* METERED CONNECTION (2026-10-07): the version waits for a click. */
	r.check("update-available sur connexion limitée : disponible, drapeau limitee, aucun octet",
		transition({ phase: "verification" }, { type: "update-available", version: "2.5.3", limitee: true }),
		{ phase: "disponible", version: "2.5.3", limitee: true });
	r.check("download-started : le clic sur Télécharger passe en téléchargement à 0 %",
		transition({ phase: "disponible", version: "2.5.3", limitee: true }, { type: "download-started" }),
		{ phase: "telechargement", version: "2.5.3", pourcent: 0, octetsRecus: null, octetsTotal: null });
	r.check("download-started hors « disponible » : sans effet",
		[transition({ phase: "prete", version: "1" }, { type: "download-started" }), transition({ phase: "inactif" }, { type: "download-started" })],
		[{ phase: "prete", version: "1" }, { phase: "inactif" }]);
	r.check("download-progress depuis « disponible » : devient téléchargement, sans drapeau limitee",
		transition({ phase: "disponible", version: "2.5.3", limitee: true }, { type: "download-progress", percent: 3, transferred: 3, total: 100 }),
		{ phase: "telechargement", version: "2.5.3", pourcent: 3, octetsRecus: 3, octetsTotal: 100 });
	r.check("une version déjà prête retrouvée par une nouvelle vérification reste prête (limitée ou non)",
		[
			transition({ phase: "prete", version: "2.5.3" }, { type: "update-available", version: "2.5.3", limitee: true }),
			transition({ phase: "prete", version: "2.5.3" }, { type: "update-available", version: "2.5.3" }),
		],
		[{ phase: "prete", version: "2.5.3" }, { phase: "prete", version: "2.5.3" }]);
	r.check("une version plus récente que la prête repart (limitée : disponible)",
		transition({ phase: "prete", version: "2.5.3" }, { type: "update-available", version: "2.5.4", limitee: true }),
		{ phase: "disponible", version: "2.5.4", limitee: true });
	r.check("un téléchargement en cours de la même version garde sa progression",
		transition({ phase: "telechargement", version: "2.5.3", pourcent: 40, octetsRecus: 4, octetsTotal: 10 }, { type: "update-available", version: "2.5.3" }),
		{ phase: "telechargement", version: "2.5.3", pourcent: 40, octetsRecus: 4, octetsTotal: 10 });
	r.check("error depuis « disponible » : erreur, drapeau oublié",
		transition({ phase: "disponible", version: "2.5.3", limitee: true }, { type: "error", message: "x" }),
		{ phase: "erreur", message: "x" });

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

	/* THE SAFETY NET in the state machine (2026-10-10): "the update did not
	   finish" stays on screen through the checks of the start (a check that
	   finds nothing, or fails, must not erase it), and gives way only when a
	   version starts downloading again: that download IS the retry. */
	const inachevee = { phase: "erreur", message: "unfinished" };
	r.check("unfinished: an error state the menu can name",
		transition(ETAT_INITIAL, { type: "unfinished" }), inachevee);
	r.check("unfinished survives the check of the start",
		[transition(inachevee, { type: "checking-for-update" }), transition(inachevee, { type: "update-not-available" }), transition(inachevee, { type: "error", message: "x" })],
		[inachevee, inachevee, inachevee]);
	r.check("unfinished gives way to a new download (the retry)",
		transition(inachevee, { type: "update-available", version: "2.5.3" }),
		{ phase: "telechargement", version: "2.5.3", pourcent: 0, octetsRecus: null, octetsTotal: null });

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

/* THE SAFETY NET (2026-10-10): an update that restarts the app on an older
   version than the one it installed is named, never silent. */
await withSrcModule("apps/windows/electron/expected-update.ts", ({ expectedUpdateOutcome, compareVersions }) => {
	const r = makeReporter("Update safety net");
	r.check("nothing expected", expectedUpdateOutcome(undefined, "1.21.0"), "none");
	r.check("garbage expected is none", [expectedUpdateOutcome(42, "1.21.0"), expectedUpdateOutcome("x.y", "1.21.0")], ["none", "none"]);
	r.check("running older than expected: unfinished", expectedUpdateOutcome("1.21.1", "1.21.0"), "unfinished");
	r.check("running the expected version: landed", expectedUpdateOutcome("1.21.1", "1.21.1"), "landed");
	r.check("running newer: landed", expectedUpdateOutcome("1.21.1", "1.22.0"), "landed");
	r.check("numeric, not lexical", compareVersions("1.20.10", "1.20.9"), 1);
	r.done();
});
