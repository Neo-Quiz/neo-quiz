/* What a GOOD interactive page looks like, shared by the Learn generation
   prompt (`dashboard/ai-client.ts`) and the Explain chat
   (`explain-prompt.ts`). Written from a page claude.ai made for the owner
   (2026-10-09, a token simulator on a UML activity diagram): the learner
   predicts, plays, and sees the consequence, instead of reading. */
export const SIMULATOR_GUIDE = `THE MODEL OF A GOOD INTERACTIVE PAGE (a simulator, not a picture):
- Draw the notion in inline SVG exactly as the course draws it (boxes with rounded corners, real arrows with an SVG marker, filled and empty diamonds, fork/join bars, start and end circles, labels and guards such as [accepted]), in a viewBox of about 680 x 240, width 100%.
- Put a moving element on it that makes the rule visible: a coloured token (circle, r about 8) that travels from step to step with a CSS transition (transform .7s ease), splitting into two tokens on a fork and waiting at a join.
- Under the drawing, rows of choice buttons that CHANGE the drawing: "Path taken: [accepted] / [refused]", "J is: a bar / a diamond", "M is: a diamond / a bar". The selected button is highlighted. Start on the version of the course or the exam subject, even if it is wrong.
- A "Start" then "Next step" button, and ONE sentence beside it that says, at each step, what happens and WHY ("The token reaches J, a join bar: it waits for a token on EVERY incoming edge. Only one will ever come: the process is stuck."). The consequence of a wrong choice is shown, not told: the token blocks, two tokens arrive, a branch never ends.
- Plain inline <script> in an IIFE, a small state object, no library; respect prefers-reduced-motion (no transition).
- Sober dark look: thin strokes, a single accent for the token, the app's CSS variables for colours and font.`;
