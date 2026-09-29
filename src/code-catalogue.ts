/* ══════════════════════════════════════════════════════════
   THE CATALOGUE OF CODE-BLOCK LANGUAGES, PURE (2026-09-28).

   Which languages a fenced block's tag RECOGNIZES: the name shown when the
   language logo of the block is hovered, the aliases an author writes
   (`js`, `py`, `c++`, `yml`…), the logo or icon, and the refractor grammar
   that colours it (engine/code-highlight.ts). Recognizing is not running:
   the few languages that run live in their own table (code-languages.ts),
   and this one never decides anything about execution.

   No DOM, no host: the badge is an `<img>` whose `src` is a `data:` URI
   built here, and the rendering grammar (engine/grammaire-blocs.ts) writes
   it into the block. `npm run check:code-catalogue`.
   ══════════════════════════════════════════════════════════ */
import { CODE_LOGOS } from "./code-logos";
import type { CodeLogoId } from "./code-logos";

/** A language with neither a Seti glyph nor an official logo is drawn with
    a Lucide icon instead (lucide 1.41.0: `file-code`). */
export type CodeLanguageIcon = "file-code";

export interface CodeCatalogueEntry {
	/** The canonical tag, lower case. */
	readonly id: string;
	/** Proper noun shown on hover: never translated. */
	readonly name: string;
	/** Other tags, lower case, that name the same language. */
	readonly aliases: readonly string[];
	/** Exactly one of `logo` and `icon`. */
	readonly logo?: CodeLogoId;
	readonly icon?: CodeLanguageIcon;
	/** The refractor grammar that colours the block (registered by
	    engine/code-highlight.ts), when there is one. */
	readonly grammar?: string;
}

