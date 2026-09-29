/* ══════════════════════════════════════════════════════════
   A QUIZ'S SUBJECT — PURE module: no host, no DOM, no i18n

   Feedback #7 of 2026-09-26: the prompt adapts to the quiz's SUBJECT (a
   Python course does not call for the same questions as a networking
   course). The subject is DEDUCED from three clues, most reliable first:
   1. the names of the attachments ("CM1 - Introduction à Python.pdf");
   2. the path of the destination folder ("Efrei/Python/TD");
   3. the text of the request.
   A more reliable clue ALWAYS wins over the next ones: an "SQL" PDF filed
   in a "Python" folder is an SQL quiz. On a tie within the same clue,
   nothing is decided: `general`.

   2026-09-29: from eight subjects to about seventy (twenty-eight of them
   languages), and from one short regular expression per subject to a
   LEXICON — the notions of each course, from middle school to university.
   "nombres relatifs" was not maths for the eight-word list; a lexicon is
   what makes the detection worth trusting. The IDS are persisted with a
   queued request (file-generation-app.ts): add new ones freely, never
   rename one. Each subject's prompt addition lives apart
   (categorie-prompt.ts); its label, icon and menu place on the page side
   (categorie-affichage.ts). `npm run check:categorie` holds this module.
══════════════════════════════════════════════════════════ */

/* The LANGUAGES: the twenty most spoken, plus the ones a French learner
   meets most (Italian, Korean, Persian…). Their French names, adjective
   forms included ("grammaire italienne"), then English and native names:
   the detection reads all of them. */
const LANGUES = {
	anglais: ["anglais", "anglaise", "english"],
	chinois: ["chinois", "chinoise", "mandarin", "chinese", "zhongwen"],
	hindi: ["hindi"],
	espagnol: ["espagnol", "espagnole", "spanish", "espanol", "castillan"],
	francais: ["francais", "francaise", "french", "fle"],
	arabe: ["arabe", "arabic", "arabiya"],
	bengali: ["bengali", "bangla"],
	portugais: ["portugais", "portugaise", "portuguese", "portugues"],
	russe: ["russe", "russian", "russkiy"],
	ourdou: ["ourdou", "urdu"],
	indonesien: ["indonesien", "indonesienne", "indonesian", "bahasa indonesia"],
	allemand: ["allemand", "allemande", "german", "deutsch"],
	japonais: ["japonais", "japonaise", "japanese", "nihongo"],
	marathi: ["marathi"],
	telougou: ["telougou", "telugu"],
	turc: ["turc", "turque", "turkish", "turkce"],
	tamoul: ["tamoul", "tamoule", "tamil"],
	cantonais: ["cantonais", "cantonaise", "cantonese"],
	vietnamien: ["vietnamien", "vietnamienne", "vietnamese"],
	coreen: ["coreen", "coreenne", "korean", "hangeul", "hangul"],
	italien: ["italien", "italienne", "italian", "italiano"],
	persan: ["persan", "persane", "farsi", "persian"],
	polonais: ["polonais", "polonaise", "polish", "polski"],
	neerlandais: ["neerlandais", "neerlandaise", "dutch", "nederlands", "flamand"],
	swahili: ["swahili", "kiswahili"],
	thai: ["thai", "thaie", "thailandais"],
	grec: ["grec moderne", "greek", "neogrec"],
	hebreu: ["hebreu", "hebraique", "hebrew", "ivrit"],
	suedois: ["suedois", "suedoise", "swedish", "svenska"],
	ukrainien: ["ukrainien", "ukrainienne", "ukrainian"],
} as const;
export type LangueQuiz = keyof typeof LANGUES;
/** The language subjects, in menu order (most spoken first, then "any
    other language"). */
export const LANGUES_IDS = [...Object.keys(LANGUES) as LangueQuiz[], "langues"] as const;

export const CATEGORIES = [
	"general",
	// Programming
	"python", "c", "cpp", "java", "csharp", "web", "rust", "go", "algo", "genie", "git",
	// Computing & systems
	"bash", "sql", "reseau", "secu", "os", "archi", "cloud", "ia",
	// Sciences
	"maths", "physique", "chimie", "bio", "medecine", "electronique",
	// Humanities & society
	"histoire", "geo", "philo", "litterature", "eco", "gestion", "droit", "psycho",
	// Languages
	...LANGUES_IDS,
	// Other
	"musique", "arts", "conduite",
] as const;
export type CategorieQuiz = typeof CATEGORIES[number];
type Specifique = Exclude<CategorieQuiz, "general">;

