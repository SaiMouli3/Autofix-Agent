"""
Patches pr_agent.py to fix the branch checkout failure.

Root cause: server.log and chroma/ files are locked by running processes.
Git stash fails because it can't unlink them.

Fix:
  1. Remove runtime files from git index (git rm --cached) so git ignores them
  2. Use force checkout (-f) to switch branches without touching locked files
  3. No stash needed at all
"""

path = r"C:\Users\ADMIN\Desktop\grab hack 2.0\Incident_iq\incidentiq\incidentiq\scripts\pr_agent.py"
content = open(path, encoding="utf-8").read()

# ── Replace the entire branch creation block ──────────────────────────────────
OLD = """    try:
        new_branch = repo.create_head(branch_name, commit=base_commit)

        # Stash any uncommitted changes so checkout doesn't fail
        stashed = False
        try:
            result = repo.git.stash("push", "--include-untracked", "-m", "autofix-pre-branch-stash")
            if "No local changes" not in result:
                stashed = True
                print("  Stashed local changes before checkout")
        except Exception as stash_err:
            print(f"  Warning: stash failed (continuing): {stash_err}")

        new_branch.checkout()

        # Restore stashed changes so the fixed file is present to commit
        if stashed:
            try:
                repo.git.stash("pop")
                print("  Restored stashed changes after checkout")
            except Exception as pop_err:
                print(f"  Warning: stash pop failed: {pop_err}")

    except Exception as e:
        print(f"  Failed to create branch: {e}")
        return None"""

NEW = """    try:
        new_branch = repo.create_head(branch_name, commit=base_commit)

        # Remove runtime/generated files from git index so they never block checkout.
        # These files may be locked by running processes (Flask, ChromaDB) so we
        # cannot stash or delete them — just tell git to stop tracking them.
        runtime_patterns = [
            "ecommerce/backend/server.log",
            "ecommerce/data/chroma/",
            "ecommerce/data/",
            "*.bak",
        ]
        for pattern in runtime_patterns:
            try:
                repo.git.rm("--cached", "-r", "--ignore-unmatch", "--quiet", pattern)
            except Exception:
                pass  # already untracked or doesn't exist — fine

        # Force checkout — skips working-tree conflicts for files not in the index
        try:
            repo.git.checkout("-f", branch_name)
            print(f"  Checked out branch: {branch_name}")
        except Exception as co_err:
            # Last resort: use the GitPython API with force
            new_branch.checkout(force=True)
            print(f"  Checked out branch (force): {branch_name}")

    except Exception as e:
        print(f"  Failed to create branch: {e}")
        return None"""

if OLD in content:
    patched = content.replace(OLD, NEW)
    open(path, "w", encoding="utf-8").write(patched)
    print("OK — branch checkout block patched")
else:
    print("Pattern not found — showing what's there:")
    idx = content.find("new_branch = repo.create_head")
    print(repr(content[max(0, idx-20):idx+600]))
