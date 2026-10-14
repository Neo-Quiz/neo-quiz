/**
 * CODE COLOURS INSIDE AN INTERACTIVE PAGE (2026-10-14). A page written by the
 * model showed its code as plain grey text: the frame now colours every
 * `<pre>` and `<code>` of the page itself, whatever the language, with the
 * syntax colours of the app's code blocks (`--nq-code-*`, html-frame-core.ts).
 *
 * The tokenizer is generic on purpose (comments, strings, numbers, a keyword
 * list shared by Python, C, Java, JavaScript and SQL, a name before "(" as a
 * function): a page can hold any of them, and a guess per language would be
 * wrong more often than a common grammar. An element that already holds
 * elements is left alone (the author coloured it, or it is a control); one
 * the page rewrites later (`textContent`) is coloured again, through a
 * MutationObserver, debounced to one frame.
 *
 * It runs INSIDE the sandboxed frame, after the author's page: it can only
 * change that page. Text goes back through an escaper, never as markup.
 */

/** The colour of each token class, in the frame's variables. */
export const FRAME_CODE_CSS = "pre,code{font-family:var(--nq-mono);font-size:.92em}"
	+ ".nq-tk-k{color:var(--nq-code-keyword)}.nq-tk-s{color:var(--nq-code-string)}"
	+ ".nq-tk-n{color:var(--nq-code-number)}.nq-tk-c{color:var(--nq-code-comment);font-style:italic}"
	+ ".nq-tk-f{color:var(--nq-code-function)}";

export const FRAME_CODE_SCRIPT = String.raw`(function(){
var KW={};"def return for in if elif else while import from as class try except finally with lambda yield True False None and or not is pass break continue raise global nonlocal assert del async await function const let var new this typeof instanceof null undefined true false int float double char void long short unsigned signed struct enum public private protected static final include define printf scanf malloc free sizeof switch case default do goto SELECT FROM WHERE INSERT INTO UPDATE DELETE JOIN ON GROUP BY ORDER AND OR NOT NULL AS".split(" ").forEach(function(w){KW[w]=1});
var RE=/(#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(\s*\()?/g;
function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function span(c,t){return '<span class="nq-tk-'+c+'">'+esc(t)+"</span>"}
function colour(text){var out="",last=0,m;RE.lastIndex=0;while((m=RE.exec(text))){out+=esc(text.slice(last,m.index));if(m[1])out+=span("c",m[1]);else if(m[2])out+=span("s",m[2]);else if(m[3])out+=span("n",m[3]);else if(m[4]){if(KW[m[4]])out+=span("k",m[4]);else if(m[5])out+=span("f",m[4]);else out+=esc(m[4]);if(m[5])out+=esc(m[5])}last=RE.lastIndex}return out+esc(text.slice(last))}
function run(){var els=document.querySelectorAll("pre,code");for(var i=0;i<els.length;i++){var el=els[i];if(el.children.length||el.closest("[contenteditable]"))continue;var t=el.textContent;if(!t||el.getAttribute("data-nq-tk")===t)continue;el.innerHTML=colour(t);el.setAttribute("data-nq-tk",t)}}
var queued=false;function later(){if(queued)return;queued=true;requestAnimationFrame(function(){queued=false;run()})}
run();new MutationObserver(later).observe(document.body,{subtree:true,childList:true,characterData:true});
})();`;
