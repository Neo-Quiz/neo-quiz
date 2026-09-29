/**
 * Vérification de l'ORDONNANCEUR (src/scheduler/).
 *
 * Ce script existe pour la même raison que check:md et check:export : c'est
 * de la logique qu'une relecture ne suffit pas à juger. Il charge le CODE
 * RÉEL via load-src.mjs — une réplique finirait par diverger de l'originale
 * et validerait le vide.
 *
 *     npm run check:scheduler
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const JOUR = 86400000;
const HEURE = 3600000;

/* ── PURETÉ ──
   Le noyau doit tourner hors d'Obsidian, sans écran et sans horloge. C'est
   la condition qui rend ce module réutilisable par les applications PC et
   Android ; sans contrôle mécanique, elle s'érode au premier appel
   « pratique » à Date.now(). */
{
	const r = makeReporter("Ordonnanceur — pureté du noyau");
	const INTERDITS = [
		[/from\s+["']obsidian["']/, "import obsidian"],
		[/\bdocument\./, "document"],
		[/\bwindow\./, "window"],
		[/\bDate\.now\s*\(/, "Date.now()"],
		[/\bnew\s+Date\s*\(/, "new Date()"],
		[/\bMath\.random\s*\(/, "Math.random()"],
	];
	const dir = "src/scheduler";
	for (const f of readdirSync(dir).filter(n => n.endsWith(".ts"))) {
		const src = readFileSync(join(dir, f), "utf8");
		for (const [re, nom] of INTERDITS) {
			r.check(`${f} sans ${nom}`, re.test(src), false);
		}
	}
	r.done();
}

await withSrcModule(["src/scheduler/horizon.ts", "src/scheduler/params.ts"], (h, p) => {
	const r = makeReporter("Ordonnanceur — horizon");
	const P = p.DEFAULT_PARAMS;
	const j = (n) => n * JOUR;
	const arrondi = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

	// Les deux ancrages de Cepeda sont respectés au ratio près.
	r.check("ratio à 7 j", arrondi(h.retentionRatio(j(7), P)), 0.3);
	r.check("ratio à 365 j", arrondi(h.retentionRatio(j(365), P)), 0.075);

	// Valeurs intermédiaires (spec §5.1), en jours de plafond.
	r.check("plafond à 30 j", arrondi(h.intervalCeiling(j(30), P) / JOUR, 1), 6.5);
	r.check("plafond à 90 j", arrondi(h.intervalCeiling(j(90), P) / JOUR, 1), 13.9);

	/* MONOTONIE : c'est ce que le bornage de H protège. Sans lui, le ratio
	   devient négatif vers 1364 jours et un horizon de 3 ans donnerait un
	   plafond plus court qu'un horizon d'un an. */
	let croissant = true;
	let precedent = -1;
	for (const jours of [1, 2, 5, 7, 14, 30, 90, 180, 365, 730, 1095, 3650]) {
		const v = h.intervalCeiling(j(jours), P);
		if (v <= precedent) croissant = false;
		precedent = v;
	}
	r.check("plafond strictement croissant, y compris au-delà de 365 j", croissant, true);

	// Hors du domaine mesuré, on n'extrapole pas : le ratio est borné.
	r.check("ratio à 1 j = ratio à 7 j (pas d'extrapolation)",
		arrondi(h.retentionRatio(j(1), P)), arrondi(h.retentionRatio(j(7), P)));

	// Un examen PASSÉ retombe sur l'horizon par défaut.
	const now = 1_000_000_000_000;
	r.check("examen passé → horizon par défaut", h.horizonFor(now - j(1), now, P), P.horizonDefaut);
	r.check("pas de date → horizon par défaut", h.horizonFor(null, now, P), P.horizonDefaut);
	r.check("examen dans 7 j → 7 j", h.horizonFor(now + j(7), now, P), j(7));

	r.done();
});

await withSrcModule("src/scheduler/log.ts", (log) => {
	const r = makeReporter("Ordonnanceur — journal");

	/* JOURNAL FUSIONNE (Syncthing) : une ligne `rename` peut se retrouver
	   APRES la reponse qu'elle devait suivre, parce qu'on absorbe un fichier
	   de conflit par concatenation. `applyRenames` doit donc trier par DATE et
	   non par position, sinon la cle de cette reponse reste orpheline pour
	   toujours dans un fichier que rien ne recompacte. */
	{
		const T = 1750000000000;
		const rep = { t: "answer", q: "vieux.md::q1", at: T, grade: "correct" };
		const ren = { t: "rename", from: "vieux.md", to: "neuf.md", at: T + 1 };
		// Ordre du FICHIER inverse de l'ordre du TEMPS : c'est exactement ce
		// que produit la concatenation de deux journaux d'appareils.
		const fusionne = log.applyRenames([ren, rep]);
		r.check("un rename posterieur en date rattrape la reponse, meme place avant elle dans le fichier",
			fusionne[0].q, "neuf.md::q1");
		// Et l'inverse doit rester vrai : un rename ANTERIEUR ne touche pas une
		// reponse qui porte deja la cle nouvelle.
		const apres = log.applyRenames([{ ...ren, at: T - 1 }, rep]);
		r.check("un rename anterieur en date ne retouche pas une reponse posterieure",
			apres[0].q, "vieux.md::q1");
	}


	// Aller-retour.
	const e = { t: "answer", q: "note.md::q1", at: 1700000000000, grade: "correct", role: "test" };
	const relu = log.parseLog(log.formatLine(e));
	r.check("aller-retour d'un événement", relu.lines, [e]);
	r.check("rien d'ignoré", relu.ignored, 0);

	/* TOLÉRANCE : un fichier tronqué par une fermeture brutale doit perdre
	   une révision, pas un semestre. C'est la raison de préférer le JSONL à
	   un objet JSON unique. */
	const abime = log.formatLine(e) + '{"t":"answer","q":"b","at":\n' + log.formatLine({ ...e, q: "c" });
	r.check("ligne corrompue ignorée, le reste survit", abime2ids(log, abime), ["note.md::q1", "c"]);
	r.check("la corruption est comptée", log.parseLog(abime).ignored, 1);

	// Une ligne sans les champs requis n'est pas un événement.
	r.check("ligne sans grade ignorée", log.parseLog('{"t":"answer","q":"a","at":1}\n').lines.length, 0);
	r.check("ligne d'un type inconnu ignorée", log.parseLog('{"t":"autre"}\n').lines.length, 0);
	r.check("ligne vide ignorée sans compter", log.parseLog("\n\n").ignored, 0);

	// RENOMMAGE : la clé suit la note, y compris par préfixe de dossier.
	const journal = [
		log.formatLine({ t: "answer", q: "Cours/Reseaux/ch1.md::q1", at: 1, grade: "correct" }),
		log.formatLine({ t: "rename", from: "Cours/Reseaux", to: "Cours/Réseaux", at: 2 }),
		log.formatLine({ t: "answer", q: "Cours/Réseaux/ch1.md::q1", at: 3, grade: "wrong" }),
	].join("");
	const applique = log.applyRenames(log.parseLog(journal).lines);
	r.check("renommage de dossier appliqué par préfixe",
		applique.map(x => x.q), ["Cours/Réseaux/ch1.md::q1", "Cours/Réseaux/ch1.md::q1"]);
	r.check("les lignes de renommage ne restent pas des réponses",
		applique.every(x => x.t === "answer"), true);

	// Un renommage n'affecte QUE les événements qui le précèdent.
	const apres = log.applyRenames(log.parseLog([
		log.formatLine({ t: "rename", from: "a.md", to: "b.md", at: 1 }),
		log.formatLine({ t: "answer", q: "a.md::q1", at: 2, grade: "correct" }),
	].join("")).lines);
	r.check("un événement postérieur au renommage n'est pas re-déplacé",
		apres.map(x => x.q), ["a.md::q1"]);

	// VALIDATION DU ROLE : asymétrie volontaire.
	const avecRole = { t: "answer", q: "x", at: 1, grade: "correct", role: "pre" };
	const relectRole = log.parseLog(log.formatLine(avecRole));
	r.check("role valide conservé après aller-retour", relectRole.lines[0].role, "pre");

	const avecRoleInconnu = log.parseLog(log.formatLine({ t: "answer", q: "y", at: 2, grade: "correct", role: "inconnu" }));
	r.check("role inconnu : ligne présente sans role, ignored=0",
		{ present: avecRoleInconnu.lines.length > 0, hasRole: !!avecRoleInconnu.lines[0]?.role, ignored: avecRoleInconnu.ignored },
		{ present: true, hasRole: false, ignored: 0 });

	r.done();
});

/** Ids des événements survivants d'un journal abîmé. */
function abime2ids(log, texte) {
	return log.parseLog(texte).lines.filter(l => l.t === "answer").map(l => l.q);
}

await withSrcModule(["src/scheduler/state.ts", "src/scheduler/params.ts"], (st, p) => {
	const r = makeReporter("Ordonnanceur — état dérivé");
	const P = p.DEFAULT_PARAMS;
	const T0 = 1_700_000_000_000;
	const j = (n) => n * JOUR;
	const item = (q, mod = "M") => ({ q, module: mod, source: "s" });
	const rep = (q, at, grade, role) => ({ t: "answer", q, at, grade, ...(role ? { role } : {}) });
	const etat = (events, horizons = {}, now = T0 + j(100)) =>
		st.deriveStates({ now, items: [item("a")], events, horizons, params: P }).get("a");

	// Une question jamais répondue est NEUVE et due immédiatement.
	const neuf = etat([]);
	r.check("jamais répondue → isNew", neuf.isNew, true);
	r.check("jamais répondue → pas d'échéance", neuf.dueAt, null);

	// Premier succès → intervalle initial.
	r.check("premier succès → intervalleInitial",
		etat([rep("a", T0, "correct")]).interval, P.intervalleInitial);

	/* Croissance : le second succès doit avoir lieu APRÈS l'échéance, sinon
	   le garde-fou de double révision s'applique (cas suivant). */
	r.check("second succès dû → ×facteurSucces",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "correct")]).interval,
		P.intervalleInitial * P.facteurSucces);

	/* GARDE-FOU : rejouer le même quiz dans l'heure ne doit PAS doubler
	   l'intervalle. Sans lui, le compteur de répétitions remplacerait
	   l'espacement, seul mécanisme que la littérature valide. */
	r.check("succès trop tôt → intervalle inchangé",
		etat([rep("a", T0, "correct"), rep("a", T0 + HEURE, "correct")]).interval,
		P.intervalleInitial);

	// Échec → intervalle court, et le compteur d'échecs monte.
	const rate = etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "correct"), rep("a", T0 + j(5), "wrong")]);
	r.check("échec → intervalleEchec", rate.interval, P.intervalleEchec);
	r.check("échec → streak remis à zéro", rate.streak, 0);
	r.check("échec compté", rate.lapses, 1);

	// L'auto-évaluation compte, et « partiel » amortit.
	r.check("understood = succès plein",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "understood")]).interval,
		P.intervalleInitial * P.facteurSucces);
	r.check("partial amortit",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "partial")]).interval,
		P.intervalleInitial * P.facteurPartiel);
	r.check("review = échec",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "review")]).interval,
		P.intervalleEchec);

	/* Un `pre` raté ne raccourcit RIEN : chez Richland, Kornell & Kao,
	   c'est le groupe qui a essayé ET échoué qui a le mieux appris. */
	r.check("pre raté → aucun signal", etat([rep("a", T0, "wrong", "pre")]).isNew, true);
	r.check("pre réussi → aucun signal", etat([rep("a", T0, "correct", "pre")]).isNew, true);
	r.check("carte read → aucun signal", etat([rep("a", T0, "seen", "read")]).isNew, true);
	r.check("abandon explicite → aucun signal", etat([rep("a", T0, "skipped")]).isNew, true);

	/* PLAFOND : avec un partiel dans 7 jours, l'intervalle ne dépasse
	   jamais 2,1 jours, quel que soit le nombre de succès. */
	const serie = [];
	for (let k = 0; k < 10; k++) serie.push(rep("a", T0 + j(k * 3), "correct"));
	const now = T0 + j(27) + j(1);
	const plafonne = st.deriveStates({
		now, items: [item("a")], events: serie,
		horizons: { M: now + j(7) }, params: P,
	}).get("a");
	r.check("intervalle plafonné par l'horizon", plafonne.interval <= 2.11 * JOUR, true);

	/* PLAFOND HISTORIQUE (finding 1, revue task-3) : rejouer les 21 cas
	   ci-dessus en supprimant le plafond calculé À LA DATE DE CHAQUE
	   ÉVÉNEMENT (`plafond` dans la boucle de state.ts) les laisse tous
	   passer — aucun n'a un examen assez proche AU MOMENT d'un succès
	   pour que ce plafond-là morde. Ici l'examen est déjà PASSÉ au moment
	   de `now` (plafondNow retombe sur l'horizon par défaut, 27,4 j, qui
	   ne borne donc plus rien) : seul le plafond historique peut encore
	   agir, et c'est le seul cas qui l'éprouve.
	   Calcul à la main (P = DEFAULT_PARAMS, ratio(H) = a − b·ln(jours)
	   avec jours borné à [7, 365], donc ratio(jours ≤ 7) = 0,30 exact) :
	     succès à T0    (H = 10 j, ratio ≈ 0,2797, plafond ≈ 2,80 j)
	       → interval = intervalleInitial = 1 j (sous le plafond)
	     succès à T0+2j (H = 8 j,  ratio ≈ 0,2924, plafond ≈ 2,34 j)
	       → 1 j × facteurSucces = 2 j (sous le plafond)
	     succès à T0+5j (H = 5 j, bornée à l'ancrage 7 j → ratio = 0,30,
	                     plafond = 0,30 × 5 j = 1,5 j)
	       → 2 j × facteurSucces = 4 j, CLAMPÉ à 1,5 j.
	   Sans le plafond historique, le 3ᵉ succès resterait à 4 j : l'écart
	   avec 1,5 j est net, `interval < 2 * JOUR` les sépare sans ambiguïté. */
	const historique = [rep("a", T0, "correct"), rep("a", T0 + j(2), "correct"), rep("a", T0 + j(5), "correct")];
	const plafondHistorique = st.deriveStates({
		now: T0 + j(20), items: [item("a")], events: historique,
		horizons: { M: T0 + j(10) }, params: P,
	}).get("a");
	r.check("plafond historique (à la date de l'événement) resserre la trajectoire",
		plafondHistorique.interval < 2 * JOUR, true);

	/* PLANCHER QUI GAGNE SUR LE PLAFOND (finding 2, revue task-3) : aucun
	   cas ci-dessus n'a un examen assez proche pour que le plafond tombe
	   SOUS intervalleMin ; supprimer `Math.max(plafond, params.intervalleMin)`
	   dans le clamp de state.ts laisse donc les 21 cas passer aussi.
	   Ici l'examen est dans 2 h : plafond = ratio(H=2h, bornée à 7 j →
	   ratio=0,30) × 2 h = 0,6 h, sous intervalleMin (4 h). Le commentaire
	   du code est explicite : « le plancher gagne sur le plafond ».
	   Calcul à la main : premier succès → interval = intervalleInitial
	   (24 h) ; clamp = min(max(24h,4h), max(0,6h,4h)) = min(24h,4h) = 4h.
	   Le re-bornage final (même horizon, plafondNow = 0,6 h) redonne 4h.
	   Sans le `Math.max(plafond, intervalleMin)`, le clamp retomberait
	   sur 0,6 h — valeur exacte attendue ici : intervalleMin, pas 0,6 h. */
	r.check("le plancher (intervalleMin) gagne quand le plafond tombe sous lui",
		etat([rep("a", T0, "correct")], { M: T0 + 2 * HEURE }, T0).interval,
		P.intervalleMin);

	/* JAMAIS DE SORTIE DU SYSTÈME : dix succès de suite laissent une
	   échéance finie. Une question qui sortirait après une réussite
	   sacrifierait exactement ce que l'espacement sert à obtenir. */
	const dix = st.deriveStates({
		now, items: [item("a")], events: serie, horizons: {}, params: P,
	}).get("a");
	r.check("dix succès → échéance toujours finie", Number.isFinite(dix.dueAt), true);
	r.check("dix succès → toujours pas neuve", dix.isNew, false);

	/* RE-BORNAGE AU PLAFOND ACTUEL : un intervalle calculé quand l'examen
	   était loin doit se resserrer quand il approche.
	   (finding 3, revue task-3) `now` est ICI volontairement APRÈS le
	   dernier événement. Avec `now` == date du dernier événement (version
	   d'origine), plafondNow == le plafond déjà appliqué à cette même
	   itération dans la boucle : le re-bornage final (state.ts, après la
	   boucle) est un no-op que la suppression de son code ne change pas —
	   aucune des deux anciennes bornes (2 × intervalleInitial) ne le
	   remarquait. En avançant `now` à T0+4j, le plafond RECALCULÉ à
	   aujourd'hui (horizon 1 j) devient strictement plus étroit que celui
	   figé en fin de boucle (horizon 2 j) : le resserrement vient
	   authentiquement de plafondNow, pas d'un hasard de bornes.
	   Calcul à la main (ratio = 0,30 exact : tous les horizons ci-dessous
	   sont ≤ 7 j, donc bornés à l'ancrage) :
	     succès à T0    (H = 5 j, plafond = 0,30×5j = 1,5 j)
	       → interval = intervalleInitial = 1 j (sous le plafond)
	     succès à T0+1j (H = 4 j, plafond = 0,30×4j = 1,2 j)
	       → 1 j × facteurSucces = 2 j, CLAMPÉ à 1,2 j
	     succès à T0+3j (H = 2 j, plafond = 0,30×2j = 0,6 j)
	       → 1,2 j × facteurSucces = 2,4 j, CLAMPÉ à 0,6 j
	   Fin de boucle : interval = 0,6 j, lastAt = T0+3j.
	   Re-bornage à now = T0+4j (H = 5j−4j = 1 j, plafondNow = 0,30×1j = 0,3j) :
	     interval = min(0,6j, max(0,3j, intervalleMin)) = 0,3 j.
	   Sans ce re-bornage, l'intervalle resterait à 0,6 j : l'encadrement
	   serré [0,29 j ; 0,31 j] sépare 0,3 j (attendu) de 0,6 j (no-op). */
	const large = [rep("a", T0, "correct"), rep("a", T0 + j(1), "correct"), rep("a", T0 + j(3), "correct")];
	const proche = st.deriveStates({
		now: T0 + j(4), items: [item("a")], events: large,
		horizons: { M: T0 + j(5) }, params: P,
	}).get("a");
	r.check("l'examen qui approche resserre l'intervalle déjà acquis (borne haute)",
		proche.interval <= 0.31 * JOUR, true);
	r.check("l'examen qui approche resserre l'intervalle déjà acquis (borne basse)",
		proche.interval > 0.29 * JOUR, true);

	// Un événement dont la question n'existe plus n'est jamais planifié.
	const orphelin = st.deriveStates({
		now, items: [item("a")], events: [rep("disparue", T0, "correct")],
		horizons: {}, params: P,
	});
	r.check("événement orphelin ignoré", orphelin.has("disparue"), false);
	r.check("l'item existant reste neuf", orphelin.get("a").isNew, true);

	r.done();
});