export const CODE_CATALOGUE: readonly CodeCatalogueEntry[] = [
	// Web
	{ id: "html", name: "HTML", aliases: ["htm", "xhtml"], logo: "seti-html-3", grammar: "markup" },
	{ id: "css", name: "CSS", aliases: [], logo: "seti-css", grammar: "css" },
	{ id: "scss", name: "SCSS", aliases: [], logo: "seti-sass", grammar: "scss" },
	{ id: "sass", name: "Sass", aliases: [], logo: "seti-sass", grammar: "sass" },
	{ id: "less", name: "Less", aliases: [], logo: "seti-less", grammar: "less" },
	{ id: "javascript", name: "JavaScript", aliases: ["js", "mjs", "cjs", "node"], logo: "seti-javascript", grammar: "javascript" },
	{ id: "typescript", name: "TypeScript", aliases: ["ts", "mts", "cts"], logo: "seti-typescript", grammar: "typescript" },
	{ id: "jsx", name: "JSX", aliases: [], logo: "seti-react", grammar: "jsx" },
	{ id: "tsx", name: "TSX", aliases: [], logo: "seti-react", grammar: "tsx" },
	// No Vue grammar in refractor: a single-file component reads as HTML, its
	// `<script>` and `<style>` coloured by the grammars markup embeds.
	{ id: "vue", name: "Vue", aliases: [], logo: "seti-vue", grammar: "markup" },
	// Python and data
	{ id: "python", name: "Python", aliases: ["py", "python3", "py3"], logo: "seti-python", grammar: "python" },
	{ id: "r", name: "R", aliases: [], logo: "seti-r", grammar: "r" },
	{ id: "julia", name: "Julia", aliases: ["jl"], logo: "seti-julia", grammar: "julia" },
	{ id: "matlab", name: "MATLAB", aliases: [], logo: "matlab", grammar: "matlab" },
	// C and systems
	{ id: "c", name: "C", aliases: ["h"], logo: "seti-c", grammar: "c" },
	{ id: "cpp", name: "C++", aliases: ["c++", "cc", "cxx", "hpp", "hh", "hxx"], logo: "seti-cpp", grammar: "cpp" },
	{ id: "csharp", name: "C#", aliases: ["cs", "c#", "dotnet"], logo: "seti-c-sharp", grammar: "csharp" },
	// `m` is Objective-C (as in GitHub's linguist), not MATLAB.
	{ id: "objectivec", name: "Objective-C", aliases: ["objc", "objective-c", "m", "mm"], logo: "seti-c-2", grammar: "objectivec" },
	{ id: "rust", name: "Rust", aliases: ["rs"], logo: "seti-rust", grammar: "rust" },
	{ id: "zig", name: "Zig", aliases: [], logo: "seti-zig", grammar: "zig" },
	// JVM and mobile
	{ id: "java", name: "Java", aliases: [], logo: "seti-java", grammar: "java" },
	{ id: "kotlin", name: "Kotlin", aliases: ["kt", "kts"], logo: "seti-kotlin", grammar: "kotlin" },
	{ id: "scala", name: "Scala", aliases: ["sc"], logo: "seti-scala", grammar: "scala" },
	{ id: "groovy", name: "Groovy", aliases: ["gradle"], logo: "seti-grails", grammar: "groovy" },
	{ id: "swift", name: "Swift", aliases: [], logo: "seti-swift", grammar: "swift" },
	{ id: "dart", name: "Dart", aliases: [], logo: "seti-dart", grammar: "dart" },
	// Backend
	{ id: "php", name: "PHP", aliases: [], logo: "seti-php", grammar: "php" },
	{ id: "ruby", name: "Ruby", aliases: ["rb"], logo: "seti-ruby", grammar: "ruby" },
	{ id: "go", name: "Go", aliases: ["golang"], logo: "seti-go2", grammar: "go" },
	{ id: "elixir", name: "Elixir", aliases: ["ex", "exs"], logo: "seti-elixir", grammar: "elixir" },
	{ id: "erlang", name: "Erlang", aliases: ["erl"], logo: "erlang", grammar: "erlang" },
	{ id: "perl", name: "Perl", aliases: ["pl"], logo: "seti-perl", grammar: "perl" },
	// Shell. A zsh script or a terminal session reads mostly as bash.
	{ id: "bash", name: "Bash", aliases: [], logo: "seti-shell", grammar: "bash" },
	{ id: "shell", name: "Shell", aliases: ["sh", "zsh", "console", "shell-session"], logo: "seti-shell", grammar: "bash" },
	{ id: "powershell", name: "PowerShell", aliases: ["ps1", "pwsh", "ps"], logo: "seti-powershell", grammar: "powershell" },
	{ id: "batch", name: "Batch", aliases: ["bat", "cmd", "dos"], logo: "seti-windows", grammar: "batch" },
	// Databases. T-SQL and PL/pgSQL have no grammar of their own: plain SQL.
	{ id: "sql", name: "SQL", aliases: [], logo: "seti-db", grammar: "sql" },
	{ id: "mysql", name: "MySQL", aliases: ["mariadb"], logo: "mysql", grammar: "sql" },
	{ id: "postgresql", name: "PostgreSQL", aliases: ["postgres", "psql", "pgsql"], logo: "postgresql", grammar: "sql" },
	{ id: "plpgsql", name: "PL/pgSQL", aliases: [], logo: "seti-db", grammar: "sql" },
	{ id: "tsql", name: "T-SQL", aliases: ["t-sql", "mssql"], logo: "seti-db", grammar: "sql" },
	{ id: "sqlite", name: "SQLite", aliases: ["sqlite3"], logo: "sqlite", grammar: "sql" },
	// Embedded
	{ id: "arduino", name: "Arduino", aliases: ["ino"], logo: "arduino", grammar: "arduino" },
	// Functional
	{ id: "haskell", name: "Haskell", aliases: ["hs"], logo: "seti-haskell", grammar: "haskell" },
	{ id: "ocaml", name: "OCaml", aliases: ["ml"], logo: "seti-ocaml", grammar: "ocaml" },
	{ id: "fsharp", name: "F#", aliases: ["fs", "f#", "fsx"], logo: "seti-f-sharp", grammar: "fsharp" },
	{ id: "lisp", name: "Lisp", aliases: ["elisp", "emacs-lisp", "common-lisp"], icon: "file-code", grammar: "lisp" },
	{ id: "scheme", name: "Scheme", aliases: ["scm"], icon: "file-code", grammar: "scheme" },
	{ id: "clojure", name: "Clojure", aliases: ["clj", "cljs", "edn"], logo: "seti-clojure", grammar: "clojure" },
	// Scripts
	{ id: "lua", name: "Lua", aliases: [], logo: "seti-lua", grammar: "lua" },
	{ id: "vbnet", name: "Visual Basic", aliases: ["vb", "vb.net", "visualbasic", "visual-basic"], logo: "visualbasic", grammar: "vbnet" },
	{ id: "vba", name: "VBA", aliases: ["vbs", "vbscript"], icon: "file-code", grammar: "visual-basic" },
	{ id: "pascal", name: "Pascal", aliases: ["pas", "delphi", "objectpascal"], icon: "file-code", grammar: "pascal" },
	{ id: "fortran", name: "Fortran", aliases: ["f90", "f95", "f03"], logo: "fortran", grammar: "fortran" },
	// Data and configuration
	{ id: "json", name: "JSON", aliases: ["jsonc", "json5"], logo: "seti-json", grammar: "json" },
	{ id: "xml", name: "XML", aliases: ["svg", "xsd", "xsl", "xslt", "plist"], logo: "seti-xml", grammar: "markup" },
	{ id: "yaml", name: "YAML", aliases: ["yml"], logo: "seti-yml", grammar: "yaml" },
	{ id: "toml", name: "TOML", aliases: [], logo: "seti-config", grammar: "toml" },
	{ id: "ini", name: "INI", aliases: ["cfg", "properties"], logo: "seti-config", grammar: "ini" },
	// Documents
	{ id: "markdown", name: "Markdown", aliases: ["md"], logo: "seti-markdown", grammar: "markdown" },
	{ id: "latex", name: "LaTeX", aliases: ["tex"], logo: "seti-tex", grammar: "latex" },
	// DevOps
	{ id: "dockerfile", name: "Dockerfile", aliases: ["docker"], logo: "seti-docker", grammar: "docker" },
	{ id: "makefile", name: "Makefile", aliases: ["make", "mk"], logo: "seti-makefile", grammar: "makefile" },
	{ id: "cmake", name: "CMake", aliases: [], logo: "seti-makefile-3", grammar: "cmake" },
	{ id: "terraform", name: "Terraform", aliases: ["hcl", "tf"], logo: "seti-terraform", grammar: "hcl" },
	{ id: "graphql", name: "GraphQL", aliases: ["gql"], logo: "seti-graphql", grammar: "graphql" },
];

