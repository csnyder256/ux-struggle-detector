"""Exercise the documented fresh-install Compose sequence with private throwaway values."""
import base64, os, secrets, subprocess, time, urllib.request, uuid
from pathlib import Path
root = Path(__file__).resolve().parents[1]
name = "release-smoke-" + uuid.uuid4().hex[:12]
env = {**os.environ, "POSTGRES_PASSWORD": secrets.token_hex(32), "AUTH_SECRET": base64.b64encode(secrets.token_bytes(32)).decode(), "KEY_ENCRYPTION_KEY": base64.b64encode(secrets.token_bytes(32)).decode(), "CLARUS_PORT": "39042", "AUTH_URL": "http://localhost:39042"}
compose = ["docker", "compose", "-p", name, "-f", "compose.yml"]
def run(args, check=True):
    return subprocess.run(args, cwd=root, env=env, check=check)
try:
    run(compose + ["up", "-d", "db"])
    run(compose + ["--profile", "setup", "run", "--rm", "setup"])
    run(compose + ["up", "-d", "app"])
    for attempt in range(60):
        try:
            with urllib.request.urlopen("http://localhost:39042/", timeout=3) as r:
                assert r.status == 200
                assert b'sign' in r.read().lower()
            break
        except OSError: time.sleep(1)
    else: raise RuntimeError("Authenticated app failed to start")
    cid = subprocess.check_output(compose + ["ps", "-q", "app"], cwd=root, env=env, text=True).strip()
    run(["docker", "exec", cid, "node", "-e", "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({headless:true,args:['--no-sandbox']});const p=await b.newPage();await p.setContent('<title>offline</title>');if(await p.title()!=='offline')throw Error('title');await b.close()})().catch(()=>process.exit(1))"])
    print("Fresh database setup, authenticated startup and Chromium verified")
finally:
    run(compose + ["--profile", "setup", "down", "-v", "--remove-orphans"], check=False)
