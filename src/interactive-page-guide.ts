/* What a GOOD interactive page looks like, shared by the Learn generation
   prompt (`dashboard/ai-client.ts`) and the Explain chat
   (`explain-prompt.ts`). Written from two pages claude.ai made for the owner
   (2026-10-09, a token simulator on a UML activity diagram). The second, an
   EXERCISE, was judged far better than the first, a demo: the symbols to
   understand start EMPTY, the learner has to choose them, then runs the token
   to see the consequence of HIS choice. Predict, test, get told why.
   2026-10-10, after an Explain answer on UML diamonds: symbols are DRAWN (a
   table of symbols written as words and Unicode characters was judged ugly),
   a choice button shows its symbol drawn, and a token belongs to a flow only
   (on a class diagram the model put a blue dot on a box that meant nothing).
   The same day the owner asked that these stay PRINCIPLES: the examples fit
   one notion each, and a model that copies them makes a page that does not
   fit its own; it designs the page it wants.
   2026-10-17: an Explain page on cookie theft, built as an exercise (choose
   where the cookie goes before anything was shown, a red "nothing chosen"
   on arrival, labels in capitals, English words in French), was not
   understood at all. The rule is now UNDERSTAND THEN CHECK, always in
   numbered steps (1., 2., 3.: the owner's rule), the exercise reduced to one
   question at the end. The "nothing chosen at the start" rule is gone.
   2026-10-19: on "classic programming vs machine learning", three pages
   were compared; the one chosen held ONE slider (labelled photos) and two
   bars side by side (the classic program stays flat, the learned model
   climbs), judged to "sum it all up". A page claude.ai made on the same
   notion, five sections stacked, was judged far too long. So: the SMALLEST
   page that shows the notion, laid out across the width; numbered steps
   only when the notion IS a sequence. */
export const SIMULATOR_GUIDE = `SYMBOLS ARE DRAWN, NEVER WRITTEN: whenever you list, compare or explain drawn symbols or notations (UML links and diamonds, arrows, flowchart or activity shapes, circuit symbols...), never write them as words or Unicode characters such as ◇ ◆ ▷ in a Markdown table. Write the table in the interactive HTML page described above: one row per symbol, the FIRST column the symbol drawn in inline SVG exactly as the course draws it (about 60 x 20, thin strokes in the text colour), then its name in bold, then what it means. Thin borders in the border colour, a header row.

A GOOD INTERACTIVE PAGE: the learner first UNDERSTANDS, then CHECKS. What follows are PRINCIPLES: design the page that fits THIS notion, never copy an example's layout or words.
- A TITLE, ALWAYS: the page's <title> is ONE short line (60 characters at most) in the language of the conversation saying what the page is FOR, its goal or the question it answers (for example "Plus de photos, meilleur modèle ?"). The app shows it at the top left of the frame, above the page: without it the learner cannot tell what the page is for. Never repeat it as a heading inside the page.
- A SLIDER MOVES FREELY: a continuous value gets a continuous slider (a fine step, the result updating while it moves), never a handful of notches; a value that spans several orders of magnitude (10 to 100 000) uses a log scale under the slider, its shown value rounded to read well. Notches only for a value that is truly discrete (a number of layers, a step index).
- A NOTE SITS BY WHAT IT EXPLAINS: a line that says what numbers or a drawing mean ("success rate on photos never seen", "indicative values", a unit, a legend) is placed right next to them, above or beside, never as a loose line at the bottom of the page where it explains nothing.
- CHOOSE THE FORM LAST, AND WITH CARE: the wrong kind of page makes a simple notion look complicated (steps, sections and buttons around an idea that fits in one sentence tell the learner it is hard). First write, for yourself, the ONE sentence the notion comes down to; then pick the form that shows THAT sentence and nothing else.
- THE SMALLEST PAGE THAT SHOWS THE NOTION: find the ONE thing the notion says and let the learner act on exactly that, nothing more. A notion that says "this depends on that" or "these two differ by this" gets ONE control (a slider, a toggle) and its consequence shown at once, the cases SIDE BY SIDE so the difference is seen without reading. Example of the idea, classic programming vs machine learning: one slider for the number of labelled photos, two bars side by side, the classic program's stays flat, the learned model's climbs, one short sentence under each that rewrites itself. Never several sections stacked (a quiz, a game, a summary and a diagram in one page): one idea, one interaction, a few lines tall.
- USE THE WIDTH: the frame is wide and the reading scrolls, so lay things out ACROSS: a flow runs left to right with drawn boxes and arrows (never a column of text with "↓"), two cases sit in two columns. Below 560 px wide everything stacks into one column (a media query), arrows turning downward.
- NUMBERED STEPS WHEN THE NOTION IS A SEQUENCE (a process, an algorithm, an exchange, an exercise to solve): the page is built on a list of steps, "1.", "2.", "3."... (3 to 7), shown as a column or a row of numbered items with a short title each; the current step is highlighted, the steps done stay readable. "Previous" and "Next" buttons move through them, and clicking a step's number goes to it.
- EACH STEP shows on the drawing what happens at that moment (an arrow that lights up, a token or a packet that moves, a box that fills, what is sent or kept) and ONE or TWO sentences under it say what happens and WHY, in plain words. The drawing never changes without its sentence.
- STEP 1 sets the scene: who or what is involved, drawn and labelled, before anything moves. Draw what each element HOLDS (the cookie inside the browser, the three vectors of a word), not only its name.
- THE LAST STEP (of a page in steps) sums up in one sentence, then ONE question about a consequence, to verify what was understood ("If the cookie had the HttpOnly option, what would the attacker get?"), with two to four answers as buttons; the chosen answer is coloured (success or danger) and one sentence says why. A "Start again" button goes back to step 1.
- Nothing is wrong before the learner acts: no error message, no red text, no "nothing chosen" warning on arrival.
- Draw the notion in inline SVG as the course draws it (boxes with rounded corners, real arrows with an SVG marker, start and end circles, labels and guards), in a viewBox of about 680 x 240, width 100%. On a FLOW (process, sequence, algorithm, network exchange) something moves along it; on a STRUCTURE (classes, data, ownership) nothing moves: show what happens to each element instead. Every mark on the page (colour, dot, badge, outline) means something the text says.
- Labels in sentence case, never in capitals; every word in the language of the conversation, no English word slipped into another language. A technical term the course keeps in English (softmax, token) is explained in plain words where it first appears.
- Pick a concrete METAPHOR when the notion is abstract. Example, relative integers: an ELEVATOR drawn in SVG, floor 0 the ground floor, positive floors up to +16 at most and basements down to -5 at most (no more, it would take too much room); buttons such as "go up 3" and "go down 5"; the car moves floor by floor and ONE sentence turns each trip into the calculation ("You are at -2, you go up 5: -2 + 5 = 3"). As an exercise: "Which floor will you reach?" asked BEFORE the car moves.
- Plain inline <script> in an IIFE, a small state object (step index, answer), no library; respect prefers-reduced-motion (no transition).
- Sober dark look: thin strokes, one accent for the token, the app's CSS variables for colours and font.`;