/* Every tag (id and alias) → its entry. A plain object read ONLY through
   `hasOwnProperty.call`: a tag of `constructor` or `__proto__` must never
   read the property of that name inherited from `Object.prototype` (same
   bug class as M1 of the 2026-09-26 review, code-highlight.ts).
   `hasOwnProperty.call` rather than `Object.hasOwn`: ES2022, outside this
   repo's ES2020 TS target. A duplicate tag keeps its FIRST entry;
   `check:code-catalogue` refuses one anyway. */
const BY_TAG: Record<string, CodeCatalogueEntry> = {};
for (const entry of CODE_CATALOGUE) {
	for (const tag of [entry.id, ...entry.aliases]) {
		if (!Object.prototype.hasOwnProperty.call(BY_TAG, tag)) BY_TAG[tag] = entry;
	}
}

/** The language a fenced block's tag names, or `null` when it is absent or
    unknown (the block then stays exactly as before the badge existed). */
export function codeLanguageOf(tag: unknown): CodeCatalogueEntry | null {
	const key = String(tag ?? "").trim().toLowerCase();
	return key && Object.prototype.hasOwnProperty.call(BY_TAG, key) ? BY_TAG[key] : null;
}

/* The Lucide icons, copied from lucide 1.41.0 (`dist/esm/icons/*.mjs`).
   An `<img>` does not inherit `currentColor`: the stroke is the muted
   foreground of the code block's fixed dark palette (quiz-card.css,
   `--qmc-fg` #c0caf5, dimmed). */
const ICON_BODIES: Readonly<Record<CodeLanguageIcon, string>> = {
	"file-code": '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/>',
};
const ICON_STROKE = "#9aa5ce";

function iconSvg(icon: CodeLanguageIcon): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${ICON_STROKE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_BODIES[icon]}</svg>`;
}

/** The `src` of the entry's badge: its logo, else its icon. Percent-encoded,
    not base64 (a third smaller); `encodeURIComponent` leaves no `"`, `<` or
    `&`, so the result is safe inside a quoted attribute as it is. Encoded
    once per entry: the largest logo is ~5 KB, drawn on every render. */
const BADGE_SRC = new Map<CodeCatalogueEntry, string>();
export function codeLanguageBadgeSrc(entry: CodeCatalogueEntry): string {
	let src = BADGE_SRC.get(entry);
	if (src === undefined) {
		const svg = entry.logo ? CODE_LOGOS[entry.logo] : iconSvg(entry.icon ?? "file-code");
		src = "data:image/svg+xml," + encodeURIComponent(svg);
		BADGE_SRC.set(entry, src);
	}
	return src;
}
