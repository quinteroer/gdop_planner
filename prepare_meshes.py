"""Extract a bounded LOD cut of the original I3S mesh for browser display.

Build dependencies: numpy, Pillow, pyproj. Original SLPK/TIFF files are read-only.
I3S positions are offsets from each node's geographic OBB centre. Convert XY
from WGS84 to UTM 18N and retain the source EGM96 metre heights and UVs.
Spec: https://github.com/Esri/i3s-spec/blob/master/docs/1.10/geometryBuffer.cmn.md
"""
import gzip
import io
import json
from pathlib import Path
import struct
import zipfile
import numpy as np
from PIL import Image
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent


def read_json(archive, name):
    return json.loads(gzip.decompress(archive.read(name)))


def select_nodes(nodes, budget):
    selected = {0}
    count = lambda i: nodes[i].get('mesh', {}).get('geometry', {}).get('vertexCount', 0)
    while True:
        total = sum(count(i) for i in selected)
        choices = [i for i in selected if nodes[i].get('children') and
                   total-count(i)+sum(count(j) for j in nodes[i]['children']) <= budget]
        if not choices:
            break
        node = max(choices, key=lambda i: np.prod(sorted(nodes[i]['obb']['halfSize'])[-2:]))
        selected.remove(node)
        selected.update(nodes[node]['children'])
    return sorted(i for i in selected if count(i))


def build(vertex_budget=250000):
    source = ROOT.parent / 'Site Scan Data and Model Photos'
    raw = (ROOT/'sites.js').read_text(encoding='utf-8')
    sites = json.loads(raw[raw.index('['):].strip().rstrip(';'))
    transform = Transformer.from_crs(4326, 32618, always_xy=True)
    for site in sites:
        folder = next(p for p in source.glob('*Site Scan Offload') if (p/site['terrainSource']).exists())
        package = next(folder.glob('*.slpk'))
        destination = ROOT/'assets'/'meshes'/site['id']
        destination.mkdir(parents=True, exist_ok=True)
        parts = []
        bounds = np.array([[np.inf]*3, [-np.inf]*3])
        with zipfile.ZipFile(package) as archive:
            layer = read_json(archive, '3dSceneLayer.json.gz')
            if layer['spatialReference']['wkid'] != 4326:
                raise ValueError('Expected geographic WGS84 I3S vertices')
            if layer['spatialReference'].get('vcsWkid') != 5773 or layer.get('heightModelInfo',{}).get('heightUnit') != 'meter':
                raise ValueError('Expected EGM96 metre heights; vertical transformation is required for other datums')
            buffer = layer['geometryDefinitions'][0]['geometryBuffers'][0]
            if buffer.get('offset') != 8 or buffer['position'] != {'component':3,'type':'Float32'} or buffer['uv0'] != {'component':2,'type':'Float32'}:
                raise ValueError('Unsupported I3S geometry layout')
            nodes = {n['index']:n for name in archive.namelist() if name.startswith('nodepages/')
                     for n in read_json(archive, name)['nodes']}
            selected = select_nodes(nodes, vertex_budget)
            for index in selected:
                node = nodes[index]
                mesh = node['mesh']
                resource = mesh['geometry']['resource']
                data = gzip.decompress(archive.read(f'nodes/{resource}/geometries/0.bin.gz'))
                count, _ = struct.unpack_from('<II', data)
                if count != mesh['geometry']['vertexCount'] or count % 3:
                    raise ValueError('Invalid triangle vertex count')
                positions = np.frombuffer(data, dtype='<f4', count=count*3, offset=8).reshape(-1,3).astype('float64')
                uv = np.frombuffer(data, dtype='<f4', count=count*2, offset=8+count*12).reshape(-1,2)
                positions += node['obb']['center']
                east, north = transform.transform(positions[:,0], positions[:,1])
                local = np.column_stack([east-site['west'], north-site['south'], positions[:,2]])
                if not np.isfinite(local).all() or not np.isfinite(uv).all():
                    raise ValueError('Non-finite source mesh coordinates')
                # Regression guard: forward/inverse projection must preserve XY.
                lon, lat = transform.transform(east, north, direction='INVERSE')
                if max(np.max(np.abs(lon-positions[:,0])),np.max(np.abs(lat-positions[:,1]))) > 1e-8:
                    raise ValueError('Mesh projection round-trip failed')
                bounds[0] = np.minimum(bounds[0],local.min(axis=0))
                bounds[1] = np.maximum(bounds[1],local.max(axis=0))
                geometry = f'node-{index}.bin'
                texture = f'node-{index}.jpg'
                packed = np.column_stack([local,uv]).astype('<f4')
                (destination/geometry).write_bytes(packed.tobytes())
                material = mesh['material']['resource']
                with Image.open(io.BytesIO(archive.read(f'nodes/{material}/textures/0.jpg'))) as image:
                    image.thumbnail((1024,1024))
                    image.convert('RGB').save(destination/texture,quality=90)
                parts.append(dict(geometry=geometry, texture=texture, vertices=count))
            if not parts:
                raise ValueError('No mesh geometry selected')
        manifest = dict(version=1,source=package.name,crs='EPSG:32618',verticalDatum='EGM96',
                        origin=[site['west'],site['south'],0],bounds=bounds.tolist(),
                        vertices=sum(part['vertices'] for part in parts),parts=parts)
        (destination/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
        site['sceneMesh']=f"assets/meshes/{site['id']}/manifest.json"
        print(site['id'],len(parts),'tiles',manifest['vertices']//3,'triangles',
              round(sum((destination/p).stat().st_size for part in parts for p in (part['geometry'],part['texture']))/1e6,1),'MB',flush=True)
    (ROOT/'sites.js').write_text('window.SURVEY_SITES = '+json.dumps(sites,allow_nan=False)+';\n',encoding='utf-8')


if __name__=='__main__':
    build()
