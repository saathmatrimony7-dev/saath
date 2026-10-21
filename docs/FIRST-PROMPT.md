# Prompts to paste into Kimi Code

## First prompt (start in Plan mode: press Shift+Tab)

Read AGENTS.md and docs/DESIGN.md completely, plus the role files in .claude/agents/.
Then, acting as the architect, give me a task-by-task plan for Phase P0 (Foundations) only:
a table with task, role, depends on, and acceptance criteria. Don't write any code yet.
Also list any questions or open decisions that block P0.

## After you approve the plan

Plan approved. Build P0 task by task. After each task: run tests and lint, commit, and
give me a 3-line summary. When P0 is done, do the security-reviewer and privacy-reviewer
passes, fix any High/Critical findings, then report P0 exit criteria as pass/fail with evidence.

## Starting each later phase

Phase <P1/P2/...>: re-read the relevant DESIGN.md sections, give me the task plan first,
wait for my approval, then build the same way as P0.

## If a session gets long

/compact (or start a new session with /new and say: "Continue Phase X from where the last commit left off. Check git log first.")
