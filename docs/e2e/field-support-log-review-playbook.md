# Field Support — Log Review Playbook

**Version:** 1.0 (demo)  
**Applies to:** Hybrid agents with local PC access + WhatsApp replies  
**Collection:** Field Support

## Purpose

When a user (via WhatsApp or dashboard) asks to review debug or application logs on their Windows PC, follow this playbook. The agent runs on the user's machine; files open on their screen (Notepad, Explorer), not inside Qlix.

## Standard log location (this demo)

| Item | Value |
|------|--------|
| Primary log file | `AgentDebug.log` |
| Typical folder | `...\autocad-final\autocad-final\bin\Debug` |
| Example full path | `C:\Users\admin\source\repos\autocad-final\autocad-final\bin\Debug\AgentDebug.log` |

Always use the **full absolute path** the user provides. Do not guess filenames (e.g. not `agentdebug.txt`).

## Required workflow

1. **Query this playbook** when the user mentions policy, playbook, brain, field support, or `#brain`.
2. **List or read** the target directory if the exact file is unclear (`s3_list_dir` on the Debug folder).
3. **Read** the log with `s3_read_file` (optionally last N lines for large files).
4. **Open on the user's screen** so they can watch along:
   - File: default app or Notepad (`s3_open_file`, mode `default`, or `application: notepad`).
   - Highlight in Explorer: `s3_open_file`, mode `reveal`.
   - Open folder: `s3_open_file`, mode `folder`.
5. **Analyze** lines containing (case-insensitive): `error`, `exception`, `fail`, `fatal`, `critical`.
6. **Reply** with a short summary suitable for WhatsApp (max 15 bullets, plain text, no markdown tables).

## Tools to prefer

| Task | Tool |
|------|------|
| Read log content | `s3_read_file` (use `max_lines` for large files) |
| Open file in Notepad / default app | `s3_open_file` (mode `default` or `application: notepad`) |
| Show file in Explorer | `s3_open_file` (mode `reveal`) |
| List Debug folder | `s3_list_dir` |

Prefer `s3_read_file` / `s3_open_file` over `gui_control` for logs unless the user explicitly asks for desktop UI automation.

## Do not

- Use `s3_write_file`, `s3_python`, or `s3_bash` unless the user explicitly asks to **create, save, or modify** a file on disk.
- Do not write `error_summary.txt` or other sidecar files unless the user requests a saved report.
- Delete, overwrite, or truncate log files unless the user explicitly requests it.
- Open paths outside the user-specified project folders without confirmation.
- Paste more than ~1500 characters in the final user-facing summary (WhatsApp limit).
- Claim a file was opened unless `s3_open_file` succeeded.

## Escalation

Escalate to a human engineer if:

- The log file does not exist at the given path.
- Repeated `ACCESS DENIED` or permission errors on read/open.
- The log shows unrecoverable corruption or zero bytes.
- The user asks to modify production config or registry.

Escalation message template:  
`Escalation: [issue]. Path: [path]. Last action attempted: [tool]. Suggest: [next step].`

## WhatsApp reply format

Use this structure for the final message:

```
Field support summary — AgentDebug.log
- Path: [full path]
- Opened on your PC: yes/no
- Error-like lines found: [count]
- Top issues:
  1. ...
  2. ...
- Recommendation: ...
```

## Example user request (reference)

> Follow field support playbook. Read AgentDebug.log on my PC, open in Notepad, list last 5 error lines, summarize for WhatsApp.

Expected agent behavior: brain context from this document → read file → open Notepad → concise bullet summary in reply.
