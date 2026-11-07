import sys,glob
from PIL import Image
d=sys.argv[1]; cols=int(sys.argv[2]) if len(sys.argv)>2 else 2; w=int(sys.argv[3]) if len(sys.argv)>3 else 960
fs=sorted(glob.glob(d+'/s*_*.png'),key=lambda f: (f.split('/')[-1].split('_')[0], float(f.split('_')[-1][:-4])))
h=w*9//16; ims=[Image.open(f).resize((w,h)) for f in fs]
rows=(len(ims)+cols-1)//cols
s=Image.new('RGB',(w*cols,h*rows),'white')
for i,im in enumerate(ims): s.paste(im,((i%cols)*w,(i//cols)*h))
s.save(d+'/sheet.png'); print(len(fs))
