"""Build aligned surface grids and conservative GCP placement screening.

The source DSM minus DTM measures raised cover. Inspect the full-resolution
2.5 m neighbourhood of each planning sample. Raised cover over 1 m or unknown
raster cells make a target ineligible. No original raster is modified.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image
from prepare_sites import metadata

ROOT=Path(__file__).resolve().parent
Image.MAX_IMAGE_PIXELS=None


def build():
    raw=(ROOT/'sites.js').read_text(encoding='utf-8')
    sites=json.loads(raw[raw.index('['):].strip().rstrip(';'))
    for site in sites:
        folder=next(p for p in (ROOT.parent/'Site Scan Data and Model Photos').glob('*Site Scan Offload') if (p/site['terrainSource']).exists())
        with Image.open(folder/site['terrainSource']) as image:
            dtm=np.array(image);dtm_bounds=metadata(image);dtm_missing=float(image.tag_v2.get(42113,'-10000'))
        with Image.open(next(folder.glob('*DSM.tiff'))) as image:
            dsm=np.array(image);dsm_bounds=metadata(image);dsm_missing=float(image.tag_v2.get(42113,'-10000'))
        dw,ds,de,dn,dx,dy=dtm_bounds
        sw,ss,se,sn,sx,sy=dsm_bounds
        def valid(values,missing):
            return np.isfinite(values)&(values!=missing)
        n=site['gridSize'];allowed=[];reasons=[]
        for row in range(n):
            for col in range(n):
                x=site['west']+col/(n-1)*site['width'];y=site['south']+row/(n-1)*site['height']
                if site['elevations'][row*n+col] is None:
                    allowed.append(False);reasons.append('unknown_ground');continue
                radius=2.5
                c0=int(np.floor((x-radius-sw)/sx));c1=int(np.ceil((x+radius-sw)/sx))
                r0=int(np.floor((sn-y-radius)/sy));r1=int(np.ceil((sn-y+radius)/sy))
                if c0<0 or r0<0 or c1>=dsm.shape[1] or r1>=dsm.shape[0]:
                    allowed.append(False);reasons.append('unknown_surface');continue
                cols=np.arange(c0,c1+1);rows=np.arange(r0,r1+1)
                xx=sw+(cols+.5)*sx;yy=sn-(rows+.5)*sy
                disc=(xx[None,:]-x)**2+(yy[:,None]-y)**2<=radius**2
                dc=np.floor((xx-dw)/dx).astype(int);dr=np.floor((dn-yy)/dy).astype(int)
                if dc.min()<0 or dc.max()>=dtm.shape[1] or dr.min()<0 or dr.max()>=dtm.shape[0]:
                    allowed.append(False);reasons.append('unknown_ground');continue
                ground=dtm[np.ix_(dr,dc)];surface=dsm[r0:r1+1,c0:c1+1]
                known=valid(ground,dtm_missing)&valid(surface,dsm_missing)
                if not known[disc].all():
                    allowed.append(False);reasons.append('unknown_surface');continue
                raised=bool(np.any((surface-ground)[disc]>1.0))
                allowed.append(not raised);reasons.append('raised_cover' if raised else 'open_ground')
        # A local maximum surface preserves small raised features better than a
        # single pixel when preparing the separate line-of-sight height field.
        size=151;elevations=[]
        half_x=site['width']/(size-1)/2;half_y=site['height']/(size-1)/2
        for row in range(size):
            y=site['south']+row/(size-1)*site['height']
            for col in range(size):
                x=site['west']+col/(size-1)*site['width']
                c0=max(0,int((x-half_x-sw)/sx));c1=min(dsm.shape[1],int((x+half_x-sw)/sx)+1)
                r0=max(0,int((sn-y-half_y)/sy));r1=min(dsm.shape[0],int((sn-y+half_y)/sy)+1)
                patch=dsm[r0:r1,c0:c1]
                known=valid(patch,dsm_missing)
                elevations.append(round(float(patch[known].max()),4) if patch.size and known.all() else None)
        site['gcpPlacement']={'allowed':allowed,'reasons':reasons,'bufferM':2.5,'maxRaisedHeightM':1.0,
                              'method':'Full-resolution DSM minus DTM neighbourhood screening'}
        site['surfaceGrid']={'gridSize':size,'elevations':elevations}
        print(site['id'],sum(allowed),'eligible of',sum(z is not None for z in site['elevations']),'ground samples',flush=True)
        del dtm,dsm
    (ROOT/'sites.js').write_text('window.SURVEY_SITES = '+json.dumps(sites,allow_nan=False)+';\n',encoding='utf-8')


if __name__=='__main__':
    build()
