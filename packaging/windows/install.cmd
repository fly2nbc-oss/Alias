<# :
@echo off
rem Alias for Windows: installs for the current user, no admin rights needed.
rem Copies Alias to %LOCALAPPDATA%\Programs\Alias, adds "Alias" to the Start menu
rem (opens maximized in its own Edge window with its own Edge profile, so other local
rem HTML files cannot read the names and placeholders) and to Settings > Apps.
rem Run it again to update. /quiet: no pause at the end (for software distribution).
rem
rem Everything below the batch part is PowerShell. It runs as a command, not as a
rem script file, so a script execution policy does not stop it.
rem The exit code is passed on outside any ( ) block: an "exit /b" inside one does not
rem reach the caller of "cmd /c" (it would always get 0).
setlocal
set "ALIAS_SELF=%~f0"
cd /d "%TEMP%"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Invoke-Expression (Get-Content -LiteralPath $env:ALIAS_SELF -Raw)"
set "ALIAS_RC=%errorlevel%"
if /i not "%~1"=="/quiet" pause
exit /b %ALIAS_RC%
#>

$ErrorActionPreference = 'Stop'
$name = 'Alias'
$src  = Split-Path -Parent $env:ALIAS_SELF
$dir  = Join-Path $env:LOCALAPPDATA "Programs\$name"
$html = Join-Path $dir 'alias.html'
$icon = Join-Path $dir 'alias.ico'
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$key  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Alias'
# Own Edge profile: under file:// all local HTML files share one storage in the default
# profile and could read the names and placeholders. Kept outside the program folder, so an update
# keeps the data; uninstall.cmd /purge deletes it.
$profileDir = Join-Path $env:LOCALAPPDATA 'AliasData\EdgeProfile'

try {
    $files = 'alias.html', 'alias.ico', 'uninstall.cmd', 'LICENSE', 'NOTICE', 'THIRD_PARTY.md'
    foreach ($f in $files) {
        if (-not (Test-Path -LiteralPath (Join-Path $src $f))) {
            throw "$f is missing next to install.cmd. Unpack the whole ZIP file first, then run install.cmd from there."
        }
    }
    # The former desktop version (Tauri/NSIS) registered the same entry name ("alias");
    # registry keys and file names ignore case, so this would take over its entry.
    $old = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
    if ($old -and ($old.MainBinaryName -or ($old.UninstallString -notlike '*\uninstall.cmd*'))) {
        throw "An older desktop version of Alias ($($old.DisplayVersion)) is installed. Remove it first in Settings > Apps > Installed apps, then run install.cmd again. Its names and placeholders are not carried over automatically."
    }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
    foreach ($f in $files) { Copy-Item -LiteralPath (Join-Path $src $f) -Destination $dir -Force }
    # Files from a downloaded ZIP carry the "from the internet" mark; the installed copy doesn't need it.
    Get-ChildItem -LiteralPath $dir -File | Unblock-File

    # The build writes <meta name="alias-version" content="x.y.z"> into the head of alias.html.
    $version = ''
    $m = Select-String -LiteralPath $html -Pattern '<meta[^>]*name="alias-version"[^>]*content="([^"]+)"' | Select-Object -First 1
    if ($m) { $version = $m.Matches[0].Groups[1].Value }

    # Edge opens the file in an app window: no tabs, no address bar, own taskbar entry.
    $edge = $null
    $candidates = @(
        (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)'
        (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)'
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c.Trim('"'))) { $edge = $c.Trim('"'); break }
    }
    $url = 'file:///' + (($html -replace '%', '%25' -replace ' ', '%20' -replace '#', '%23') -replace '\\', '/')

    $lnkPath = Join-Path $menu "$name.lnk"
    $urlPath = Join-Path $menu "$name.url"
    Remove-Item -LiteralPath $lnkPath, $urlPath -ErrorAction SilentlyContinue
    $fallback = $false
    try {
        $shell = New-Object -ComObject WScript.Shell
        $lnk = $shell.CreateShortcut($lnkPath)
        if ($edge) { $lnk.TargetPath = $edge; $lnk.Arguments = "--user-data-dir=`"$profileDir`" --no-first-run --no-default-browser-check --start-maximized --app=`"$url`"" } else { $lnk.TargetPath = $html }
        $lnk.WorkingDirectory = $dir
        $lnk.IconLocation = "$icon,0"
        $lnk.WindowStyle = 3  # maximized
        $lnk.Description = 'Pseudonymize names and other personal data in texts and documents'
        $lnk.Save()
    } catch {
        # Locked-down PowerShell (constrained language) may refuse the shortcut object.
        # An Internet shortcut needs none; it opens Alias in the default browser.
        Remove-Item -LiteralPath $lnkPath -ErrorAction SilentlyContinue
        Set-Content -LiteralPath $urlPath -Encoding Unicode -Value @('[InternetShortcut]', "URL=$url", "IconFile=$icon", 'IconIndex=0', 'ShowCommand=3')
        $fallback = $true
    }

    # Entry in Settings > Apps > Installed apps, for the current user only.
    New-Item -Path $key -Force | Out-Null
    $size = (Get-ChildItem -LiteralPath $dir -File | Measure-Object -Property Length -Sum).Sum
    Set-ItemProperty -LiteralPath $key -Name DisplayName -Value $name
    Set-ItemProperty -LiteralPath $key -Name DisplayVersion -Value $version
    Set-ItemProperty -LiteralPath $key -Name DisplayIcon -Value $icon
    Set-ItemProperty -LiteralPath $key -Name InstallLocation -Value $dir
    Set-ItemProperty -LiteralPath $key -Name UninstallString -Value "$env:ComSpec /c `"`"$(Join-Path $dir 'uninstall.cmd')`" /quiet`""
    Set-ItemProperty -LiteralPath $key -Name EstimatedSize -Value ([int]($size / 1024)) -Type DWord
    Set-ItemProperty -LiteralPath $key -Name NoModify -Value 1 -Type DWord
    Set-ItemProperty -LiteralPath $key -Name NoRepair -Value 1 -Type DWord

    Write-Host "$name $version is installed in $dir"
    Write-Host "Start it from the Start menu: $name"
    if ($fallback) { Write-Host 'It opens in your default browser (Windows did not allow the Edge app shortcut).' }
    elseif (-not $edge) { Write-Host 'Microsoft Edge was not found; it opens in your default browser.' }
    if ($edge -and -not $fallback) { Write-Host "Alias keeps its data (names and placeholders, model) in its own Edge profile: $profileDir" }
    Write-Host 'On first use Alias downloads its name recognition model once from Hugging Face; the browser keeps it.'
    Write-Host 'To update, run install.cmd of the new version. To remove: Settings > Apps > Installed apps.'
    exit 0
} catch {
    Write-Host "Installation failed: $_" -ForegroundColor Red
    exit 1
}
