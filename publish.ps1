# Publish the game to GitHub Pages (first run creates the repo; later runs push updates).
$ErrorActionPreference = 'Continue'  # native stderr must not abort (PS 5.1)
Set-Location $PSScriptRoot
$git = 'C:\Program Files\Git\cmd\git.exe'
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
$repo = 'pitch-star'

& $gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    $env:GH_CONFIG_DIR = "$HOME\PitchScoreGameTools\gh"
    & $gh auth status 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Not logged in to GitHub. Run: gh auth login' }
}
$login = & $gh api user --jq .login
$id = & $gh api user --jq .id
& $gh auth setup-git

# commit identity = GitHub no-reply address (keeps your real email private)
& $git config user.name $login
& $git config user.email "$id+$login@users.noreply.github.com"
& $git add -A
& $git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { & $git commit -q -m "Update Pitch Star" }

& $git remote get-url origin 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    & $gh repo create $repo --public --source . --remote origin --push --description 'Pitch Star - karaoke pitch practice game'
    & $gh api -X POST "repos/$login/$repo/pages" -f 'source[branch]=main' -f 'source[path]=/' | Out-Null
} else {
    & $git push -q origin main
}
Write-Host ''
Write-Host "Published. Site (may take ~1 min to update): https://$login.github.io/$repo/app/" -ForegroundColor Green
