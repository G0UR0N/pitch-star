"""Build the Pitch Star app for the Fire tablet (user, 2026-11-25: "Can this be made to work as a side
loadable app on her fire HD tablet? I dont want her to have access to the browser" ... "Go for it").

No Gradle: aapt2 + javac + d8 + zipalign + apksigner straight from the Android SDK.
Toolchain (downloaded 2026-11-25): %USERPROFILE%\\PitchScoreGameTools\\android\\{jdk, sdk}.
Inputs: android\\AndroidManifest.xml, android\\src\\..., the web game in app\\ (packed inside the APK).
Signing key: PitchScoreGameTools\\android\\pitchstar.keystore (made on first run; KEEP IT: an update
signed with another key will not install over the old app, and uninstalling erases her songs/scores).
Output: PitchScoreGameTools\\android\\build\\PitchStar.apk, copied to G:\\My Drive\\PitchStar\\PitchStar.apk.
Usage: build_apk.py      Log: tools\\build_apk.log
"""
import os
import secrets
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
T = Path(os.environ["USERPROFILE"]) / "PitchScoreGameTools" / "android"
JDK = T / "jdk"
BT = T / "sdk" / "build-tools" / "34.0.0"
JAR = T / "sdk" / "platforms" / "android-34" / "android.jar"
B = T / "build"
KS, KSPASS = T / "pitchstar.keystore", T / "keystore-pass.txt"
DRIVE = Path(os.environ.get("PSG_SONGS", r"G:\My Drive\PitchStar"))
LOG = Path(__file__).with_name("build_apk.log")
log = [f"build apk {time.strftime('%Y-%m-%d %H:%M')}"]


def say(s):
    print(s, flush=True)
    log.append(s)


def run(*args):
    env = dict(os.environ, JAVA_HOME=str(JDK), PATH=str(JDK / "bin") + os.pathsep + os.environ["PATH"])
    r = subprocess.run([str(a) for a in args], capture_output=True, text=True, env=env, shell=str(args[0]).endswith(".bat"))
    if r.returncode:
        say(f"FAILED: {' '.join(str(a) for a in args)}\n{r.stdout}\n{r.stderr}")
        LOG.write_text("\n".join(log) + "\n", encoding="utf-8")
        sys.exit(1)
    return r.stdout


def main():
    if B.exists():
        shutil.rmtree(B)
    (B / "res" / "mipmap-xxxhdpi").mkdir(parents=True)
    (B / "classes").mkdir()
    (B / "gen").mkdir()
    www = B / "assets" / "www" / "app"
    shutil.copytree(ROOT / "app", www)
    shutil.copy(ROOT / "app" / "icon-192.png", B / "res" / "mipmap-xxxhdpi" / "ic_launcher.png")
    build = time.strftime("%Y%m%d-%H%M")
    code = int(time.time() // 60) - 29_000_000  # rises every minute: each build installs over the last

    run(BT / "aapt2.exe", "compile", "--dir", B / "res", "-o", B / "res.zip")
    run(BT / "aapt2.exe", "link", "-o", B / "base.apk", "-I", JAR, "--manifest", ROOT / "android" / "AndroidManifest.xml",
        "-R", B / "res.zip", "-A", B / "assets", "--java", B / "gen", "--auto-add-overlay",
        "--version-code", code, "--version-name", build, "--min-sdk-version", 24, "--target-sdk-version", 34,
        "-0", "song")
    srcs = list((ROOT / "android" / "src").rglob("*.java")) + list((B / "gen").rglob("*.java"))
    run(JDK / "bin" / "javac.exe", "--release", "11", "-nowarn", "-cp", JAR, "-d", B / "classes", *srcs)
    run(JDK / "bin" / "jar.exe", "cf", B / "classes.jar", "-C", B / "classes", ".")
    run(BT / "d8.bat", "--release", "--lib", JAR, "--min-api", 24, "--output", B, B / "classes.jar")
    shutil.copy(B / "base.apk", B / "unsigned.apk")
    with zipfile.ZipFile(B / "unsigned.apk", "a", zipfile.ZIP_DEFLATED) as z:
        z.write(B / "classes.dex", "classes.dex")
    run(BT / "zipalign.exe", "-f", "-p", 4, B / "unsigned.apk", B / "aligned.apk")

    if not KS.exists():
        KSPASS.write_text(secrets.token_urlsafe(18), encoding="utf-8")
        pw = KSPASS.read_text(encoding="utf-8").strip()
        run(JDK / "bin" / "keytool.exe", "-genkeypair", "-keystore", KS, "-alias", "pitchstar", "-keyalg", "RSA",
            "-keysize", 2048, "-validity", 10000, "-storepass", pw, "-keypass", pw, "-dname", "CN=Pitch Star")
        say(f"new signing key: {KS} (keep it, see the top of this script)")
    out = B / "PitchStar.apk"
    run(BT / "apksigner.bat", "sign", "--ks", KS, "--ks-pass", f"file:{KSPASS}", "--out", out, B / "aligned.apk")
    run(BT / "apksigner.bat", "verify", out)
    say(f"built {out.name} {build} (version code {code}), {out.stat().st_size / 1e6:.1f} MB")
    if DRIVE.exists():
        shutil.copy(out, DRIVE / "PitchStar.apk")
        say(f"copied to {DRIVE / 'PitchStar.apk'}")
    LOG.write_text("\n".join(log) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
