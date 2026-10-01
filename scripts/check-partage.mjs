/**
 * LE PARTAGE, côté principal (`apps/windows/electron/partage.ts`), et la
 * CITATION PowerShell du principal (`citerPs`, `process.ts`).
 *
 * Ce qu'il empêche :
 * - un nom venu de la fenêtre qui serait un CHEMIN (`..\..\Startup\x.zip`)
 *   et écrirait hors du dossier temporaire ; une extension hors liste
 *   (`.bat`) ; un contenu vide ou démesuré ;
 * - un script Discord qui dépendrait de ce que la fenêtre envoie : il est
 *   CONSTANT, le chemin passe par une variable d'environnement ;
 * - un partage lancé en boucle (le verrou) ;
 * - une apostrophe TYPOGRAPHIQUE (’ ‘ ‚ ‛) qui fermerait une chaîne
 *   PowerShell : PowerShell les tient toutes pour des apostrophes, et ne
 *   doubler que l'ASCII laissait « l’an » faire exécuter la suite (mesuré le
 *   2026-09-25). Sous Windows, les cas sont rejoués sur le VRAI powershell.exe.
 *     npm run check:partage
 */
import { execFileSync } from "node:child_process";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/electron/partage.ts", ({ nomPartage, octetsPartage, scriptDiscord, creerVerrou, temporairesPerimes, VARIABLE_FICHIER, TAILLE_MAX_PARTAGE }) => {
	const r = makeReporter("Partage — noms, contenus, script, verrou");
	r.check("un nom de zip ordinaire passe tel quel", nomPartage("XTI301 - Écosystème Python.zip"), "XTI301 - Écosystème Python.zip");
	r.check("un .md passe", nomPartage("CM1.md"), "CM1.md");
	r.check("une apostrophe typographique reste dans le NOM (le script ne le voit jamais)", nomPartage("L’an.md"), "L’an.md");
	r.check("les séparateurs deviennent des tirets : un nom, jamais un chemin",
		nomPartage(String.raw`..\..\Startup\x.zip`), "-..-Startup-x.zip");
	r.check("un séparateur « / » aussi", nomPartage("a/b.zip"), "a-b.zip");
	r.check("une extension hors liste est refusée", nomPartage("x.bat"), null);
	r.check("l'extension compte même en majuscules", nomPartage("x.ZIP"), "x.ZIP");
	r.check("sans extension, refusé", nomPartage("zip"), null);
	r.check("un point final ne cache pas une autre extension", nomPartage("x.bat."), null);
	r.check("pas une chaîne, refusé", nomPartage(42), null);
	r.check("vide, refusé", nomPartage(""), null);
	r.check("trop long, refusé", nomPartage("a".repeat(200) + ".zip"), null);
	r.check("des octets ordinaires passent", octetsPartage(new Uint8Array([1, 2]))?.length, 2);
	r.check("vide, refusé", octetsPartage(new Uint8Array(0)), null);
	r.check("au-delà de la borne, refusé", octetsPartage(new Uint8Array(TAILLE_MAX_PARTAGE + 1)), null);
	r.check("un tableau ordinaire n'est pas un contenu", octetsPartage([1, 2]), null);
	r.check("the main process bound is the window's bound (16 MB, `SHARE_MAX_BYTES`)", TAILLE_MAX_PARTAGE, 16 * 1024 * 1024);

	const s = scriptDiscord();
	r.check("le script lit le chemin dans la variable d'environnement",
		s.includes(`Set-Clipboard -LiteralPath $env:${VARIABLE_FICHIER}`), true);
	r.check("le script est constant : il ne prend aucun argument", scriptDiscord.length, 0);

	let t = 0;
	const v = creerVerrou(1000, 0, () => t);
	const j1 = v.prendre();
	r.check("le premier partage prend le verrou", j1 !== null, true);
	r.check("un second, pendant le premier, est refusé", v.prendre(), null);
	v.rendre(j1);
	const j2 = v.prendre();
	r.check("rendu, le verrou se reprend", j2 !== null, true);
	t = 999;
	r.check("toujours tenu juste avant le délai", v.prendre(), null);
	t = 1000;
	const j3 = v.prendre();
	r.check("retombé de lui-même au délai : un processus bloqué ne bloque pas tout", j3 !== null, true);
	v.rendre(j2);
	r.check("l'ancien processus qui finit ne libère pas le verrou du suivant", v.prendre(), null);
	v.rendre(j3);
	r.check("le suivant, lui, le rend", v.prendre() !== null, true);

	let u = 0;
	const w = creerVerrou(1000, 2000, () => u);
	w.rendre(w.prendre());
	u = 1999;
	r.check("rendu mais trop tôt : l'intervalle minimal refuse", w.prendre(), null);
	u = 2000;
	r.check("l'intervalle écoulé, le partage repart", w.prendre() !== null, true);

	const maintenant = 10 * 60 * 1000 + 5000;
	r.check("le ménage n'efface que NOS dossiers périmés", temporairesPerimes([
		{ nom: "neo-quiz-partage-vieux", mtimeMs: 0, dossier: true },
		{ nom: "neo-quiz-partage-recent", mtimeMs: maintenant - 1000, dossier: true },
		{ nom: "autre-appli-vieux", mtimeMs: 0, dossier: true },
		{ nom: "neo-quiz-partage-lien", mtimeMs: 0, dossier: false },
	], maintenant), ["neo-quiz-partage-vieux"]);
	r.done();
});