await withSrcModule(["src/scheduler/index.ts"], (S) => {
	const r = makeReporter("Ordonnanceur — plan du jour");
	const P = S.DEFAULT_PARAMS;
	const T0 = 1_700_000_000_000;
	const j = (n) => n * JOUR;
	const rep = (q, at, grade) => ({ t: "answer", q, at, grade });
	const base = (over = {}) => ({
		now: T0, dayStart: T0 - HEURE, horizons: {}, params: P,
		items: [], events: [], ...over,
	});

	// Déterminisme : deux appels identiques donnent le même plan.
	const neufs = [];
	for (let k = 0; k < 40; k++) neufs.push({ q: "q" + k, module: "M", source: "s" + (k % 3) });
	const a = S.planToday(base({ items: neufs }));
	const b = S.planToday(base({ items: neufs }));
	r.check("deux appels identiques donnent le même plan", a.today, b.today);

	/* QUOTA DE NEUFS : sans lui, une génération de 80 questions noierait
	   toutes les révisions le jour même.
	   FIX minor 1 (revue round 1) : valeur calculée à la main, pas la
	   formule du code recopiée — budgetJour=40, partNeuf=0,25 → 40×0,25=10,
	   arrondi=10. Écrire `Math.round(P.budgetJour*P.partNeuf)` ici ferait
	   de ce cas une tautologie : casser l'arrondi du code le laisserait
	   vert puisque l'expression casserait de la même façon des deux côtés. */
	r.check("le quota borne les questions jamais vues", a.today.length, 10);
	r.check("les neufs sont comptés", a.stats.new, 40);

	// Le budget est respecté, et le surplus reporté.
	const dus = [];
	const evts = [];
	for (let k = 0; k < 60; k++) {
		dus.push({ q: "d" + String(k).padStart(2, "0"), module: "M", source: "s" });
		evts.push(rep("d" + String(k).padStart(2, "0"), T0 - j(10), "correct"));
	}
	const charge = S.planToday(base({ items: dus, events: evts }));
	r.check("budget respecté", charge.today.length, P.budgetJour);
	r.check("le surplus est reporté, pas perdu",
		charge.today.length + charge.deferred.length, 60);
	r.check("tout est dû", charge.stats.due, 60);

	/* BUDGET DÉJÀ CONSOMMÉ : le noyau ne persiste rien, il COMPTE ce qui a
	   été fait depuis dayStart. Rouvrir le tableau de bord après quarante
	   questions ne doit pas en redonner quarante. */
	const dejaFait = dus.map(it => rep(it.q, T0 - HEURE / 2, "correct"));
	const apres = S.planToday(base({ items: dus, events: [...evts, ...dejaFait] }));
	r.check("ce qui a déjà été fait aujourd'hui est décompté", apres.stats.spentToday, 60);
	r.check("budget épuisé → rien de plus aujourd'hui", apres.today.length, 0);

	/* Le cas précédent repasse à 0 pour DEUX raisons superposées : le budget
	   épuisé, mais AUSSI le fait que réviser une seconde fois aujourd'hui
	   repousse déjà l'échéance de chacun des 60 items hors de « dû » (leur
	   propre dueAt avance dans le futur). Un noyau qui aurait perdu la
	   soustraction spentToday donnerait le même today.length = 0 ici, pour
	   la mauvaise raison — ce cas ne le distinguerait pas. Isoler la
	   décrémentation : consommer le budget par des événements SANS RAPPORT
	   avec le catalogue (une autre clé, hors de `items`), pendant que les 60
	   items dus restent dus (leur seul événement reste à 10 jours, hors de
	   la fenêtre d'aujourd'hui — leur état ne bouge pas). Leur exclusion ne
	   peut alors venir QUE du budget consommé ailleurs. */
	const ailleurs = [];
	for (let k = 0; k < 40; k++) ailleurs.push(rep("ailleurs" + k, T0 - HEURE / 2, "correct"));
	const consomme = S.planToday(base({ items: dus, events: [...evts, ...ailleurs] }));
	r.check("un budget consommé ailleurs exclut aussi les items dus",
		consomme.today.length, 0);

	/* FIX finding 1 (revue round 1, change de code de production) : le
	   quota de neufs doit porter sur le budget RESTANT, pas sur le budget
	   nominal — sinon dès que le budget est déjà entamé, les neufs
	   prennent toute la place qui reste et aucune révision ne passe,
	   l'inverse du but du quota (§7.2 de la spec : « Compléter avec des
	   questions jamais vues, sous quota (partNeuf DU BUDGET) », trois
	   lignes après le §7.1 qui vient d'expliquer que le budget se
	   consomme au fil du jour). Scénario du rapport : 35 questions déjà
	   faites ce matin (consommées AILLEURS, hors catalogue, pour ne pas
	   faire bouger l'état des 20 révisions dues), budget nominal 40 →
	   budget restant = 5. quotaNeuf = round(5×0,25) = 1 ; révisions
	   retenues = min(20 dus, 5−1) = 4. Le plan doit contenir À LA FOIS des
	   révisions ("p…") et un neuf ("np…") — avec l'ancienne formule
	   (round(40×0,25)=10, plafonnée au budget=5), les 5 places partaient
	   TOUTES aux neufs et aucune révision ne passait. */
	const dusPartiel = [];
	const evtsPartiel = [];
	for (let k = 0; k < 20; k++) {
		dusPartiel.push({ q: "p" + String(k).padStart(2, "0"), module: "M", source: "s" });
		evtsPartiel.push(rep("p" + String(k).padStart(2, "0"), T0 - j(10), "correct"));
	}
	const neufsPartiel = [];
	for (let k = 0; k < 20; k++) neufsPartiel.push({ q: "np" + String(k).padStart(2, "0"), module: "M", source: "s" });
	const ailleurs2 = [];
	for (let k = 0; k < 35; k++) ailleurs2.push(rep("ailleurs2-" + k, T0 - HEURE / 2, "correct"));
	const partiel = S.planToday(base({
		items: [...dusPartiel, ...neufsPartiel],
		events: [...evtsPartiel, ...ailleurs2],
	}));
	r.check("budget restant (5) respecté avec neufs et révisions en présence",
		partiel.today.length, 5);
	r.check("le budget restreint laisse quand même passer des révisions",
		partiel.today.filter(q => q.startsWith("p")).length, 4);
	r.check("le budget restreint laisse aussi passer un neuf",
		partiel.today.filter(q => q.startsWith("np")).length, 1);

	/* ANTICIPATION : quand le budget n'est pas atteint, on tire vers
	   aujourd'hui ce qui tombe plus tard, JAMAIS au-delà de la marge. */
	const futur = [{ q: "f1", module: "M", source: "s" }];
	// Deux succès espacés d'un jour → intervalle 2 j, échéance à T0 + 0,2 j.
	const proche = [rep("f1", T0 - j(2.8), "correct"), rep("f1", T0 - j(1.8), "correct")];
	r.check("ce qui tombe dans la marge est avancé",
		S.planToday(base({ items: futur, events: proche })).stats.ahead, 1);
	// Échéance à T0 + 1,5 j sur un intervalle de 2 j : hors marge (0,4 j).
	const loin = [rep("f1", T0 - j(1.5), "correct"), rep("f1", T0 - j(0.5), "correct")];
	r.check("ce qui tombe hors marge n'est jamais avancé",
		S.planToday(base({ items: futur, events: loin })).stats.ahead, 0);

	/* Chaîne de succès EXACTEMENT espacés (chaque écart == l'intervalle en
	   cours, donc toujours « dû » à l'égalité, jamais amorti par la marge) :
	   après k succès, l'intervalle vaut intervalleInitial × facteurSucces^(k-1),
	   et l'échéance finale = t1 + intervalleInitial × (facteurSucces^k − 1) /
	   (facteurSucces − 1) — ici facteurSucces = 2, donc t1 + intervalleInitial
	   × (2^k − 1). Résoudre pour t1 permet de VISER une échéance précise sans
	   recopier une valeur produite par le code. */
	function chaine(q, k, dueAtVoulu) {
		const t1 = dueAtVoulu - P.intervalleInitial * (Math.pow(P.facteurSucces, k) - 1) / (P.facteurSucces - 1);
		const evs = [];
		let t = t1, intervalle = P.intervalleInitial;
		for (let n = 1; n <= k; n++) {
			evs.push(rep(q, t, "correct"));
			if (n < k) { t += intervalle; intervalle *= P.facteurSucces; }
		}
		return evs;
	}

	/* FIX finding 2a (revue round 1) : aucune des assertions précédentes ne
	   lisait `Plan.forecast`, et le vider à des zéros les laissait toutes
	   vertes. `forecast` décrit les ÉCHÉANCES PROJETÉES sur la fenêtre de
	   lissage — AVANT toute décision d'anticipation (ruling du contrôleur,
	   documenté sur `Plan.forecast` dans types.ts) : le jour 0 porte les dus
	   (`dus.length`), PLUS les futurs dont l'échéance tombe dans les 24 h.
	   2 dus (échéance déjà passée, jour 0) + 4 futurs visés par `chaine()` :
	   f0 → jour 0 (T0+0,5j), f1a et f1b → jour 1 (T0+1,5j et T0+1,2j),
	   f3 → jour 3 (T0+3j, k=3). Valeurs attendues posées à la main :
	   jour 0 = 2 dus + f0 = 3 ; jour 1 = f1a + f1b = 2 ; jour 3 = f3 = 1 ;
	   tous les autres jours à 0. */
	const dusForecast = [{ q: "fd0", module: "M", source: "s" }, { q: "fd1", module: "M", source: "s" }];
	const evtsForecast = [rep("fd0", T0 - j(10), "correct"), rep("fd1", T0 - j(10), "correct")];
	const itemsForecast = [
		...dusForecast,
		{ q: "f0", module: "M", source: "s" },
		{ q: "f1a", module: "M", source: "s" },
		{ q: "f1b", module: "M", source: "s" },
		{ q: "f3", module: "M", source: "s" },
	];
	const planForecast = S.planToday(base({
		items: itemsForecast,
		events: [
			...evtsForecast,
			...chaine("f0", 2, T0 + j(0.5)),
			...chaine("f1a", 2, T0 + j(1.5)),
			...chaine("f1b", 2, T0 + j(1.2)),
			...chaine("f3", 3, T0 + j(3)),
		],
	}));
	const forecastAttendu = new Array(P.fenetreLissage).fill(0);
	forecastAttendu[0] = 3; // 2 dus (fd0, fd1) + f0 (échéance dans les 24 h)
	forecastAttendu[1] = 2; // f1a + f1b
	forecastAttendu[3] = 1; // f3
	r.check("forecast projette les échéances à venir, jour par jour",
		planForecast.forecast, forecastAttendu);

	/* FIX finding 2b (revue round 1) : le tri par jour le plus chargé
	   (`cb - ca` dans plan.ts) n'était éprouvé nulle part — les deux cas
	   d'anticipation ci-dessus n'ont qu'UN candidat chacun, donc remplacer
	   `cb - ca` par 0 les aurait laissés verts eux aussi. Ici DEUX
	   candidats et un budget qui n'en laisse passer qu'UN SEUL : `busyX`
	   tombe le jour 2 (chargé : 4 items de remplissage, hors marge donc
	   jamais candidats eux-mêmes, + lui-même = 5), `legerY` tombe le
	   jour 1 (seul, charge 1). Point de discrimination : `busyX` a une
	   échéance PLUS TARDIVE que `legerY` (T0+2,5j contre T0+1,2j) — un tri
	   neutralisé qui retomberait sur le départage par échéance choisirait
	   `legerY` en premier ; seul le jour le plus chargé doit faire
	   préférer `busyX`. */
	const remplissage = [];
	const evtsRemplissage = [];
	for (let k = 0; k < 4; k++) {
		remplissage.push({ q: "pad" + k, module: "M", source: "s" });
		evtsRemplissage.push(...chaine("pad" + k, 3, T0 + j(2.3))); // jour 2, hors marge (0,8 j)
	}
	const ailleurs3 = [];
	for (let k = 0; k < 39; k++) ailleurs3.push(rep("ailleurs3-" + k, T0 - HEURE / 2, "correct"));
	const busy = S.planToday(base({
		items: [...remplissage, { q: "busyX", module: "M", source: "s" }, { q: "legerY", module: "M", source: "s" }],
		events: [
			...evtsRemplissage,
			...chaine("busyX", 5, T0 + j(2.5)),  // jour 2, dans la marge (3,2 j)
			...chaine("legerY", 4, T0 + j(1.2)), // jour 1, dans la marge (1,6 j)
			...ailleurs3, // budget restant = 40 − 39 = 1 : un seul avancement possible
		],
	}));
	r.check("le jour le plus chargé est avancé en premier, pas l'échéance la plus proche",
		busy.today.includes("busyX"), true);
	r.check("le candidat du jour le moins chargé attend son tour",
		busy.today.includes("legerY"), false);
	r.check("un seul avancement, le budget restant ne permet que lui",
		busy.stats.ahead, 1);

	/* ENTRELACEMENT : deux modules ne s'entremêlent pas — ils ne se
	   confondent pas, les mélanger ne coûterait que du changement de
	   contexte. À l'intérieur d'un module, les familles alternent. */
	const deuxModules = [];
	const evts2 = [];
	for (let k = 0; k < 4; k++) {
		deuxModules.push({ q: "A" + k, module: "A", source: "sA" + (k % 2) });
		deuxModules.push({ q: "B" + k, module: "B", source: "sB" + (k % 2) });
		evts2.push(rep("A" + k, T0 - j(10), "correct"), rep("B" + k, T0 - j(10), "correct"));
	}
	const ordre = S.planToday(base({ items: deuxModules, events: evts2 })).today;
	/* FIX minor 2 (revue round 1) : ni la longueur ni l'unicité n'étaient
	   bornées — un `ordonner` qui n'émettrait que "A0" et "B0" donnerait
	   déjà bascules=1 et familles=[0], les deux verts. 8 items catalogués
	   (4 par module), tous dus : les 8 doivent ressortir, une seule fois
	   chacun. */
	r.check("les 8 questions dues ressortent toutes", ordre.length, 8);
	r.check("aucun doublon dans le plan", new Set(ordre).size, 8);
	const modules = ordre.map(q => q[0]);
	const bascules = modules.filter((m, i) => i > 0 && m !== modules[i - 1]).length;
	r.check("les modules ne s'entremêlent pas (une seule bascule)", bascules, 1);

	const premier = ordre.filter(q => q[0] === modules[0]);
	const familles = premier.map(q => Number(q.slice(1)) % 2);
	r.check("les familles d'un même module alternent",
		familles.every((f, i) => i === 0 || f !== familles[i - 1]), true);

	/* Les neufs sont RÉPARTIS, pas relégués : une session écourtée doit
	   progresser sur les deux fronts, sinon la couverture stagne et crée
	   des angles morts permanents. */
	const mixte = [{ q: "n1", module: "M", source: "s" }];
	const evts3 = [];
	for (let k = 0; k < 6; k++) {
		mixte.push({ q: "r" + k, module: "M", source: "s" });
		evts3.push(rep("r" + k, T0 - j(10), "correct"));
	}
	const repartis = S.planToday(base({ items: mixte, events: evts3 })).today;
	r.check("le neuf n'est pas relégué en dernier", repartis[repartis.length - 1], "r5");
	r.check("le neuf n'est pas non plus en premier", repartis[0] === "n1", false);
	r.check("le neuf est bien présent", repartis.includes("n1"), true);

	/* REJOUABILITÉ : changer un paramètre et rejouer le MÊME journal change
	   le plan. C'est la preuve que rien n'est figé dans un état persistant. */
	const serre = S.planToday(base({ items: dus, events: evts, params: { ...P, budgetJour: 5 } }));
	r.check("un paramètre modifié change le plan sur le même journal",
		serre.today.length, 5);

	// Une question absente du catalogue n'apparaît jamais.
	r.check("question absente du catalogue jamais planifiée",
		S.planToday(base({ events: [rep("x", T0 - j(10), "correct")] })).today, []);

	// Le renommage est appliqué AVANT la planification.
	const renomme = S.planToday(base({
		items: [{ q: "b.md::q1", module: "M", source: "s" }],
		events: [
			rep("a.md::q1", T0 - j(10), "correct"),
			{ t: "rename", from: "a.md", to: "b.md", at: T0 - j(9) },
		],
	}));
	r.check("l'historique suit la note renommée", renomme.stats.new, 0);

	r.done();
});

