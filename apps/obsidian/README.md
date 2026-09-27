# Neo Quiz (reader)

Obsidian plugin that plays interactive quizzes written as `quiz-blocks` code
blocks in your notes: multiple question types, exam mode, LaTeX, hints,
scoring, smooth transitions between questions. It renders a quiz — it does
not create or edit one.

## Format

A `quiz-blocks` code block holds a JSON5 array of questions:

````
```quiz-blocks
[
  { "type": "single", "prompt": "2 + 2 = ?", "options": ["3", "4", "5"], "correctIndex": 1 }
]
```
````

Supported question types: `single`, `multiple`, `text`, `ordering`,
`matching`. See the app's documentation for the full field reference.

## Spaced repetition

Every answer is appended to a shared review log
(`<vault>/.neo-quiz/review-log.jsonl`) that both this plugin and the desktop
app read, so review history follows you across hosts.

## Creating and editing quizzes

Creating and editing quizzes lives in the Neo Quiz desktop app:
<https://github.com/Neo-Quiz/neo-quiz>. This plugin only plays the blocks
it finds in your vault.