export function estCategorie(v: unknown): v is CategorieQuiz {
	return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

export function estLangue(c: CategorieQuiz): boolean {
	return (LANGUES_IDS as readonly string[]).includes(c);
}

export interface IndicesCategorie {
	/** The names of the attachments (files, notes, videos). */
	pieces?: readonly string[];
	/** The path of the destination folder. */
	dossier?: string;
	/** The text of the request. */
	demande?: string;
}

/* ── The lexicon ──
   Terms are written lowercase and WITHOUT accents (the text is normalized
   the same way). A space matches any run of spaces or a hyphen, a hyphen
   is optional, an apostrophe matches ' ’ or nothing, and a final letter
   accepts a plural (s, x, es). Whole words only: "python" but not
   "pythonesque". Everyday words that a request about something else would
   contain ("processus", "forces", "contrats", "virus", "base") are left
   out on purpose: a false subject is worse than `general`, which the user
   can still override in the options. */
const TERMES: Readonly<Record<Exclude<Specifique, LangueQuiz | "langues">, readonly string[]>> = {
	python: ["python", "python2", "python3", "py", "pandas", "numpy", "scipy", "django", "flask", "fastapi", "pip", "jupyter", "matplotlib", "seaborn", "tkinter", "pyqt", "pytest", "virtualenv", "venv", "conda", "anaconda", "list comprehension", "liste en comprehension", "listes en comprehension", "f-string"],
	c: ["langage c", "programmation c", "en c", "gcc", "malloc", "calloc", "printf", "scanf", "pointeur", "arithmetique des pointeurs", "stdio.h", "stdlib.h"],
	cpp: ["c++", "cpp", "iostream", "stl", "std::vector", "std::string", "std::cout", "programmation c++"],
	java: ["java", "jvm", "jdk", "jre", "spring boot", "maven", "gradle", "junit", "javafx", "hibernate", "jakarta ee", "java ee"],
	csharp: ["c#", "csharp", "c sharp", "dotnet", ".net", "asp.net", "linq", "xamarin", "blazor", "entity framework"],
	web: ["html", "html5", "css", "css3", "sass", "scss", "tailwind", "bootstrap", "javascript", "typescript", "js", "jquery", "reactjs", "react.js", "react native", "vuejs", "vue.js", "angular", "svelte", "next.js", "nextjs", "nodejs", "node.js", "expressjs", "express.js", "php", "laravel", "symfony", "wordpress", "web", "front-end", "back-end", "frontend", "backend", "site web", "website", "api rest", "rest api", "flexbox", "responsive design", "manipulation du dom", "arbre dom", "dom tree", "ajax"],
	rust: ["rust", "rustlang", "rustc", "cargo.toml", "borrow checker"],
	go: ["golang", "langage go", "en go", "goroutine"],
	algo: ["algorithme", "algorithmique", "algorithm", "algo", "algos", "structure de donnees", "structures de donnees", "data structure", "complexite algorithmique", "complexite temporelle", "time complexity", "big o", "tri rapide", "tri fusion", "tri a bulles", "tri par insertion", "tri par selection", "quicksort", "merge sort", "sorting algorithm", "arbre binaire", "arbres binaires", "binary tree", "arbre binaire de recherche", "dijkstra", "recursivite", "recursion", "programmation dynamique", "dynamic programming", "pseudo-code", "pseudocode", "recherche dichotomique", "binary search", "liste chainee", "listes chainees", "linked list", "table de hachage", "tables de hachage", "hash table", "parcours en largeur", "parcours en profondeur", "bfs", "dfs", "backtracking", "algorithme glouton", "greedy algorithm", "diviser pour regner", "divide and conquer", "piles et files", "stacks and queues"],
	genie: ["genie logiciel", "software engineering", "uml", "design pattern", "patron de conception", "patrons de conception", "poo", "oop", "programmation orientee objet", "object-oriented", "object oriented programming", "scrum", "methode agile", "methodes agiles", "agile methods", "kanban", "test unitaire", "tests unitaires", "unit test", "tdd", "architecture logicielle", "software architecture", "diagramme de classes", "class diagram", "diagramme de sequence", "sequence diagram", "cas d'utilisation", "use case", "mvc", "clean code", "refactoring", "cycle en v", "user stories", "cahier des charges", "principes solid", "solid principles", "encapsulation", "polymorphisme", "polymorphism"],
	git: ["git", "github", "gitlab", "rebase", "pull request", "controle de version", "version control", "gestion de versions", "git flow", "gitflow", "merge conflict", "conflits de fusion", "svn", "subversion"],
	bash: ["bash", "shell", "linux", "unix", "ubuntu", "debian", "fedora", "centos", "red hat", "rhel", "arch linux", "terminal", "ligne de commande", "command line", "grep", "chmod", "chown", "awk", "sed", "zsh", "powershell", "systemd", "crontab", "cron", "ssh", "sudo", "vim", "script shell", "scripts shell", "shell script", "scripting", "administration systeme", "administration systemes", "system administration", "sysadmin", "permissions linux"],
	sql: ["sql", "mysql", "mariadb", "postgres", "postgresql", "sqlite", "oracle", "nosql", "mongodb", "base de donnees", "bases de donnees", "database", "jointure", "requete sql", "requetes sql", "modele relationnel", "relational model", "schema relationnel", "algebre relationnelle", "cle primaire", "cle etrangere", "primary key", "foreign key", "forme normale", "formes normales", "normal form", "merise", "mcd", "mld", "inner join", "left join", "group by"],
	reseau: ["reseau", "reseaux", "network", "networking", "tcp", "udp", "ip", "ipv4", "ipv6", "tcp/ip", "osi", "modele osi", "cisco", "routeur", "routage", "commutateur", "vlan", "dns", "dhcp", "sous-reseau", "subnet", "subnetting", "masque de sous-reseau", "subnet mask", "cidr", "nat", "vpn", "ethernet", "wifi", "adressage", "adresse ip", "adresses ip", "adresse mac", "mac address", "arp", "icmp", "ping", "traceroute", "bgp", "ospf", "lan", "wan", "wlan", "fibreoptique", "packet tracer"],
	secu: ["cybersecurite", "cyber securite", "cybersecurity", "securite informatique", "securite des systemes d'information", "infosec", "hacking", "ethical hacking", "pentest", "pentesting", "test d'intrusion", "tests d'intrusion", "penetration testing", "cryptographie", "cryptography", "chiffrement", "encryption", "xss", "sqli", "csrf", "owasp", "malware", "ransomware", "rancongiciel", "phishing", "hameconnage", "firewall", "pare-feu", "vulnerabilite", "metasploit", "nmap", "burp", "wireshark", "kali", "ctf", "capture the flag", "ingenierie sociale", "social engineering", "buffer overflow", "debordement de tampon", "ddos", "cve", "iso 27001", "siem", "forensique", "forensics", "osint", "authentification", "authentication", "hachage de mots de passe", "password hashing", "virus informatique", "antivirus"],
	os: ["systeme d'exploitation", "systemes d'exploitation", "operating system", "ordonnancement", "cpu scheduling", "round robin", "fcfs", "sjf", "semaphore", "mutex", "interblocage", "deadlock", "memoire virtuelle", "virtual memory", "pagination", "paging", "kernel", "pthread", "pthreads", "multithreading", "gestion de la memoire", "gestion memoire", "memory management", "systeme de fichiers", "file system", "appel systeme", "appels systeme", "system call", "fork", "processus et threads"],
	archi: ["architecture des ordinateurs", "computer architecture", "assembleur", "assembly", "asm", "x86", "mips", "risc-v", "processeur", "microprocesseur", "cpu", "registres du processeur", "memoire cache", "portes logiques", "logic gates", "logique combinatoire", "logique sequentielle", "von neumann", "architecture von neumann", "alu", "ual", "jeu d'instructions", "instruction set", "bus de donnees", "complement a deux", "two's complement", "virgule flottante", "floating point", "ieee 754", "hexadecimal", "base 2", "base 16", "conversion binaire"],
	cloud: ["cloud", "cloud computing", "aws", "azure", "gcp", "docker", "dockerfile", "docker compose", "kubernetes", "k8s", "helm", "devops", "ci/cd", "integration continue", "continuous integration", "jenkins", "ghactions", "gitlabci", "terraform", "ansible", "microservice", "serverless", "iaas", "paas", "saas", "virtualisation", "virtualization", "vmware", "hyperviseur", "hypervisor", "openstack", "infrastructure as code", "iac", "conteneurisation", "containerization"],
	ia: ["ia", "intelligence artificielle", "artificial intelligence", "machine learning", "apprentissage automatique", "deep learning", "apprentissage profond", "neuralnet", "neural network", "llm", "nlp", "traitement du langage naturel", "natural language processing", "data science", "science des donnees", "big data", "data mining", "exploration de donnees", "analyse de donnees", "data analysis", "regression lineaire", "regression logistique", "linear regression", "logistic regression", "scikit-learn", "sklearn", "tensorflow", "pytorch", "keras", "apprentissage supervise", "supervised learning", "apprentissage non supervise", "unsupervised learning", "apprentissage par renforcement", "reinforcement learning", "arbre de decision", "decision tree", "random forest", "k-means", "kmeans", "knn", "svm", "descente de gradient", "gradient descent", "surapprentissage", "overfitting", "vision par ordinateur", "computer vision", "prompt engineering", "chatgpt", "ia generative", "generative ai"],
	maths: ["math", "maths", "mathematique", "mathematiques", "mathematics", "algebre", "algebra", "arithmetique", "arithmetic", "geometrie", "geometry", "trigonometrie", "trigonometry", "trigo", "probabilite", "probabilites", "probability", "probabilities", "statistique", "statistiques", "statistics", "equation", "inequation", "inequality", "inegalite", "derivee", "derivative", "derivation", "primitive", "integrale", "integral", "calcul integral", "calcul differentiel", "matrice", "matrix", "matrices", "polynome", "polynomial", "second degre", "premier degre", "suite numerique", "suites numeriques", "suite arithmetique", "suites arithmetiques", "suite geometrique", "suites geometriques", "analyse reelle", "calculus", "nombre relatif", "nombres relatifs", "entiers relatifs", "nombre decimal", "nombres decimaux", "nombres rationnels", "nombres reels", "nombre complexe", "nombres complexes", "complex number", "nombre premier", "nombres premiers", "prime number", "fraction", "pourcentage", "percentage", "proportionnalite", "proportionality", "pgcd", "ppcm", "gcd", "lcm", "divisibilite", "diviseur", "puissances de 10", "racine carree", "racines carrees", "square root", "identites remarquables", "calcul litteral", "factorisation", "developper et factoriser", "theoreme", "theorem", "pythagore", "pythagoras", "thales", "vecteur", "vector", "droites paralleles", "perpendiculaire", "triangle", "cercle", "aire", "perimetre", "perimeter", "fonction affine", "fonction lineaire", "fonctions affines", "fonctions lineaires", "fonction exponentielle", "exponentielle", "exponential function", "logarithme", "logarithm", "limites de fonctions", "limite d'une fonction", "continuite", "denombrement", "combinatoire", "combinatorics", "binomedenewton", "loi normale", "loi binomiale", "esperance", "variance", "ecart-type", "standard deviation", "mediane", "espace vectoriel", "espaces vectoriels", "vector space", "valeurs propres", "eigenvalue", "determinant d'une matrice", "nombre derive", "tangente", "cosinus", "sinus", "cosine", "homothetie", "symetrie axiale", "symetrie centrale", "tableau de variations", "calcul mental", "raisonnement par recurrence", "demonstration par recurrence", "equations differentielles", "differential equation"],
	physique: ["physique", "physics", "mecanique", "mechanics", "thermodynamique", "thermodynamics", "electromagnetisme", "electromagnetism", "magnetisme", "magnetism", "optique", "optics", "lentille", "cinematique", "kinematics", "newton", "lois de newton", "newton's laws", "energie cinetique", "energie potentielle", "energie mecanique", "kinetic energy", "potential energy", "quantique", "quantum", "physique quantique", "relativite", "relativity", "gravitation", "gravite", "gravity", "loi d'ohm", "ohm's law", "tension electrique", "intensite electrique", "courant electrique", "electric current", "vitesse de la lumiere", "acceleration", "quantite de mouvement", "momentum", "frottement", "friction", "longueur d'onde", "wavelength", "ondes sonores", "ondes electromagnetiques", "refraction", "diffraction", "radioactivite", "radioactivity", "physique nucleaire", "nuclear physics", "fission", "chute libre", "free fall", "pendule", "pendulum", "oscillation", "travail d'une force", "puissance electrique", "electrostatique", "electrostatics", "champ electrique", "champ magnetique", "electric field", "magnetic field", "gravitation universelle", "mouvement rectiligne", "mouvement circulaire", "referentiel", "masse volumique", "poussee d'archimede", "archimede", "systeme solaire", "solar system", "planete", "planet", "astronomie", "astronomy", "astrophysique", "astrophysics", "galaxie", "galaxy", "trou noir", "black hole"],
	chimie: ["chimie", "chemistry", "chimique", "chemical", "molecule", "reaction chimique", "reactions chimiques", "chemical reaction", "tableau periodique", "periodic table", "classification periodique", "stoechiometrie", "stoichiometry", "oxydo-reduction", "oxydoreduction", "redox", "oxydation", "liaison covalente", "liaisons covalentes", "liaison ionique", "covalent bond", "ionic bond", "chimie organique", "organic chemistry", "acide", "acid", "acido-basique", "pka", "concentration molaire", "molarite", "molarity", "quantite de matiere", "mole", "masse molaire", "molar mass", "ion", "isotope", "alcane", "alcene", "hydrocarbure", "polymere", "polymer", "catalyseur", "catalyst", "dosage", "titrage", "titration", "solution aqueuse", "solvant", "equilibre chimique", "chemical equilibrium", "cinetique chimique", "electrolyse", "electrolysis", "formule brute", "formule developpee", "ester", "aldehyde", "cetone"],
	bio: ["biologie", "biology", "svt", "sciences de la vie", "sciences de la vie et de la terre", "cellule", "cell biology", "biologie cellulaire", "genetique", "genetics", "gene", "adn", "dna", "arn", "rna", "proteine", "protein", "enzyme", "photosynthese", "photosynthesis", "ecologie", "ecology", "metabolisme", "metabolism", "mitose", "meiose", "mitosis", "meiosis", "geologie", "geology", "tectonique", "plaques tectoniques", "volcan", "volcano", "seisme", "earthquake", "chromosome", "mutation", "heredite", "heredity", "evolution des especes", "selection naturelle", "natural selection", "darwin", "digestion", "systeme digestif", "respiration cellulaire", "cellular respiration", "systeme immunitaire", "immune system", "anticorps", "antibody", "bacterie", "bacteria", "microbiologie", "microbiology", "systeme nerveux", "nervous system", "hormone", "fecondation", "embryon", "vegetaux", "biodiversite", "biodiversity", "chaine alimentaire", "food chain", "zoologie", "botanique", "botany", "cycle de l'eau", "water cycle", "corps humain", "human body", "squelette", "skeleton", "dinosaure", "dinosaur", "paleontologie", "paleontology", "organes des sens"],
	medecine: ["medecine", "medicine", "medical", "medicale", "anatomie", "anatomy", "physiologie", "physiology", "pharmacologie", "pharmacology", "pathologie", "semiologie", "infirmier", "infirmiere", "nursing", "soins infirmiers", "paces", "maladie", "disease", "symptome", "symptom", "cardiologie", "cardiology", "neurologie", "neurology", "pediatrie", "pediatrics", "chirurgie", "surgery", "premiers secours", "first aid", "systeme cardiovasculaire", "cardiovascular", "medicament", "posologie", "epidemiologie", "epidemiology", "histologie", "histology", "sante publique", "public health", "radiologie", "ecg", "ecn", "edn"],
	electronique: ["electronique", "electronics", "electronic", "circuit electrique", "circuits electriques", "circuit electronique", "circuits electroniques", "electric circuit", "transistor", "diode", "condensateur", "capacitor", "resistor", "resistance electrique", "arduino", "raspberry pi", "microcontroleur", "microcontroller", "fpga", "vhdl", "verilog", "amplificateur operationnel", "amplificateurs operationnels", "ampli op", "op-amp", "traitement du signal", "signal processing", "electronique numerique", "digital electronics", "bascule", "flip-flop", "oscilloscope", "multimetre", "multimeter", "lois de kirchhoff", "kirchhoff", "pont diviseur", "filtre passe-bas", "filtre passe-haut", "low-pass filter", "electrotechnique"],
	histoire: ["histoire", "history", "guerre mondiale", "premiere guerre mondiale", "seconde guerre mondiale", "world war", "ww1", "ww2", "revolution francaise", "french revolution", "revolution industrielle", "industrial revolution", "moyen age", "middle ages", "antiquite", "antiquity", "renaissance", "empire romain", "roman empire", "guerre froide", "cold war", "napoleon", "colonisation", "decolonisation", "shoah", "holocauste", "holocaust", "nazisme", "nazism", "fascisme", "totalitarisme", "monarchie absolue", "louis xiv", "ancien regime", "siecle des lumieres", "egypte ancienne", "grece antique", "ancient greece", "rome antique", "croisades", "crusades", "feodalite", "feudalism", "guerre de cent ans", "cinquieme republique", "ve republique", "vichy", "de gaulle", "mai 68", "guerre d'algerie", "traite negriere", "esclavage", "slavery", "guerre de secession", "american revolution", "union sovietique", "urss", "ussr", "mur de berlin", "berlin wall", "prehistoire", "prehistory", "neolithique", "paleolithique", "epoque moderne", "epoque contemporaine"],
	geo: ["geographie", "geography", "capitale", "capitals", "continent", "climat", "climate", "fleuve", "cartographie", "geopolitique", "geopolitics", "pays du monde", "countries of the world", "drapeaux du monde", "flags of the world", "population mondiale", "urbanisation", "mondialisation", "globalization", "globalisation", "amenagement du territoire", "departements francais", "regions francaises", "ocean", "latitude", "longitude", "hemisphere", "fuseaux horaires", "time zones", "demographie", "demography"],
	philo: ["philosophie", "philosophy", "philo", "philosophe", "kant", "descartes", "platon", "plato", "aristote", "aristotle", "nietzsche", "spinoza", "hegel", "sartre", "socrate", "socrates", "montesquieu", "locke", "hobbes", "hume", "heidegger", "wittgenstein", "simone de beauvoir", "epistemologie", "epistemology", "ethique", "ethics", "metaphysique", "metaphysics", "existentialisme", "existentialism", "stoicisme", "stoicism", "epicurisme", "utilitarisme", "utilitarianism", "allegorie de la caverne", "cogito", "imperatif categorique", "contrat social", "social contract", "dissertation de philosophie"],
	litterature: ["litterature", "literature", "litteraire", "novel", "poesie", "poetry", "poeme", "poem", "theatre", "moliere", "victor hugo", "shakespeare", "balzac", "zola", "baudelaire", "flaubert", "corneille", "voltaire", "camus", "proust", "maupassant", "rimbaud", "verlaine", "apollinaire", "stendhal", "la fontaine", "dickens", "orwell", "austen", "figure de style", "figures de style", "figures of speech", "metaphore", "metaphor", "oxymore", "personnification", "antithese", "commentaire compose", "commentaire de texte", "explication de texte", "analyse litteraire", "genre litteraire", "genres litteraires", "mouvement litteraire", "romantisme", "naturalisme", "symbolisme", "classicisme", "humanisme", "tragedie", "comedie", "alexandrin", "sonnet", "fable", "narrateur", "narrator"],
	eco: ["economie", "economics", "economy", "macroeconomie", "microeconomie", "macroeconomics", "microeconomics", "inflation", "deflation", "recession", "pib", "gdp", "offre et demande", "offre et la demande", "supply and demand", "chomage", "unemployment", "croissance economique", "economic growth", "keynes", "keynesianisme", "monetarisme", "adam smith", "politique monetaire", "monetary policy", "politique budgetaire", "fiscal policy", "taux d'interet", "interest rate", "banque centrale", "central bank", "marche du travail", "labor market", "commerce international", "international trade", "balance commerciale", "elasticite", "elasticity", "cout marginal", "marginal cost", "utilite marginale", "concurrence parfaite", "perfect competition", "monopole", "monopoly", "oligopole", "externalite", "externality", "sciences economiques", "economie politique", "marches financiers", "financial markets", "bourse", "stock market", "actions et obligations"],
	gestion: ["gestion", "management", "marketing", "comptabilite", "accounting", "finance", "finances", "entrepreneuriat", "entrepreneurship", "business", "strategie d'entreprise", "business strategy", "ressources humaines", "human resources", "rh", "grh", "bilan comptable", "balance sheet", "compte de resultat", "income statement", "controle de gestion", "tresorerie", "cash flow", "seuil de rentabilite", "break-even", "marge brute", "fonds de roulement", "working capital", "supply chain", "logistique", "swot", "pestel", "business plan", "marketing mix", "mix marketing", "etude de marche", "market research", "gestion de projet", "project management", "kpi", "leadership", "e-commerce"],
	droit: ["droit civil", "droit penal", "droit constitutionnel", "droit administratif", "droit des contrats", "droit du travail", "droit des affaires", "droit international", "droit europeen", "droit des obligations", "droit fiscal", "droit commercial", "droit public", "droit prive", "juridique", "jurisprudence", "code civil", "code penal", "code du travail", "constitution", "tribunal", "cour de cassation", "conseil d'etat", "conseil constitutionnel", "responsabilite civile", "responsabilite contractuelle", "responsabilite delictuelle", "rgpd", "gdpr", "contract law", "criminal law", "civil law", "constitutional law", "business law", "propriete intellectuelle", "intellectual property", "droit d'auteur", "copyright", "droits de l'homme", "human rights", "procedure civile", "procedure penale", "infraction", "contravention"],
	psycho: ["psychologie", "psychology", "psycho", "cognitif", "cognitive", "cognition", "freud", "piaget", "conditionnement", "conditioning", "neuropsychologie", "psychanalyse", "psychoanalysis", "psychiatrie", "psychiatry", "biais cognitif", "cognitive bias", "psychologie sociale", "social psychology", "developpement de l'enfant", "child development", "memoire de travail", "working memory", "theorie de l'attachement", "attachment theory", "maslow", "skinner", "pavlov", "behaviorisme", "behaviorism", "psychotherapie", "intelligence emotionnelle", "emotional intelligence"],
	musique: ["musique", "music", "solfege", "music theory", "theorie musicale", "harmonie", "gamme majeure", "gamme mineure", "gammes majeures", "gammes mineures", "sheet music", "compositeur", "composer", "mozart", "beethoven", "bach", "chopin", "vivaldi", "debussy", "notes de musique", "musical notes", "cle de sol", "treble clef", "tempo", "piano", "guitare", "guitar", "violon", "violin", "jazz", "musique classique", "classical music", "opera", "symphonie", "symphony", "tonalite", "accords de guitare", "guitar chords"],
	arts: ["histoire de l'art", "histoire des arts", "art history", "arts plastiques", "peinture", "painting", "peintre", "painter", "sculpture", "impressionnisme", "impressionism", "expressionnisme", "cubisme", "cubism", "fauvisme", "surrealisme", "surrealism", "pop art", "art contemporain", "contemporary art", "art moderne", "modern art", "street art", "photographie", "photography", "baroque", "rococo", "art roman", "architecture gothique", "mouvement artistique", "art movement", "oeuvre d'art", "oeuvres d'art", "artwork", "musee", "museum", "picasso", "monet", "van gogh", "vinci", "michel-ange", "michelangelo", "rembrandt", "vermeer", "caravage", "matisse", "warhol", "dali", "magritte", "frida kahlo", "renoir", "cezanne", "degas", "manet", "joconde", "mona lisa", "louvre"],
	conduite: ["code de la route", "permis de conduire", "permis b", "driving test", "driving licence", "driving license", "highway code", "signalisation routiere", "road signs", "panneaux de signalisation", "priorite a droite", "securite routiere", "road safety", "auto-ecole", "driving school", "examen du code", "limitation de vitesse", "limites de vitesse", "speed limit", "rond-point", "roundabout", "feux tricolores", "traffic light", "distance de freinage", "braking distance", "distance d'arret", "stopping distance", "ceinture de securite", "seat belt", "alcoolemie", "sens interdit"],
};

/* File extensions, read on a NAME only. */
const EXTENSIONS: Readonly<Partial<Record<Specifique, readonly string[]>>> = {
	python: ["py", "ipynb"], c: ["c", "h"], cpp: ["cpp", "hpp", "cc"], java: ["java"], csharp: ["cs"],
	rust: ["rs"], go: ["go"], bash: ["sh"], sql: ["sql"], web: ["html", "css", "js", "ts", "jsx", "tsx", "php"],
};

/* A document format that is also a web file (see `detecterCategorie`). */
const EXTENSION_DOCUMENT = /\.html?$/i;

/* Words that only count in a NAME (file, folder), never in a sentence. The
   letter C alone: "Programmation C.pdf", "TP C" — but "c'est" in a
   sentence is not the language. A language NAME in a sentence usually
   says what language to WRITE the quiz in ("un quiz en anglais sur la
   Révolution"), so there it needs a study word (`ETUDE_LANGUE`); in a
   file or folder name the bare name is the subject ("Anglais S3.pdf"). */
const TERMES_NOM: Readonly<Partial<Record<Specifique, readonly string[]>>> = {
	ia: ["ai"],
	droit: ["droit"],
	conduite: ["permis"],
	...Object.fromEntries(Object.entries(LANGUES).map(([id, noms]) => [id, noms])),
};
const MOT_C_NOM = /(^|[^a-z0-9'’])c(?![a-z0-9'’#+])/;

/* What turns a language name in a SENTENCE into the subject: "vocabulaire
   arabe", "apprendre le japonais", "italian grammar", "cours d'italien". */
const ETUDE_LANGUE_AVANT = "(?:(?:vocabulaire|grammaire|conjugaison|alphabet|ecriture|prononciation|expressions?|verbes?|phrases?|mots|langue|vocab|learn|learning|study|traduction en|traduire en)[\\s-]+"
	+ "|(?:cours|lecons?|bases) d['’]\\s?|(?:cours|lecons?|bases) de[\\s-]+"
	+ "|apprendre[\\s-]+(?:l[ae][\\s-]+|l['’]\\s?|les[\\s-]+)?)";
const ETUDE_LANGUE_APRES = "[\\s-]+(?:vocabulary|grammar|verbs?|words|alphabet|tenses|lessons?|for beginners|course|debutants?|pour debutants|niveau [abc][12]|[abc][12]|intermediaire|avance)";
/* Study words that name ONE language on their own. */
const TERMES_LANGUE_SEULS: Readonly<Partial<Record<LangueQuiz | "langues", readonly string[]>>> = {
	anglais: ["toeic", "toefl", "ielts", "cambridge english", "phrasal verbs", "irregular verbs", "verbes irreguliers anglais", "present perfect", "preterit", "past simple", "present continuous", "modal verbs"],
	francais: ["grammaire francaise", "orthographe", "conjugaison francaise", "accord du participe", "accords du participe", "participe passe", "brevet de francais", "bac de francais", "bac francais", "dictee", "subjonctif", "passe simple", "homophones", "delf", "dalf"],
	espagnol: ["ser et estar", "ser and estar", "ser vs estar", "dele"],
	allemand: ["akkusativ", "dativ", "declinaisons allemandes", "goethe-zertifikat"],
	japonais: ["hiragana", "katakana", "kanji", "jlpt"],
	chinois: ["hanzi", "pinyin", "hsk"],
	coreen: ["topik"],
	russe: ["cyrillique", "cyrillic"],
	arabe: ["alphabet arabe", "arabic alphabet"],
};

/** A term, as a regular-expression source (see `TERMES`). */
function motif(terme: string): string {
	let source = "";
	for (const ch of terme) {
		if (ch === " ") source += "[\\s-]+";
		else if (ch === "-") source += "[\\s-]?";
		else if (ch === "'") source += "['’\\s]?";
		else source += ch.replace(/[.*+?^${}()|[\]\\/#]/g, "\\$&");
	}
	return /[a-z]$/.test(terme) ? source + "(?:s|x|es)?" : source;
}

function compiler(termes: readonly string[], avant = "", apres = ""): RegExp {
	return new RegExp(`(?<![a-z0-9])${avant}(?:${termes.map(motif).join("|")})${apres}(?![a-z0-9])`);
}

const RE_TEXTE: ReadonlyMap<Specifique, RegExp> = new Map((() => {
	const r: [Specifique, RegExp][] = [];
	for (const [cat, termes] of Object.entries(TERMES) as [Specifique, readonly string[]][]) r.push([cat, compiler(termes)]);
	for (const id of Object.keys(LANGUES) as LangueQuiz[]) {
		const noms = LANGUES[id];
		const seuls = TERMES_LANGUE_SEULS[id] ?? [];
		/* The name with a study word before or after it, or a word that
		   names this language alone. */
		const sources = [compiler(noms, ETUDE_LANGUE_AVANT).source, compiler(noms, "", ETUDE_LANGUE_APRES).source];
		if (seuls.length) sources.push(compiler(seuls).source);
		r.push([id, new RegExp(sources.join("|"))]);
	}
	return r;
})());
const RE_NOM: ReadonlyMap<Specifique, RegExp> = new Map(
	(Object.entries(TERMES_NOM) as [Specifique, readonly string[]][]).map(([cat, termes]) => [cat, compiler(termes)]));
const RE_EXT: ReadonlyMap<Specifique, RegExp> = new Map(
	(Object.entries(EXTENSIONS) as [Specifique, readonly string[]][]).map(([cat, ext]) => [cat, new RegExp(`\\.(?:${ext.join("|")})$`)]));

/* Phrases whose words belong to ANOTHER subject than they seem: rewritten
   before matching, so that "réseaux de neurones" is not also networking,
   "injection SQL" not also SQL, "noyau Linux" not also Bash. */
const REECRITURES: readonly [RegExp, string][] = [
	[/(?<![a-z0-9])(?:reseaux?|reseau) de neurones(?![a-z0-9])/g, "neuralnet"],
	[/(?<![a-z0-9])(?:injections? sql|sql injections?)(?![a-z0-9])/g, "sqli"],
	[/(?<![a-z0-9])(?:noyau|kernel) linux(?![a-z0-9])|(?<![a-z0-9])linux kernel(?![a-z0-9])/g, "kernel"],
	[/(?<![a-z0-9])kali linux(?![a-z0-9])/g, "kali"],
	[/(?<![a-z0-9])github actions(?![a-z0-9])/g, "ghactions"],
	[/(?<![a-z0-9])gitlab[\s-]ci(?![a-z0-9])/g, "gitlabci"],
	// Maths, not physics, for all it names Newton.
	[/(?<![a-z0-9])binome de newton(?![a-z0-9])/g, "binomedenewton"],
	// Networking, not optics.
	[/(?<![a-z0-9])fibres? optiques?(?![a-z0-9])/g, "fibreoptique"],
];

/* BROAD subjects: words that name a field in passing as much as a course
   ("l'histoire de Python", "la gestion de la mémoire", "les équations
   du mouvement"). One of them only counts when no specific subject is
   named in the same text: "histoire de Python" is Python, not a tie. */
const LARGES: ReadonlySet<CategorieQuiz> = new Set<CategorieQuiz>(["maths", "histoire", "geo", "eco", "gestion"]);
/* Programming LANGUAGES give way to the field they are used for: "les
   algorithmes de tri en Python" is algorithms (its prompt writes the code
   in the course's language), "SQL avec Python" is SQL. Alone, the
   language is the subject. */
const LANGAGES_PROG: ReadonlySet<CategorieQuiz> = new Set<CategorieQuiz>(["python", "c", "cpp", "java", "csharp", "rust", "go"]);

/** Lowercase, accents removed, name separators (`_`) as spaces. */
function normaliser(texte: string): string {
	return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_]+/g, " ");
}

/** The subjects found in a text, each counted once. */
function trouvees(texte: string, estNom: boolean): Set<CategorieQuiz> {
	let t = normaliser(texte);
	for (const [re, par] of REECRITURES) t = t.replace(re, par);
	const r = new Set<CategorieQuiz>();
	for (const [cat, re] of RE_TEXTE) if (re.test(t)) r.add(cat);
	/* A language found by its bare NAME only is the broadest of all:
	   "Histoire en français.pdf" is history. With a study word it was found
	   above, and counts in full. */
	const parNomSeul = new Set<CategorieQuiz>();
	if (estNom) {
		for (const [cat, re] of RE_EXT) if (re.test(t)) r.add(cat);
		// A file name without its extension: the extension was read above.
		const sansExt = t.replace(/\.[a-z0-9]{1,5}$/, "");
		for (const [cat, re] of RE_NOM) {
			if (r.has(cat) || !re.test(sansExt)) continue;
			r.add(cat);
			if (estLangue(cat)) parNomSeul.add(cat);
		}
		if (MOT_C_NOM.test(sansExt)) r.add("c");
	}
	/* A broad subject gives way to a specific one named in the same text,
	   and a programming language to the field it serves. */
	if ([...r].some(c => !parNomSeul.has(c))) for (const c of parNomSeul) r.delete(c);
	if ([...r].some(c => !LARGES.has(c))) for (const c of LARGES) r.delete(c);
	if ([...r].some(c => !LANGAGES_PROG.has(c))) for (const c of LANGAGES_PROG) r.delete(c);
	return r;
}

/** One clue's subject: the one named by the most texts, `null` if none, or
    if two subjects tie. */
function categorieDe(textes: readonly string[], estNom: boolean): CategorieQuiz | null {
	const votes = new Map<CategorieQuiz, number>();
	for (const texte of textes) {
		for (const cat of trouvees(texte, estNom)) votes.set(cat, (votes.get(cat) ?? 0) + 1);
	}
	let meilleure: CategorieQuiz | null = null;
	let max = 0;
	let egalite = false;
	for (const [cat, n] of votes) {
		if (n > max) { meilleure = cat; max = n; egalite = false; }
		else if (n === max) egalite = true;
	}
	return egalite ? null : meilleure;
}

/** The subject deduced from the request: attachments, then folder, then
    text; `general` when nothing decides. */
export function detecterCategorie(indices: IndicesCategorie): CategorieQuiz {
	const pieces = (indices.pieces ?? []).filter(p => typeof p === "string" && p.trim() !== "");
	const parPieces = pieces.length ? categorieDe(pieces, true) : null;
	/* An .html attachment is as often a DOCUMENT — a saved page, a revision
	   sheet a tool exported — as web code: "revision-xti301.html", sent to
	   a folder named "XTI301 - Écosystème Python" for a request about
	   strings and dictionaries, came out "Web" (2026-09-29), and the prompt
	   lost its Python rules. When that extension is the only thing the
	   names say, the name without it, then the folder, then the request
	   decide first; the extension only settles what nothing else does. */
	let parExtensionDocument: CategorieQuiz | null = null;
	if (parPieces && pieces.some(p => EXTENSION_DOCUMENT.test(p))) {
		const sansExtension = categorieDe(pieces.map(p => p.replace(EXTENSION_DOCUMENT, "")), true);
		if (sansExtension) return sansExtension;
		parExtensionDocument = parPieces;
	} else if (parPieces) {
		return parPieces;
	}
	/* Each segment of the path is a name, read from the DEEPEST up: the
	   course folder says more than the programme above it
	   ("Bachelor Cybersécurité/XTI301 - Écosystème Python" is Python). Read
	   whole, the two tied and fell back to general. */
	const segments = (indices.dossier ?? "").split(/[\\/]+/).filter(Boolean);
	for (const segment of segments.reverse()) {
		const parSegment = categorieDe([segment], true);
		if (parSegment) return parSegment;
	}
	const demande = indices.demande ?? "";
	return (demande.trim() ? categorieDe([demande], false) : null) ?? parExtensionDocument ?? "general";
}

/** A FOLDER's subject, for the subject filter of the folders page
    (2026-09-29): its path, then its displayed name as the deepest segment
    ("XTI301 - Écosystème Python" says Python where the path may not). */
export function categorieDuDossier(chemin: string | undefined, nom: string | undefined): CategorieQuiz {
	return detecterCategorie({ dossier: [chemin, nom].filter(Boolean).join("/") });
}

/** The subject that leaves with a request: the user's choice when they
    made one (`auto` otherwise), the detection otherwise. */
export function categorieChoisie(choix: CategorieQuiz | "auto", indices: IndicesCategorie): CategorieQuiz {
	return choix === "auto" ? detecterCategorie(indices) : choix;
}
