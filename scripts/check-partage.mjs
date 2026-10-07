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

await withSrcModule("apps/windows/electron/partage.ts", ({ nomPartage, octetsPartage, scriptPartageNatif, VARIABLES_NATIF, creerVerrou, temporairesPerimes, VARIABLE_FICHIER, TAILLE_MAX_PARTAGE }) => {
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

	/* The native Share panel (the only script of the share): constant, every
	   input read from the environment, and never a value spliced in. */
	const n = scriptPartageNatif();
	r.check("native share: the script takes no argument", scriptPartageNatif.length, 0);
	r.check("native share: title, text, file and point are read from the environment",
		Object.values(VARIABLES_NATIF).every(v => n.includes("$env:" + v)), true);
	r.check("native share: the file variable is the one the main process sets for Discord", VARIABLES_NATIF.fichier, VARIABLE_FICHIER);
	r.check("native share: two calls give the same script (nothing per share inside)", scriptPartageNatif() === n, true);
	r.check("native share: the point is parsed as integers, never run", n.includes("TryParse($env:NEO_QUIZ_PARTAGE_X") && n.includes("TryParse($env:NEO_QUIZ_PARTAGE_Y"), true);
	r.check("native share: no Invoke-Expression, no Start-Process, no iex", /Invoke-Expression|Start-Process|iex/i.test(n), false);

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
	r.check("the update of Claude Code and Codex passes, as the bare word", [argumentsAutorises("claude", ["update"], undefined), argumentsAutorises("codex", ["update"], undefined)], [true, true]);
	r.check("no update for agy, and no update with anything added", [argumentsAutorises("agy", ["update"], undefined), argumentsAutorises("claude", ["update", "--force"], undefined), argumentsAutorises("codex", ["update", "-c", "x=1"], undefined), argumentsAutorises("claude", ["upgrade"], undefined)], [false, false, false, false]);
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

/* THE NAME RULES, shared by the exporter and the importer (`share-names.ts`,
   2026-10-07). A rule that lives in one side only lets an exported archive
   hold a name the importer refuses. */
await withSrcModule(["src/dashboard/share-names.ts", "src/dashboard/zip.ts"], (names, zip) => {
	const { cleanName, isReservedName, baseNameVerdict, exportBaseName, dedupeNames, fitsPath, folderNameFromArchive, NAME_MAX, PATH_MAX } = names;
	const r = makeReporter("Share name rules (exporter and importer)");
	r.check("Windows reserves a device name for EVERY extension: con.txt.md, CON.md, nul.tar.gz", [isReservedName("con.txt.md"), isReservedName("CON.md"), isReservedName("nul.tar.gz")], [true, true, true]);
	r.check("device names: com0-9, lpt0-9, the superscript digits, the console handles, a trailing space", [isReservedName("COM1"), isReservedName("lpt9.md"), isReservedName("COM¹.md"), isReservedName("conout$"), isReservedName("aux .md")], [true, true, true, true, true]);
	r.check("a longer word that merely starts like one is fine", [isReservedName("console.md"), isReservedName("coma.md"), isReservedName("a.con.md")], [false, false, false]);
	r.check("a note import refuses con.txt.md and keeps console.md", [zip.nomNoteImportee("con.txt.md"), zip.nomNoteImportee("console.md")], [null, "console"]);
	r.check("an image import refuses nul.final.png", zip.nomImageImportee("nul.final.png"), null);
	const nfd = "café.md";
	r.check("NFD (macOS) becomes NFC", [zip.nomNoteImportee(nfd), zip.nomNoteImportee(nfd) === "café"], ["café", true]);
	r.check("an NFD image name matches the NFC link", zip.nomImageImportee("café.png"), "café.png");
	r.check("forbidden characters and controls become dashes, edge dots and spaces go", [cleanName(' a:b*c?"d<e>f|g\u0001 .'), cleanName("..x..")], ["a-b-c--d-e-f-g-", "x"]);
	r.check("a 300-character name is cut to the cap, not dropped", [zip.nomNoteImportee("x".repeat(300) + ".md")?.length, NAME_MAX], [NAME_MAX, 100]);
	r.check("empty after cleaning is refused with a reason", [baseNameVerdict("...").reason, baseNameVerdict("CON").reason], ["empty", "reserved"]);
	r.check("the exporter never refuses: a reserved name gets an underscore, an empty one the fallback", [exportBaseName("CON", "quiz"), exportBaseName("???", "quiz"), exportBaseName("a/b", "quiz"), exportBaseName("con.txt", "quiz")], ["CON_", "---", "a-b", "con_.txt"]);
	r.check("exporter and importer agree on hostile names: whatever is exported is accepted back", ["CON", "con.txt", "nul.", "Q:1", "x".repeat(400), "é́", "aux .z", " ", "lpt1"].every(n => {
		const out = exportBaseName(n, "quiz");
		return zip.nomNoteImportee(`${out}.md`) === out;
	}), true);
	r.check("names that differ only by case, or by NFC/NFD, collide: the next gets (2), (3)", dedupeNames(["A.md", "a.md", "café.md", "café.md", "A.MD"]), ["A.md", "a (2).md", "café.md", "café (2).md", "A (3).MD"]);
	r.check("a deduplicated name does not collide with a later real one", dedupeNames(["a.md", "a.md", "a (2).md"]), ["a.md", "a (2).md", "a (2) (2).md"]);
	r.check("the target path bound: 240 fits, 241 does not", [fitsPath("x".repeat(100), "y".repeat(139)), fitsPath("x".repeat(100), "y".repeat(140)), PATH_MAX], [true, false, 240]);
	r.check("the folder named after an archive: CON.zip, a download suffix, NFD, empty", [folderNameFromArchive("CON.zip"), folderNameFromArchive("Cours C (1).zip"), folderNameFromArchive("café.zip"), folderNameFromArchive(".zip"), folderNameFromArchive("a:b.zip")], ["Import", "Cours C", "café", "Import", "a-b"]);
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
	r.check("our own archive reads back, images byte for byte", [back.files.map(f => f.name), Array.from(back.files[1].bytes), back.skipped.length], [["a.md", "img/x.png"], Array.from(PNG), 0]);
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
	r.check("an entry that inflates past its DECLARED size is dropped (zip bomb)", [bomb.files.length, bomb.skipped.map(x => x.reason)], [0, ["corrupt"]]);
	const hugeDeclared = await readZip(make([{ name: "b.md", bytes: new Uint8Array(100), declared: IMPORT_LIMITS.entry + 1 }]));
	r.check("an entry declared over the per-entry bound is dropped without inflating", [hugeDeclared.files.length, hugeDeclared.skipped.map(x => x.reason)], [0, ["too-big"]]);
	const badCrc = await readZip(make([{ name: "c.md", bytes: enc.encode("abc") }], { dropCrc: true }));
	r.check("a bad checksum is dropped", [badCrc.files.length, badCrc.skipped.map(x => `${x.name}:${x.reason}`)], [0, ["c.md:bad-crc"]]);
	const enc1 = await readZip(make([{ name: "e.md", bytes: enc.encode("abc") }], { flags: 1 }));
	r.check("an encrypted entry is dropped", [enc1.files.length, enc1.skipped.map(x => x.reason)], [0, ["encrypted"]]);
	const m9 = await readZip(make([{ name: "e.md", bytes: enc.encode("abc"), method: 9 }]));
	r.check("an unknown method is dropped", [m9.files.length, m9.skipped.map(x => x.reason)], [0, ["method"]]);
	const many = make(Array.from({ length: 5 }, (_, i) => ({ name: `n${i}.md`, bytes: enc.encode("x") })));
	r.check("too many entries: refused whole", await refus(readZip(many, { ...IMPORT_LIMITS, entries: 4 })), "too-many");
	r.check("an archive over the bound: refused whole", await refus(readZip(own, { ...IMPORT_LIMITS, archive: 10 })), "too-large");
	r.check("not a zip: refused", await refus(readZip(enc.encode("hello, this is not a zip file at all"))), "invalid");
	r.check("a truncated archive: refused", await refus(readZip(own.slice(0, own.length - 30))), "invalid");
	const tot = await readZip(make([{ name: "a.md", bytes: enc.encode("x".repeat(60)) }, { name: "b.md", bytes: enc.encode("y".repeat(60)) }]), { ...IMPORT_LIMITS, total: 100 });
	r.check("the total inflated size is bounded", [tot.files.length, tot.skipped.map(x => x.reason)], [1, ["total"]]);

	// What may be imported.
	const cls = classerArchive([
		{ name: "Cours/CM1.md", bytes: enc.encode("a") }, { name: String.raw`..\..\Startup\x.png`, bytes: PNG }, { name: "dessin.SVG", bytes: PNG },
		{ name: "setup.exe", bytes: PNG }, { name: "cours.pdf", bytes: PNG }, { name: "gros.png", bytes: new Uint8Array(8 * 1024 * 1024 + 1) },
	]);
	r.check("notes and raster images are kept, flattened; svg, exe, pdf, oversize are ignored",
		[cls.notes.map(n => n.name), cls.images.map(i => i.name), cls.ignored.map(x => x.reason).sort()], [["CM1.md"], ["x.png"], ["image-too-large", "unsupported-type", "unsupported-type", "unsupported-type"]]);
	r.check("an image name: path flattened, hidden dots stripped, no extension refused", [nomImageImportee("a/b/c.PNG"), nomImageImportee("..png"), nomImageImportee("x"), nomImageImportee("x.png.bat")], ["c.png", null, null, null]);
	r.check("Windows device names are refused as imported names", [nomImageImportee("CON.png"), nomImageImportee("d/nul.jpg"), zip.nomNoteImportee("COM1.md"), zip.nomNoteImportee("console.md")], [null, null, null, "console"]);

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

/* THE READER HARDENED (2026-10-07): legacy names, zip64, overlap, system
   litter, links, ratio, and above all NOTHING dropped without a name and a
   reason. */
await withSrcModule(["src/dashboard/share-manifest.ts", "src/dashboard/share-pack.ts", "src/dashboard/zip.ts"], async (mf, pack, zip) => {
	const r = makeReporter("Share manifest (format 1) and the v1 packer");
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	const read = (o) => mf.readManifest(enc.encode(typeof o === "string" ? o : JSON.stringify(o)));
	const sha = "a".repeat(64);
	const ok = { format: "neo-quiz-share", version: 1, app: "1.0.0", created: "2026-10-07T12:00:00Z", kind: "folder", name: "X", files: [{ path: "A.md", kind: "note", size: 3, sha256: sha }] };

	r.check("no manifest = format 0", mf.readManifest(null), { status: "none" });
	r.check("a valid manifest is read", read(ok).status, "ok");
	r.check("garbage, an array, another format, a version below 1: all 'invalid', never a throw", [read("not json").status, read("[]").status, read({ ...ok, format: "x" }).status, read({ ...ok, version: 0 }).status, read({ ...ok, version: 1.5 }).status], ["invalid", "invalid", "invalid", "invalid", "invalid"]);
	r.check("a file entry with a bad hash makes the manifest invalid (no half-trusted list)", read({ ...ok, files: [{ path: "A.md", size: 1, sha256: "zz" }] }).status, "invalid");
	r.check("a NEWER version is 'newer' whatever else it holds (unknown fields, another hash scheme)", read({ format: "neo-quiz-share", version: 7, files: "blake3", extra: {} }), { status: "newer", version: 7 });
	r.check("unknown fields of the current version are ignored", read({ ...ok, brandNew: 1 }).status, "ok");
	r.check("paths are read as NFC", read({ ...ok, files: [{ ...ok.files[0], path: "e\u0301.md" }] }).manifest.files[0].path, "\u00e9.md");

	r.check("folder settings: a bad colour, an icon outside the list, control characters are dropped",
		mf.sanitizeFolderSettings({ color: "red", icon: "not-an-icon", name: "A\u0000B", ue: "\u0007UE\n1", extra: 1 }), { name: "A-B", ue: "UE 1" });
	r.check("folder settings: valid values are kept (colour lower-cased)", mf.sanitizeFolderSettings({ color: "#4F8CFF", icon: "book", name: "Cours", ue: "UE 1" }), { color: "#4f8cff", icon: "book", name: "Cours", ue: "UE 1" });
	r.check("folder settings: nothing usable = null", [mf.sanitizeFolderSettings({}), mf.sanitizeFolderSettings(null), mf.sanitizeFolderSettings("x")], [null, null, null]);
	r.check("folder settings: names are cut to 100 characters", mf.sanitizeFolderSettings({ name: "n".repeat(300) }).name.length, 100);

	const now = new Date(Date.UTC(2026, 9, 7, 12, 0, 0));
	const note = (path, text) => ({ path, kind: "note", bytes: enc.encode(text) });
	const img = (path, n) => ({ path, kind: "image", bytes: new Uint8Array(n).fill(7) });
	const packed = await pack.packShareV1([note("Dossier/a.md", "alpha")], [img("x.png", 10)], { app: "9.9.9", kind: "quizzes", name: "N", folder: { color: "bad", icon: "book" } }, now);
	const files = (await zip.readZip(packed.bytes)).files;
	const m = JSON.parse(dec.decode(files[0].bytes));
	r.check("packShareV1: the manifest is the FIRST entry", files.map(f => f.name), ["neo-quiz.json", "Dossier/a.md", "x.png"]);
	r.check("packShareV1: kind, app, a Z-time, the sanitised look (bad colour dropped)", [m.kind, m.app, m.created, m.folder], ["quizzes", "9.9.9", "2026-10-07T12:00:00Z", { icon: "book" }]);
	r.check("packShareV1: size and SHA-256 are those of the bytes that went in",
		m.files.map(f => [f.path, f.size, f.sha256]), [["Dossier/a.md", 5, await mf.sha256Hex(enc.encode("alpha"))], ["x.png", 10, await mf.sha256Hex(new Uint8Array(10).fill(7))]]);
	r.check("packShareV1: same input, same bytes (deterministic)", Buffer.from((await pack.packShareV1([note("Dossier/a.md", "alpha")], [img("x.png", 10)], { app: "9.9.9", kind: "quizzes", name: "N", folder: { color: "bad", icon: "book" } }, now)).bytes).equals(Buffer.from(packed.bytes)), true);

	// The budget includes the manifest: images that no longer fit are left out and the archive stays under the bound.
	const limit = 3000;
	const big = await pack.packShareV1([note("a.md", "alpha")], [img("1.png", 1200), img("2.png", 1200), img("3.png", 1200)], { app: "1", kind: "folder", name: "N" }, now, limit);
	r.check("packShareV1: the archive never exceeds the bound, manifest included; the rest is counted as left out", [big.bytes.length <= limit, big.imagesIn + big.imagesOut, big.imagesOut > 0], [true, 3, true]);
	const mBig = JSON.parse(dec.decode((await zip.readZip(big.bytes)).files[0].bytes));
	r.check("... and the manifest lists only what is in", mBig.files.length, 1 + big.imagesIn);
	r.check("notes alone over the bound: no archive", (await pack.packShareV1([note("a.md", "x".repeat(5000))], [], { app: "1", kind: "folder", name: "N" }, now, limit)).bytes, null);
	r.check("two images whose paths differ only by case: the second is left out", (await pack.packShareV1([note("a.md", "x")], [img("I.png", 5), img("i.PNG", 5)], { app: "1", kind: "folder", name: "N" }, now)).imagesOut, 1);
	r.done();
});

await withSrcModule("src/dashboard/zip.ts", async (zip) => {
	const { readZip, classerArchive, isJunkEntry, ZipReadError, IMPORT_LIMITS, CP437_HIGH } = zip;
	const { forgeZip, unicodePathExtra } = await import("./lib/zip-forge.mjs");
	const r = makeReporter("Archive reader hardening");
	const note = "```quiz-blocks\n[{prompt:'x'}]\n```\n";
	const refus = (p) => p.then(() => "read", (e) => e instanceof ZipReadError && e.code);
	const names = async (z) => (await readZip(z)).files.map(f => f.name);

	r.check("the code page 437 table has 128 characters", [...CP437_HIGH].length, 128);
	// "Cafe" with 0x82 = e acute in CP437, no UTF-8 flag (legacy Windows tools).
	const cp = forgeZip([{ nameBytes: Buffer.from([0x43, 0x61, 0x66, 0x82, 0x2e, 0x6d, 0x64]), bytes: note }]);
	r.check("no UTF-8 flag and not valid UTF-8: decoded as CP437 (Café.md, not mojibake)", await names(cp), ["Café.md"]);
	const cpFr = forgeZip([{ nameBytes: Buffer.from([0x82, 0x8a, 0x85, 0x87, 0x2e, 0x6d, 0x64]), bytes: note }]);
	r.check("French accents of CP437: é è à ç", await names(cpFr), ["éèàç.md"]);
	r.check("no flag but valid UTF-8 (many tools): read as UTF-8", await names(forgeZip([{ name: "Café.md", bytes: note }])), ["Café.md"]);
	r.check("the UTF-8 flag is honoured", await names(forgeZip([{ name: "Café.md", bytes: note, flags: 0x800 }])), ["Café.md"]);
	const rawLegacy = Buffer.from([0x43, 0x82]);
	r.check("the Unicode Path field wins when its checksum matches the stored name", await names(forgeZip([{ nameBytes: rawLegacy, extra: unicodePathExtra(rawLegacy, "Cœur.md"), localExtra: unicodePathExtra(rawLegacy, "Cœur.md"), bytes: note }])), ["Cœur.md"]);
	const badUp = unicodePathExtra(Buffer.from([0x41]), "Evil.md");
	r.check("a Unicode Path field for ANOTHER name is ignored", await names(forgeZip([{ nameBytes: rawLegacy, extra: badUp, bytes: note }])), ["Cé"]);

	// zip64.
	const z64 = forgeZip([{ name: "a.md", bytes: note, zip64: true }, { name: "b.md", bytes: note }], { zip64End: true });
	const z64r = await readZip(z64);
	r.check("a zip64 archive (end record, locator and extra fields) is READ", [z64r.files.map(f => f.name), z64r.skipped.length], [["a.md", "b.md"], 0]);
	const z64Broken = forgeZip([{ name: "a.md", bytes: note }]);
	new DataView(z64Broken.buffer).setUint32(z64Broken.length - 6, 0xffffffff, true); // central directory offset = "see zip64", no locator
	r.check("zip64 that cannot be read: its OWN error code, not \"damaged\"", await refus(readZip(z64Broken)), "zip64");
	const z64NoExtra = forgeZip([{ name: "a.md", bytes: note, extra: [], zip64: false, size: 0xffffffff }]);
	const nx = await readZip(z64NoExtra);
	r.check("an entry whose 32-bit size says \"see zip64\" with no field: listed as skipped, named", nx.skipped.map(x => `${x.name}:${x.reason}`), ["a.md:zip64"]);
	r.check("a split (multi-disk) archive: its own error code", await refus(readZip(forgeZip([{ name: "a.md", bytes: note }], { diskNumber: 1 }))), "multi-disk");

	// Overlap and name mismatch.
	const ov = forgeZip([{ name: "a.md", bytes: note }, { name: "b.md", bytes: note, noLocal: true, localOffsetOf: 0 }]);
	r.check("two entries sharing the same bytes: the archive is refused (overlap)", await refus(readZip(ov)), "overlap");
	const mism = await readZip(forgeZip([{ name: "a.md", localNameBytes: Buffer.from("b.md"), bytes: note }]));
	r.check("local and central names differ: the entry is skipped, named, with its reason", [mism.files.length, mism.skipped.map(x => `${x.name}:${x.reason}`)], [0, ["a.md:name-mismatch"]]);

	// System litter.
	const mac = await readZip(forgeZip([
		{ name: "Cours/CM1.md", bytes: note }, { name: "__MACOSX/Cours/._CM1.md", bytes: new Uint8Array([0, 5, 22, 7]) },
		{ name: "Cours/.DS_Store", bytes: new Uint8Array([0, 0, 0, 1]) }, { name: "Thumbs.db", bytes: new Uint8Array([1]) }, { name: "desktop.ini", bytes: "x" },
	]));
	r.check("macOS and Windows litter is filtered BEFORE reading and counted apart (never a junk note)", [mac.files.map(f => f.name), mac.junk, mac.skipped.length], [["Cours/CM1.md"], 4, 0]);
	r.check("isJunkEntry: only the litter", ["__MACOSX/x", "a/._b.md", ".DS_Store", "Thumbs.db", "THUMBS.DB", "a/desktop.ini"].map(isJunkEntry).concat(["a._b.md", "cours.md", "__MACOSXY/x.md"].map(isJunkEntry)), [true, true, true, true, true, true, false, false, false]);
	const clsMac = classerArchive([{ name: "__MACOSX/._CM1.md", bytes: new Uint8Array([0, 5]) }, { name: "CM1.md", bytes: new TextEncoder().encode(note) }]);
	r.check("classerArchive never turns an AppleDouble file into a note", [clsMac.notes.map(n => n.name), clsMac.junk, clsMac.ignored.length], [["CM1.md"], 1, 0]);

	// Links, ratio, hostile counts.
	const sl = await readZip(forgeZip([{ name: "link.md", bytes: "/etc/passwd", madeBy: (3 << 8) | 20, attrs: (0o120777 << 16) >>> 0 }, { name: "ok.md", bytes: note, madeBy: (3 << 8) | 20, attrs: (0o100644 << 16) >>> 0 }]));
	r.check("a symbolic link entry is skipped and named; a regular unix file is read", [sl.files.map(f => f.name), sl.skipped.map(x => `${x.name}:${x.reason}`)], [["ok.md"], ["link.md:symlink"]]);
	const zeros = new Uint8Array(8 * 1024 * 1024);
	const ratio = await readZip(forgeZip([{ name: "z.md", bytes: zeros }]));
	r.check("8 MB of zeros stored in a few KB: skipped for its ratio, named", ratio.skipped.map(x => `${x.name}:${x.reason}`), ["z.md:ratio"]);
	r.check("a long ordinary note is NOT mistaken for a bomb", (await readZip(forgeZip([{ name: "n.md", bytes: "word ".repeat(200000) }]))).files.length, 1);

	// Every refusal carries a name and a reason; nothing is silent.
	const mixed = await readZip(forgeZip([
		{ name: "ok.md", bytes: note }, { name: "enc.md", bytes: note, flags: 1 }, { name: "m.md", bytes: note, method: 8, crc: 1 },
		{ name: "big.md", bytes: "x", size: IMPORT_LIMITS.entry + 1 },
	]));
	r.check("the good entry is read and every other one is listed with its reason", [mixed.files.length, mixed.skipped.map(x => `${x.name}:${x.reason}`).sort()], [1, ["big.md:too-big", "enc.md:encrypted", "m.md:bad-crc"]]);
	const cl = classerArchive([{ name: "a.png", bytes: new Uint8Array([1]) }, { name: "dir/A.PNG", bytes: new Uint8Array([2]) }, { name: "dir2/a.png", bytes: new Uint8Array([1]) }, { name: "con.md", bytes: new Uint8Array([1]) }, { name: "x.pdf", bytes: new Uint8Array([1]) }]);
	r.check("classerArchive lists what it leaves out: a different image of the same name, a refused name, a type", [cl.images.length, cl.ignored.map(x => `${x.name}:${x.reason}`)], [1, ["dir/A.PNG:duplicate-image", "con.md:bad-name", "x.pdf:unsupported-type"]]);
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

/* ── METERED CONNECTION (2026-10-07, `connexion-limitee.ts`) ──
   The probe that decides whether updates and Moodle wait for a click. The
   script is a constant, the answer is cached, and ANY failure means "not
   metered" (never block updates for good on a machine where the probe cannot
   run). */
await withSrcModule("apps/windows/electron/connexion-limitee.ts", async ({ lireCout, creerSonde, SCRIPT_COUT, DUREE_CACHE_MS, executerPowerShell }) => {
	const r = makeReporter("Connexion limitée — lecture, cache, échec = non limitée");
	r.check("Unrestricted seul : non limitée", lireCout("Unrestricted False False False\r\n"), false);
	r.check("Fixed : limitée", lireCout("Fixed False False False"), true);
	r.check("Variable (case « connexion limitée » de Windows) : limitée", lireCout("Variable False False False"), true);
	r.check("Unrestricted mais en itinérance : limitée", lireCout("Unrestricted True False False"), true);
	r.check("Unrestricted mais forfait dépassé : limitée", lireCout("Unrestricted False True False"), true);
	r.check("Unrestricted mais forfait bientôt atteint : limitée", lireCout("Unrestricted False False True"), true);
	r.check("aucun profil : non limitée", lireCout("none"), false);
	r.check("sortie illisible, vide ou non texte : non limitée", [lireCout("blah"), lireCout(""), lireCout(null), lireCout(42), lireCout("Fixed")], [false, false, false, false, false]);
	r.check("le script est constant : pas de variable d'environnement, pas d'interpolation de valeur extérieure", /\$env:|\$\{/.test(SCRIPT_COUT), false);

	let t = 1000, appels = 0, sortie = "Fixed False False False";
	const sonde = creerSonde({ executer: async () => { appels++; return sortie; }, maintenant: () => t });
	const [a, b] = await Promise.all([sonde.limitee(), sonde.limitee()]);
	r.check("deux demandes simultanées partagent UN lancement", [a, b, appels], [true, true, 1]);
	await sonde.limitee();
	r.check("dans les cinq minutes : réponse en cache, aucun lancement", appels, 1);
	sortie = "Unrestricted False False False"; t += DUREE_CACHE_MS + 1;
	r.check("cache expiré : nouvelle mesure", [await sonde.limitee(), appels], [false, 2]);
	sortie = "Fixed False False False";
	sonde.invalider();
	r.check("invalider() (reprise de veille) force une nouvelle mesure", [await sonde.limitee(), appels], [true, 3]);
	const casse = creerSonde({ executer: async () => { throw new Error("boom"); } });
	r.check("exécuteur qui échoue : non limitée, sans rejet", await casse.limitee(), false);
	const nul = creerSonde({ executer: async () => null });
	r.check("exécuteur sans sortie (pas Windows, délai) : non limitée", await nul.limitee(), false);
	const forcee = creerSonde({ executer: async () => "Unrestricted False False False", forcer: () => true });
	r.check("forçage de développement honoré, sans cache", await forcee.limitee(), true);

	/* The REAL script on Windows: a line we can read (a machine with no
	   connection prints `none`, which is also accepted). */
	if (process.platform === "win32") {
		const brut = await executerPowerShell();
		r.check("vrai PowerShell : sortie lisible (coût réseau ou « none »)", /^(none|(Unrestricted|Fixed|Variable|Unknown) (True|False) (True|False) (True|False))\s*$/.test((brut ?? "").trim()), true);
	} else {
		r.check("hors Windows : aucun lancement, non limitée", await executerPowerShell(), null);
	}
	r.done();
});
