/* Does a failed Python run need more than the sandbox offers? Pure: reads the
   error text only. The strings are the real ones Pyodide produced in the
   sandbox (task 3 and 4 reports): a missing module, a native extension that
   cannot load, a blocked network call, micropip finding no pure wheel.
   Ordinary program errors (NameError, SyntaxError, assertion failures…) stay
   plain errors: running them elsewhere would not help. */

export const URL_EN_LIGNE = "https://colab.research.google.com/#create=true";

const MARQUEURS: RegExp[] = [
	/\bModuleNotFoundError\b/,
	/\bImportError\b[^\n]*(dynamic module|native|shared object|\.so\b|PyInit_)/i,
	/TLS not supported in this environment/,
	/\b(?:OSError|ConnectionError|URLError|TimeoutError)\b[^\n]*(?:network|connect|resolve|refused|unreachable|urlopen)/i,
	/\burllib\.error\.URLError\b/,
	/\bJsException\b[^\n]*(?:fetch|network|Failed to fetch)/i,
	/Failed to fetch/,
	/Can't find a pure Python 3 wheel/,
	/Can't fetch metadata for/,
];

export function besoinEnLigne(erreur: string): boolean {
	return MARQUEURS.some(re => re.test(erreur));
}