/* LES ARGUMENTS D'UN CLI venus de la fenêtre (`gabarits-cli.ts`, revue de
   sécurité du 2026-09-25) : les appels RÉELS de `ai-client.ts` et
   `ai-providers.ts` passent, et une seule option de plus les fait refuser. */
await withSrcModule("apps/windows/electron/gabarits-cli.ts", ({ argumentsAutorises }) => {
	const r = makeReporter("Arguments des CLI (liste blanche)");
	const m = "0123456789abcdef0123456789abcdef";
	const j = (nom) => `{{nq-${m}:${nom}}}`;
	const claude = (modele, outils) => ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", modele, "--tools", outils, "--no-session-persistence", "--setting-sources", ""];
	const codex = (rapide, images) => ["exec", "--json", "-m", "gpt-5.1-codex", "-c", "model_reasoning_effort=high",
		...(rapide ? ["-c", "service_tier=priority"] : []),
		"-s", "read-only", "--skip-git-repo-check", "--ignore-user-config", "-C", j("home"), "-o", j("sortie"),
		...Array.from({ length: images }, (_, i) => ["-i", j("fichier:" + (i + 1))]).flat()];
	const agy = ["--input-format", "stream-json", "--output-format", "stream-json"];

	r.check("les sondes de version passent", ["claude", "codex", "agy"].map(o => argumentsAutorises(o, ["--version"], undefined)), [true, true, true]);
	r.check("agy models passe", argumentsAutorises("agy", ["models"], undefined), true);
	r.check("agy génération, sans et avec modèle", [argumentsAutorises("agy", agy, m), argumentsAutorises("agy", [...agy, "--model", "gemini-2.5-pro"], m)], [true, true]);
	r.check("claude sans outil, et avec Read pour les images", [argumentsAutorises("claude", claude("claude-opus-4-1", ""), m), argumentsAutorises("claude", claude("opus[1m]", "Read"), m)], [true, true]);
	r.check("codex, rapide ou non, avec 0 à 3 images", [argumentsAutorises("codex", codex(false, 0), m), argumentsAutorises("codex", codex(true, 1), m), argumentsAutorises("codex", codex(false, 3), m)], [true, true, true]);

	r.check("claude + --dangerously-skip-permissions : refusé", argumentsAutorises("claude", [...claude("sonnet", ""), "--dangerously-skip-permissions"], m), false);
	r.check("claude: the old one-object json output, or the stream without its partial messages: refused",
		[argumentsAutorises("claude", ["-p", "--output-format", "json", "--model", "sonnet", "--tools", "", "--no-session-persistence", "--setting-sources", ""], m),
			argumentsAutorises("claude", claude("sonnet", "").filter(x => x !== "--include-partial-messages"), m)], [false, false]);
	r.check("claude + --mcp-config : refusé", argumentsAutorises("claude", [...claude("sonnet", ""), "--mcp-config", "{}"], m), false);
	r.check("claude avec un outil autre que Read : refusé", argumentsAutorises("claude", claude("sonnet", "Bash"), m), false);
	r.check("claude, un modèle qui est une option : refusé", argumentsAutorises("claude", claude("--dangerously-skip-permissions", ""), m), false);
	r.check("codex + --dangerously-bypass-approvals-and-sandbox : refusé", argumentsAutorises("codex", [...codex(false, 0), "--dangerously-bypass-approvals-and-sandbox"], m), false);
	r.check("codex en bac à sable danger-full-access : refusé", argumentsAutorises("codex", codex(false, 0).map(a => a === "read-only" ? "danger-full-access" : a), m), false);
	r.check("codex, un -c arbitraire à la place de l'effort : refusé", argumentsAutorises("codex", codex(false, 0).map(a => a === "model_reasoning_effort=high" ? "sandbox_mode=danger-full-access" : a), m), false);
	r.check("codex, un jeton d'un AUTRE marqueur : refusé", argumentsAutorises("codex", codex(false, 0), "f".repeat(32)), false);
	r.check("codex, une image hors ordre : refusé", argumentsAutorises("codex", [...codex(false, 0), "-i", j("fichier:2")], m), false);
	r.check("codex, un modèle avec % : refusé (repli cmd.exe)", argumentsAutorises("codex", codex(false, 0).map(a => a === "gpt-5.1-codex" ? "a%CMDCMDLINE%" : a), m), false);
	r.check("ollama ne passe jamais par process.run", argumentsAutorises("ollama", ["run", "x"], m), false);
	r.check("un argument non-chaîne : refusé", argumentsAutorises("claude", [1], m), false);
	r.check("pas de tableau : refusé", argumentsAutorises("claude", "--version", m), false);
	r.done();
});