await withSrcModule(["src/scheduler/index.ts"], (S) => {
	const r = makeReporter("Scheduler — outcome of a past day");
	const P = S.DEFAULT_PARAMS;
	const D0 = 1_700_000_000_000;
	const D1 = D0 + JOUR;
	const rep = (q, at, grade = "correct") => ({ t: "answer", q, at, grade });
	const items = (...qs) => qs.map(q => ({ q, module: "M", source: "s" }));
	const jour = (over = {}) => ({ dayStart: D0, dayEnd: D1, horizons: {}, params: P, items: [], events: [], ...over });

	r.check("nothing due: none", S.dayOutcome(jour()), "none");
	r.check("every due question answered that day: done",
		S.dayOutcome(jour({ items: items("a", "b"), events: [rep("a", D0 + HEURE), rep("b", D0 + 2 * HEURE)] })), "done");
	r.check("one due question left: missed",
		S.dayOutcome(jour({ items: items("a", "b"), events: [rep("a", D0 + HEURE)] })), "missed");
	r.check("a wrong answer still answers the question: done",
		S.dayOutcome(jour({ items: items("a"), events: [rep("a", D0 + HEURE, "wrong")] })), "done");
	r.check("an answer after midnight counts for the next day: missed",
		S.dayOutcome(jour({ items: items("a"), events: [rep("a", D1)] })), "missed");
	r.check("an answer at the very start of the day counts for it: done",
		S.dayOutcome(jour({ items: items("a"), events: [rep("a", D0)] })), "done");

	// A question answered the day before, then due again: that answer does
	// not validate the day.
	const avant = { items: items("a"), events: [rep("a", D0 - 2 * JOUR, "wrong")] };
	const dueAgain = S.planToday({ now: D0, dayStart: D0, horizons: {}, params: P, ...avant }).today.includes("a");
	r.check("an answer the day before does not validate the day",
		S.dayOutcome(jour(avant)), dueAgain ? "missed" : "none");
	r.check("(the case above really has the question due again)", dueAgain, true);

	// A note renamed AFTER the day keeps the answers given under its old name.
	r.check("renamed after the day: the old name's answers count",
		S.dayOutcome(jour({
			items: [{ q: "b.md::q1", module: "M", source: "s" }],
			events: [rep("a.md::q1", D0 + HEURE), { t: "rename", from: "a.md", to: "b.md", at: D1 + JOUR }],
		})), "done");

	// The day's budget bounds what was due: answering exactly the planned
	// questions is enough, answering as many OTHER ones is not.
	const dix = items("q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9");
	const serre = { ...P, budgetJour: 12, partNeuf: 0.25 };
	const prevus = S.planToday({ now: D0, dayStart: D0, horizons: {}, params: serre, items: dix, events: [] }).today;
	const autres = dix.map(i => i.q).filter(q => !prevus.includes(q)).slice(0, prevus.length);
	r.check("the budget bounds the day's plan", prevus.length, 3);
	r.check("the planned questions answered: done",
		S.dayOutcome(jour({ items: dix, params: serre, events: prevus.map((q, k) => rep(q, D0 + k * HEURE)) })), "done");
	r.check("as many other questions answered: missed",
		S.dayOutcome(jour({ items: dix, params: serre, events: autres.map((q, k) => rep(q, D0 + k * HEURE)) })), "missed");

	r.done();
});
