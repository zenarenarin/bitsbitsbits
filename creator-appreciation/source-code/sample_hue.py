import json,sys
from PIL import Image
import numpy as np
def board(path):
    im=np.asarray(Image.open(path).convert('RGB')).astype(int)
    h,w,_=im.shape
    # board region: rows/cols where pixels are not near-black bg (bg ~ (17,17,19))
    bright=(np.abs(im-im[h//2,5]).sum(2)>40)
    ys=np.where(bright[:, w//2])[0]; ys=ys[(ys>h*0.15)&(ys<h*0.8)]
    y0,y1=ys.min(),ys.max()
    xs=np.where(bright[(y0+y1)//2])[0]; x0,x1=xs.min(),xs.max()
    # find tile boundaries via colour change along middle row/col
    def edges(line):
        d=np.abs(np.diff(line,axis=0)).sum(1); return np.where(d>18)[0]
    row=im[(y0+y1)//2+3, x0:x1]; col=im[y0:y1, (x0+x1)//2+3]
    return im,(x0,y0,x1,y1)
def sample(path,cols,rows):
    im,(x0,y0,x1,y1)=board(path)
    tw=(x1-x0+1)/cols; th=(y1-y0+1)/rows; out=[]
    for r in range(rows):
        rr=[]
        for c in range(cols):
            cx=int(x0+(c+.5)*tw); cy=int(y0+(r+.5)*th)
            patch=im[cy-int(th*.3):cy-int(th*.12), cx-int(tw*.3):cx+int(tw*.3)].reshape(-1,3)
            col=np.median(patch,0).astype(int)
            centre=im[cy-2:cy+3,cx-2:cx+3].reshape(-1,3).mean(0)
            dot=bool(np.abs(centre-col).sum()>60)
            rr.append({'hex':'#%02x%02x%02x'%tuple(col),'fixed':dot})
        out.append(rr)
    return {'bbox':[int(x0),int(y0),int(x1),int(y1)],'cols':cols,'rows':rows,'tiles':out}
if __name__=='__main__':
    for p in sys.argv[1:]:
        im,bb=board(p); print(p,bb, 'w',bb[2]-bb[0],'h',bb[3]-bb[1])