/* L'AUTRE BOUT du partage : l'import d'une archive REÇUE. */
await withSrcModule("src/dashboard/zip.ts", ({ nomNoteImportee }) => {
	const r = makeReporter("Import d'une archive reçue (nomNoteImportee)");
	r.check("une note ordinaire garde son nom", nomNoteImportee("CM1 - Intro.md"), "CM1 - Intro");
	r.check("un sous-dossier d'archive est aplati", nomNoteImportee("cours/CM2.md"), "CM2");
	r.check("un chemin Windows aussi", nomNoteImportee(String.raw`..\..\Startup\x.md`), "x");
	r.check("un .exe est écarté", nomNoteImportee("setup.exe"), null);
	r.check("un .lnk est écarté", nomNoteImportee("raccourci.lnk"), null);
	r.check("un .bat déguisé est écarté", nomNoteImportee("x.md.bat"), null);
	r.check("un nom fait de points est écarté", nomNoteImportee("...md"), null);
	r.check("un fichier caché perd son point", nomNoteImportee(".cache.md"), "cache");
	r.check("un dossier d'archive (fin en /) est écarté", nomNoteImportee("cours/"), null);
	r.check("l'extension compte en majuscules", nomNoteImportee("A.MD"), "A");
	r.done();
});

/* THE SHARE'S CONTENT AND THE RECEIVING READER (2026-10-01). A shared folder
   used to carry quiz notes only (every embedded image was dead on arrival) and
   the reader skipped every archive it had not written itself (deflate: "empty"). */
