/* What a GOOD interactive page looks like, shared by the Learn generation
   prompt (`dashboard/ai-client.ts`) and the Explain chat
   (`explain-prompt.ts`). Written from two pages claude.ai made for the owner
   (2026-10-09, a token simulator on a UML activity diagram). The second, an
   EXERCISE, was judged far better than the first, a demo: the symbols to
   understand start EMPTY, the learner has to choose them, then runs the token
   to see the consequence of HIS choice. Predict, test, get told why. */
export const SIMULATOR_GUIDE = `THE MODEL OF A GOOD INTERACTIVE PAGE: an EXERCISE, never a demo the learner only watches.
- A "Task" box at the top, one or two sentences, that tells what to do now ("J and M are empty. Choose the right symbol for each, choose a path to test, then press Start to check."). It changes as the learner goes on (during the run, after a success, after a failure).
- Draw the notion in inline SVG exactly as the course draws it (boxes with rounded corners, real arrows with an SVG marker, filled and empty diamonds, fork/join bars, start and end circles, labels and guards such as [accepted]), in a viewBox of about 680 x 240, width 100%.
- The parts the learner must understand start EMPTY: a dashed placeholder with a "?" where the symbol goes. The learner fills them with rows of choice buttons ("J is: a bar / a diamond", "Path to test: [accepted] / [refused]"); the drawing updates at once with the chosen symbol. The chosen button is clearly highlighted (filled), the others outlined.
- A status line under the buttons: what is still missing ("Still to choose: J, the path."), then "Everything is chosen. You can press Start." Start with something missing does nothing but name it, in the danger colour.
- Start runs THE LEARNER'S version: a coloured token (circle, r about 8) moves from step to step with a CSS transition (transform .7s ease), splits into two on a fork, waits at a join; "Next step" advances, and ONE sentence beside the button says what happens and WHY at each step. While it runs, the choices are LOCKED (dimmed, "Choices locked during the run. Restart unlocks them.").
- The ending judges the choice by its CONSEQUENCE, coloured: wrong ones end in the danger colour with what went wrong ("J is a bar: it waits for a token on both inputs. Only one comes, the other path was not taken. Everything stays blocked."), the right one in the success colour ("End. The process is correct."). Then the task box says what to change ("Not the right choice for J. Press Restart, then change this symbol.") and the button becomes "Restart"; after a success, it invites testing the other path.
- Pick a concrete METAPHOR when the notion is abstract. Example, relative integers: an ELEVATOR drawn in SVG, floor 0 the ground floor, positive floors up to +16 at most and basements down to -5 at most (no more, it would take too much room); buttons such as "go up 3" and "go down 5"; the car moves floor by floor and ONE sentence turns each trip into the calculation ("You are at -2, you go up 5: -2 + 5 = 3"). As an exercise: "Which floor will you reach?" asked BEFORE the car moves.
- Plain inline <script> in an IIFE, a small state object (choices, step index, locked), no library; respect prefers-reduced-motion (no transition).
- Sober dark look: thin strokes, one accent for the token, the app's CSS variables for colours and font.`;
