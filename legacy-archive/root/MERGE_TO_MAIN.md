# Steps to Merge Feature Branch to Main

After committing your changes, run these commands:

```bash
# 1. Commit the changes (type YES when prompted)
git commit -m "feat(ui): Early Believers round hard cap + completion state"

# 2. Push the feature branch first (optional, but good practice)
git push origin feature/believers-rxf-display

# 3. Switch to main
git checkout main

# 4. Pull latest from remote (in case there are new commits)
git pull origin main

# 5. Merge the feature branch
git merge feature/believers-rxf-display

# 6. Push to main (type YES when prompted)
git push origin main
```

If you get merge conflicts, resolve them and then:
```bash
git add .
git commit -m "Merge feature/believers-rxf-display into main"
git push origin main
```