await withSrcModule(["src/dashboard/zip.ts", "src/dashboard/share-pack.ts"], async (zip, pack) => {
	const { buildZip, buildZipFiles, readZip, classerArchive, nomImageImportee, ZipReadError, IMPORT_LIMITS, SHARE_MAX_BYTES } = zip;
	const { embedTargets, packShare, isShareableImage } = pack;
	const { deflateRawSync } = await import("node:zlib");
	const r = makeReporter("Share content and archive reader");
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 7]);
	const crcOf = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
	/** A hand-made archive, as Explorer or 7-Zip writes it: deflate, central sizes. */
	const make = (entries, { flags = 0, method = 8, dropCrc = false } = {}) => {
		const parts = []; const cd = []; let off = 0;
		const w16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
		const w32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
		for (const e of entries) {
			const name = Buffer.from(e.name, "utf8");
			const raw = Buffer.from(e.bytes);
			const m = e.method ?? method;
			const body = m === 8 ? deflateRawSync(raw) : raw;
			const crc = dropCrc ? 1 : crcOf(raw);
			const local = Buffer.concat([w32(0x04034b50), w16(20), w16(flags), w16(m), w16(0), w16(0x21), w32(crc), w32(body.length), w32(raw.length), w16(name.length), w16(0), name, body]);
			cd.push(Buffer.concat([w32(0x02014b50), w16(20), w16(20), w16(flags), w16(m), w16(0), w16(0x21), w32(crc), w32(body.length), w32(e.declared ?? raw.length), w16(name.length), w16(0), w16(0), w16(0), w16(0), w32(0), w32(off), name]));
			parts.push(local); off += local.length;
		}
		const cdb = Buffer.concat(cd);
		return new Uint8Array(Buffer.concat([...parts, cdb, w32(0x06054b50), w16(0), w16(0), w16(entries.length), w16(entries.length), w32(cdb.length), w32(off), w16(0)]));
	};
	const refus = (p) => p.then(() => "read", (e) => e instanceof ZipReadError && e.code);

	// Round trip of our own writer, binary included.
	const own = buildZipFiles([{ name: "a.md", bytes: enc.encode("```quiz-blocks\n[]\n```") }, { name: "img/x.png", bytes: PNG }]);
	const back = await readZip(own);
	r.check("our own archive reads back, images byte for byte", [back.files.map(f => f.name), Array.from(back.files[1].bytes), back.skipped], [["a.md", "img/x.png"], Array.from(PNG), 0]);
	r.check("buildZip stays deterministic without a date (the pinned language pack)", Array.from(buildZip([{ name: "a.md", content: "x" }]).slice(10, 14)), [0, 0, 0, 0]);
	const dated = buildZip([{ name: "a.md", content: "x" }], new Date(2026, 9, 1, 12, 30, 20));
	const dv = new DataView(dated.buffer);
	r.check("a shared archive carries a real DOS date, not month 0 day 0", [dv.getUint16(12, true) & 31, (dv.getUint16(12, true) >> 5) & 15, 1980 + (dv.getUint16(12, true) >> 9)], [1, 10, 2026]);

	// An archive from another tool (deflate): the old reader found nothing.
	const note = "```quiz-blocks\n[{prompt:'é'}]\n```\n" + "x".repeat(5000);
	const defl = await readZip(make([{ name: "Cours/CM1 é.md", bytes: enc.encode(note) }, { name: "Cours/", bytes: [], method: 0 }]));
	r.check("a DEFLATE archive (Explorer, 7-Zip, macOS) is read, accents kept", [defl.files.length, defl.files[0]?.name, dec.decode(defl.files[0]?.bytes ?? new Uint8Array()) === note], [1, "Cours/CM1 é.md", true]);

	// Hostile archives.
	const bomb = await readZip(make([{ name: "b.md", bytes: new Uint8Array(1000), declared: 10 }]));
	r.check("an entry that inflates past its DECLARED size is dropped (zip bomb)", [bomb.files.length, bomb.skipped], [0, 1]);
	const hugeDeclared = await readZip(make([{ name: "b.md", bytes: new Uint8Array(100), declared: IMPORT_LIMITS.entry + 1 }]));
	r.check("an entry declared over the per-entry bound is dropped without inflating", [hugeDeclared.files.length, hugeDeclared.skipped], [0, 1]);
	const badCrc = await readZip(make([{ name: "c.md", bytes: enc.encode("abc") }], { dropCrc: true }));
	r.check("a bad checksum is dropped", [badCrc.files.length, badCrc.skipped], [0, 1]);
	const enc1 = await readZip(make([{ name: "e.md", bytes: enc.encode("abc") }], { flags: 1 }));
	r.check("an encrypted entry is dropped", [enc1.files.length, enc1.skipped], [0, 1]);
	const m9 = await readZip(make([{ name: "e.md", bytes: enc.encode("abc"), method: 9 }]));
	r.check("an unknown method is dropped", [m9.files.length, m9.skipped], [0, 1]);
	const many = make(Array.from({ length: 5 }, (_, i) => ({ name: `n${i}.md`, bytes: enc.encode("x") })));
	r.check("too many entries: refused whole", await refus(readZip(many, { ...IMPORT_LIMITS, entries: 4 })), "too-many");
	r.check("an archive over the bound: refused whole", await refus(readZip(own, { ...IMPORT_LIMITS, archive: 10 })), "too-large");
	r.check("not a zip: refused", await refus(readZip(enc.encode("hello, this is not a zip file at all"))), "invalid");
	r.check("a truncated archive: refused", await refus(readZip(own.slice(0, own.length - 30))), "invalid");
	const tot = await readZip(make([{ name: "a.md", bytes: enc.encode("x".repeat(60)) }, { name: "b.md", bytes: enc.encode("y".repeat(60)) }]), { ...IMPORT_LIMITS, total: 100 });
	r.check("the total inflated size is bounded", [tot.files.length, tot.skipped], [1, 1]);

	// What may be imported.
	const cls = classerArchive([
		{ name: "Cours/CM1.md", bytes: enc.encode("a") }, { name: String.raw`..\..\Startup\x.png`, bytes: PNG }, { name: "dessin.SVG", bytes: PNG },
		{ name: "setup.exe", bytes: PNG }, { name: "cours.pdf", bytes: PNG }, { name: "gros.png", bytes: new Uint8Array(8 * 1024 * 1024 + 1) },
	]);
	r.check("notes and raster images are kept, flattened; svg, exe, pdf, oversize are ignored",
		[cls.notes.map(n => n.name), cls.images.map(i => i.name), cls.ignored], [["CM1.md"], ["x.png"], 4]);
	r.check("an image name: path flattened, hidden dots stripped, no extension refused", [nomImageImportee("a/b/c.PNG"), nomImageImportee("..png"), nomImageImportee("x"), nomImageImportee("x.png.bat")], ["c.png", null, null, null]);

	// What a share carries.
	r.check("embedded images are found: wikilink with size and heading, markdown, not URLs",
		embedTargets("![[a.png|200]] ![[b c.jpg#x]] ![alt](d%20e.png) ![w](https://x/y.png) ![d](data:image/png;base64,AA) ![[Cours note]]"), ["a.png", "b c.jpg", "Cours note", "d e.png"]);
	r.check("isShareableImage", [isShareableImage("a.PNG"), isShareableImage("a.svg"), isShareableImage("a.pdf")], [true, false, false]);
	const notes = [{ name: "q.md", content: "x".repeat(1000) }];
	const imgs = [{ name: "a.png", bytes: new Uint8Array(4000) }, { name: "b.png", bytes: new Uint8Array(4000) }, { name: "c.png", bytes: new Uint8Array(100) }];
	const bound = 22 + 3 * 200 + 1000 + 4000 + 100;
	const small = packShare(notes, imgs, new Date(), bound);
	r.check("images that do not fit are LEFT OUT and counted, the rest goes in", [small.imagesIn, small.imagesOut, small.bytes !== null], [2, 1, true]);
	r.check("the built archive stays under the bound it was given", small.bytes.length <= bound, true);
	r.check("the archive reads back with the images that went in", (await readZip(small.bytes)).files.map(f => f.name), ["q.md", "a.png", "c.png"]);
	r.check("notes alone over the bound: no archive", packShare([{ name: "q.md", content: "x".repeat(2000) }], [], new Date(), 1000).bytes, null);
	r.check("a duplicate name is left out, not overwritten", packShare(notes, [{ name: "a.png", bytes: PNG }, { name: "A.png", bytes: PNG }], new Date()).imagesOut, 1);
	r.check("the bound is the share bound", SHARE_MAX_BYTES, 16 * 1024 * 1024);
	r.done();
});

