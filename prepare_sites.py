"""Build browser-sized site assets from the attached GeoTIFF surveys.

Run with Python plus Pillow and numpy. Original survey files are read only.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent
SURVEYS = ROOT.parent / 'Site Scan Data and Model Photos'


def metadata(image):
    tags = image.tag_v2
    sx, sy, _ = tags[33550]
    i, j, _, x, y, _ = tags[33922]
    keys = tags[34735]
    entries = {keys[k]: keys[k + 3] for k in range(4, len(keys), 4) if keys[k + 1] == 0}
    if entries.get(3072) != 32618:
        raise ValueError('Expected metre-based WGS84 / UTM zone 18N')
    west, north = x - i * sx, y + j * sy
    return west, north - image.height * sy, west + image.width * sx, north, sx, sy


def build():
    sites = []
    assets = ROOT / 'assets'
    assets.mkdir(exist_ok=True)
    for folder in sorted(SURVEYS.glob('*Site Scan Offload')):
        dtm_path = next(folder.glob('*DTM*.tiff'))
        ortho_path = next(folder.glob('*Orthomosaic.tiff'))
        name = folder.name.replace(' Site Scan Offload', '')
        slug = {'Spring Run Presbyterian Church': 'spring-run', 'Williams Island Dam': 'williams-island', 'Z Dam': 'z-dam'}[name]
        with Image.open(dtm_path) as dtm:
            dw, ds, de, dn, dx, dy = metadata(dtm)
            terrain = np.asarray(dtm)
            nodata = float(dtm.tag_v2.get(42113, '-10000'))
        with Image.open(ortho_path) as ortho:
            west, south, east, north, _, _ = metadata(ortho)
            ortho_ratio = ortho.width / ortho.height
        with Image.open(next(folder.glob('*.preview.png'))) as preview:
            if abs(preview.width / preview.height / ortho_ratio - 1) > 0.01:
                raise ValueError(f'Preview aspect ratio differs from orthomosaic: {name}')
            preview.thumbnail((1600, 1600))
            preview.convert('RGBA').save(assets / (slug + '.png'))
        n = 51
        elevations = []
        for row in range(n):
            y = south + row / (n - 1) * (north - south)
            for col in range(n):
                x = west + col / (n - 1) * (east - west)
                ix, iy = int((x - dw) / dx), int((dn - y) / dy)
                z = float(terrain[iy, ix]) if dw <= x < de and ds < y <= dn and 0 <= ix < terrain.shape[1] and 0 <= iy < terrain.shape[0] else nodata
                elevations.append(round(z, 4) if np.isfinite(z) and z != nodata else None)
        valid = [z for z in elevations if z is not None]
        if not valid:
            raise ValueError(f'No valid terrain samples for {name}')
        sites.append(dict(id=slug, name=name, width=east-west, height=north-south,
                          west=west, south=south, crs='EPSG:32618', verticalDatum='EGM96',
                          gridSize=n, elevations=elevations, groundReference=float(np.median(valid)),
                          image='assets/' + slug + '.png', terrainSource=dtm_path.name,
                          imageSource=ortho_path.name))
    (ROOT / 'sites.js').write_text('window.SURVEY_SITES = ' + json.dumps(sites, allow_nan=False) + ';\n', encoding='utf-8')
    print(json.dumps([{k: s[k] for k in ('name', 'width', 'height', 'groundReference')} for s in sites], indent=2))


if __name__ == '__main__':
    build()
