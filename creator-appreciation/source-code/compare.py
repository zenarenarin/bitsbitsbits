import sys
from PIL import Image, ImageDraw, ImageFont
F='fonts/'
fs=[('A','SORTED','../concepts/cover-a/cover-a.png'),('B','THE KING STANDS ALONE','../concepts/cover-b/cover-b.png'),('C','A LOOP CLOSED','../concepts/cover-c/cover-c.png')]
s=0.5; W=int(1080*s); H=int(1350*s); pad=48; top=96
S=Image.new('RGB',(pad+len(fs)*(W+pad), top+H+pad),(22,22,24)); D=ImageDraw.Draw(S)
try: f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',22)
except: f=ImageFont.load_default()
for i,(k,n,p) in enumerate(fs):
    x=pad+i*(W+pad); im=Image.open(p).convert('RGB').resize((W,H),Image.LANCZOS); S.paste(im,(x,top))
    D.text((x,top-44),f'COVER {k}  —  {n}',fill=(235,230,220),font=f)
S.save(sys.argv[1]); print(S.size)
