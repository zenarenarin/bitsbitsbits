import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]; cols=int(sys.argv[3]) if len(sys.argv)>3 else 10
fs = sorted(glob.glob(os.path.join(d,'*.jpg'))+glob.glob(os.path.join(d,'*.png')))
ims=[Image.open(f).convert('RGB') for f in fs]
w=max(i.width for i in ims); h=max(i.height for i in ims)
rows=(len(ims)+cols-1)//cols; pad=4; lab=16
S=Image.new('RGB',(cols*(w+pad)+pad, rows*(h+lab+pad)+pad),(30,30,30))
D=ImageDraw.Draw(S); F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',11) if os.path.exists('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf') else None
for k,(im,f) in enumerate(zip(ims,fs)):
    x=pad+(k%cols)*(w+pad); y=pad+(k//cols)*(h+lab+pad)
    S.paste(im,(x,y+lab)); D.text((x+2,y+2),os.path.basename(f)[:28],fill=(230,230,230),font=F)
S.save(out,quality=88)
