# Chronicle Session Scripts

Portable session registry anchored to **git repo identity** (root-commit SHA).
Works across PC restarts, folder renames, and moves.

---

## The Problem

| Client | Issue |
|--------|-------|
| Copilot CLI | Has session IDs (`--resume`) but loses folder context on restart |
| Claude | Uses working directory — breaks if folder is moved |

## The Solution

Use `git rev-list --max-parents=0 HEAD` as the stable repo key.  
This SHA never changes, even if you rename, move, or re-clone the repo.

Sessions are stored in `~/.chronicle/registry.json`.

---

## Quick Start

### 1. Register sessions (do once per project × account)

```powershell
# After starting a Copilot CLI session, copy its session ID and run:
.\scripts\register-session.ps1 -Client copilot -Account work1 -SessionId "abc-123"
.\scripts\register-session.ps1 -Client copilot -Account work2 -SessionId "xyz-456"

# For Claude (auto-detects current folder):
.\scripts\register-session.ps1 -Client claude -Account personal
```

### 2. Resume after PC restart

```powershell
# List everything registered for THIS repo:
.\scripts\resume-session.ps1

# Get the resume command for a specific account:
.\scripts\resume-session.ps1 -Client copilot -Account work1
.\scripts\resume-session.ps1 -Client claude -Account personal

# Copy command to clipboard:
.\scripts\resume-session.ps1 -Client copilot -Account work1 -Copy
```

### 3. See all projects at once

```powershell
# From anywhere:
& "$HOME\.chronicle\list-sessions.ps1"   # if you copy list-sessions.ps1 there

# Or from this repo:
.\scripts\list-sessions.ps1
.\scripts\list-sessions.ps1 -Client copilot   # filter by client
```

---

## Folder Moves

If you move the project folder, just run any script from the new location.  
It detects the path change via git and updates the registry automatically.

---

## Registry Format

```
~/.chronicle/registry.json
{
  "repos": {
    "<root-commit-sha>": {
      "name": "chronicle",
      "localPath": "C:\\...",
      "sessions": {
        "copilot:work1": { "sessionId": "...", "savedAt": "..." },
        "copilot:work2": { "sessionId": "...", "savedAt": "..." },
        "claude:personal": { "workdir": "C:\\...", "savedAt": "..." }
      }
    }
  }
}
```

## Tip: Global shortcut

Copy `list-sessions.ps1` to `~/.chronicle/` so you can run it from anywhere after a restart:

```powershell
Copy-Item .\scripts\list-sessions.ps1 "$HOME\.chronicle\"
```

Then add to your PowerShell profile:
```powershell
function sessions { & "$HOME\.chronicle\list-sessions.ps1" @args }
```
