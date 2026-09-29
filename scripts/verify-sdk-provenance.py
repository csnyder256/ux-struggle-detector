from pathlib import Path
import json,hashlib,subprocess
root=Path(__file__).resolve().parents[1];out=root/'dist-sdk'
m=json.loads((out/'sdk-provenance.json').read_text());v=(root/'VERSION').read_text().strip()
assert m['package']=='@csnyder256/ux-struggle-sdk' and m['version']==v
assert m['filename']=='csnyder256-ux-struggle-sdk-'+v+'.tgz'
assert m['source_sha']==subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
assert m['sha256']==hashlib.sha256((out/m['filename']).read_bytes()).hexdigest()
if (out/'checksums.txt').exists():
 lines=dict((name,digest) for digest,name in (line.split('  ',1) for line in (out/'checksums.txt').read_text().splitlines()))
 for f in [m['filename'],'sdk-provenance.json']:assert lines[f]==hashlib.sha256((out/f).read_bytes()).hexdigest()
print('SDK package source and SHA-256 provenance verified')