await withSrcModule("apps/windows/electron/process.ts", ({ citerPs }) => {
	const r = makeReporter("Citation PowerShell (citerPs)");
	const Q = ["'", "\u2018", "\u2019", "\u201A", "\u201B"];
	for (const q of Q) {
		r.check(`U+${q.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")} est doublé`, citerPs(`a${q}b`), `'a${q}${q}b'`);
	}
	r.check("le reste passe tel quel", citerPs(String.raw`C:\x $y "z"`), String.raw`'C:\x $y "z"'`);

	/* Le VRAI PowerShell, sous Windows : la valeur ressort intacte, et la
	   tentative d'injection reste du texte. Hors Windows (CI Linux), pas de
	   powershell.exe : ces cas sont sautés, les cas purs ci-dessus restent. */
	if (process.platform === "win32") {
		const executer = (script) => execFileSync("powershell.exe",
			["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from("[Console]::OutputEncoding=[Text.Encoding]::UTF8;" + script, "utf16le").toString("base64")],
			{ encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
		for (const q of Q) {
			const valeur = `a${q}; Write-Output INJECTE; $x=${q}b`;
			r.check(`vrai PowerShell : U+${q.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")} ne ferme pas la chaîne`,
				executer(`$v = ${citerPs(valeur)}; [Console]::Out.Write($v)`), valeur);
		}
	}
	r.done();
});
