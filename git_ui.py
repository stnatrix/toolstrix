import os
import subprocess
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from pathlib import Path

app = FastAPI(title="Git UI Manager")

REPO_PATH = Path(__file__).parent.resolve()

def run_git(args: list[str]) -> str:
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=REPO_PATH,
            capture_output=True,
            text=True,
            check=True,
            encoding="utf-8",
            errors="ignore"
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        # If no commits yet, git log will fail. We handle it.
        raise HTTPException(status_code=500, detail=e.stderr or e.stdout or str(e))

@app.get("/", response_class=HTMLResponse)
def get_ui():
    html_path = REPO_PATH / "git_ui.html"
    if html_path.exists():
        return html_path.read_text(encoding="utf-8")
    return "<h3>git_ui.html not found</h3>"

@app.get("/api/status")
def get_status():
    try:
        status_output = run_git(["status", "--porcelain"])
    except Exception as e:
        return {"branch": "error", "files": [], "error": str(e)}
        
    files = []
    for line in status_output.splitlines():
        if len(line) >= 4:
            x = line[0]  # index status
            y = line[1]  # work tree status
            filepath = line[3:]
            # Clean up quotes if any
            if filepath.startswith('"') and filepath.endswith('"'):
                filepath = filepath[1:-1]
                
            files.append({
                "path": filepath,
                "staged": x in ["M", "A", "D", "R", "C"],
                "unstaged": y in ["M", "D"] or (x == "?" and y == "?"),
                "status_code": f"{x}{y}"
            })
    
    # Get current branch
    try:
        branch = run_git(["branch", "--show-current"]).strip()
    except Exception:
        branch = "unknown"
        
    return {"branch": branch, "files": files}

@app.get("/api/diff")
def get_diff(path: str, staged: bool = False):
    args = ["diff"]
    if staged:
        args.append("--staged")
    args.extend(["--", path])
    try:
        diff_output = run_git(args)
    except Exception as e:
        diff_output = f"Could not generate diff: {e}"
    return {"diff": diff_output}

class StageRequest(BaseModel):
    path: str
    stage: bool

@app.post("/api/stage")
def stage_file(req: StageRequest):
    if req.stage:
        run_git(["add", req.path])
    else:
        run_git(["restore", "--staged", req.path])
    return {"status": "ok"}

@app.post("/api/stage-all")
def stage_all():
    run_git(["add", "."])
    return {"status": "ok"}

@app.post("/api/unstage-all")
def unstage_all():
    run_git(["restore", "--staged", "."])
    return {"status": "ok"}

class CommitRequest(BaseModel):
    message: str

@app.post("/api/commit")
def commit_changes(req: CommitRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Commit message cannot be empty")
    run_git(["commit", "-m", req.message])
    return {"status": "ok"}

class DiscardRequest(BaseModel):
    path: str

@app.post("/api/discard")
def discard_file(req: DiscardRequest):
    run_git(["checkout", "--", req.path])
    return {"status": "ok"}

@app.get("/api/log")
def get_log():
    try:
        log_output = run_git(["log", "-n", "30", "--pretty=format:%h|%an|%ar|%s"])
        commits = []
        for line in log_output.splitlines():
            parts = line.split("|", 3)
            if len(parts) == 4:
                commits.append({
                    "hash": parts[0],
                    "author": parts[1],
                    "date": parts[2],
                    "message": parts[3]
                })
        return {"commits": commits}
    except Exception:
        # No commits yet or other error
        return {"commits": []}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5005)
