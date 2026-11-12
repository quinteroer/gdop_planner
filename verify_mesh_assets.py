"""Validate committed mesh buffers and their survey coordinate references."""
import json
import math
from pathlib import Path
import struct

root=Path(__file__).resolve().parent
raw=(root/'sites.js').read_text(encoding='utf-8')
sites=json.loads(raw[raw.index('['):].strip().rstrip(';'))
for site in sites:
    path=root/site['sceneMesh']
    manifest=json.loads(path.read_text(encoding='utf-8'))
    assert manifest['crs']==site['crs']
    assert manifest['verticalDatum']==site['verticalDatum']
    assert manifest['origin']==[site['west'],site['south'],0]
    count=0
    lo=[math.inf]*3
    hi=[-math.inf]*3
    for part in manifest['parts']:
        data=(path.parent/part['geometry']).read_bytes()
        assert len(data)==part['vertices']*20
        assert part['vertices']%3==0
        assert (path.parent/part['texture']).read_bytes().startswith(b'\xff\xd8')
        for x,y,z,u,v in struct.iter_unpack('<5f',data):
            assert all(math.isfinite(n) for n in (x,y,z,u,v))
            # Original I3S atlases include a small amount of edge bleed.
            assert -.05<=u<=1.05 and -.05<=v<=1.05
            for j,value in enumerate((x,y,z)):
                lo[j]=min(lo[j],value);hi[j]=max(hi[j],value)
        count+=part['vertices']
    assert count==manifest['vertices']
    assert all(abs(a-b)<.001 for expected,actual in zip(manifest['bounds'],(lo,hi)) for a,b in zip(expected,actual))
    print(site['id'],count//3,'triangles: finite positions/UVs, datum, origin, texture and bounds checks passed.')
