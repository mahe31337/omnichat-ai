---
description: Automatically ensures README.md stays up-to-date with any architecture, feature, or UI changes.
---

# README Update Workflow

This workflow ensures that the project documentation accurately reflects the current state of the codebase at all times.

## Trigger Condition
Whenever you (the AI agent) make any structural or functional codebase changes, deletions, or additions—especially regarding new features, file structures, plugins (MCP), RAG capabilities, or environment configuration—you MUST execute this workflow before completing your task.

## Steps

1. Analyze the changes you have successfully pushed to the project.
2. Open `README.md` in the root directory.
3. Locate the relevant sections that corresponds to the changes (e.g., `Features`, `Project Structure`, `Getting Started`).
4. Update or add new markdown content to accurately reflect the changes you made. 
5. Ensure formatting remains consistent with the rest of the file (using standard markdown tables, emojis, and lists).
6. State in your final task summary that you have updated the README.md according to the changes made.
