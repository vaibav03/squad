"""Render typography specimens on the night palette. Needs candidate TTFs in a scratch dir (arg 1) ; see docs/design/typography.md."""
import sys, os
from PIL import Image, ImageDraw, ImageFont
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE,"../../../assets/pixel/composed/scripts"))
from palette import RGB
SCR=sys.argv[1] if len(sys.argv)>1 else "."
FONTS=os.path.join(HERE,"../../../assets/fonts")
STR=["Council Hall","Waiting for your yes","Ch5 Expert · in a call","Q2 of 5","Join call","Left Mid Right Zoom","Calm mode","Replay","Live","shared: Tue 2-4 pm","Mira says she can meet after the call at noon.","0123456789 ÀÉÎÕÜ çñß","! ? . , ; : ' \" ( ) - + / %"]
assert len("Mira says she can meet after the call at noon.")<=60
def font(path,size,wght=None):
    f=ImageFont.truetype(path,size)
    if wght: f.set_variation_by_axes([wght])
    return f
def sheet(name,path,sizes,wght=None,scale=3,upper=False):
    rows=[]
    for s in sizes:
        f=font(path,s,wght)
        lh=int(s*1.5)+2
        W=280
        img=Image.new("RGB",(W,lh*len(STR)+14),RGB["sky-deep"])
        d=ImageDraw.Draw(img); d.fontmode="1"
        d.text((2,0),f"{os.path.basename(path)[:18]} @{s}px w{wght}",font=ImageFont.truetype(os.path.join(SCR,"ttf/Silkscreen-Regular.ttf"),8),fill=RGB["cloud-lo"])
        y=12
        for i,t in enumerate(STR):
            if i%2==0:
                d.text((4,y),t,font=f,fill=RGB["moon"])
            else:
                w=int(d.textlength(t,font=f))+8
                d.rounded_rectangle((2,y-2,2+w,y+s+3),radius=3,fill=RGB["wall-lit"],outline=RGB["ink"])
                d.text((6,y),t,font=f,fill=RGB["ink"])
            y+=lh
        rows.append(img)
    out=Image.new("RGB",(sum(r.width for r in rows),max(r.height for r in rows)),RGB["sky-deep"])
    x=0
    for r in rows: out.paste(r,(x,0)); x+=r.width
    out=out.resize((out.width*scale,out.height*scale),Image.NEAREST)
    out.save(os.path.join(HERE,name)); print(name,out.size)
T=lambda n:os.path.join(SCR,"ttf",n)
sheet("pixelify-sans.png",T("PixelifySans%5Bwght%5D.ttf"),[12,16,24],wght=400,scale=2)
sheet("silkscreen.png",T("Silkscreen-Regular.ttf"),[8,16],scale=3)
sheet("jersey10.png",T("Jersey10-Regular.ttf"),[28/3,56/3,28],scale=2)
sheet("vt323.png",T("VT323-Regular.ttf"),[16,32],scale=2)
sheet("micro5.png",T("Micro5-Regular.ttf"),[11,22],scale=3)
sheet("ninja-adventure.png",T("Ninja.ttf"),[9,18],scale=3)

def pairing():
    A=os.path.join(FONTS,"jersey-10/Jersey10-Regular.ttf"); S=os.path.join(FONTS,"silkscreen/Silkscreen-Regular.ttf")
    I=os.path.join(FONTS,"inter/InterVariable.ttf")
    img=Image.new("RGB",(300,200),RGB["sky-deep"]); d=ImageDraw.Draw(img); d.fontmode="1"
    j=lambda s:ImageFont.truetype(A,s)
    def inter(s,w):
        f=ImageFont.truetype(I,s)
        try: f.set_variation_by_axes([14,w])
        except Exception: pass
        return f
    d.text((8,6),"Council Hall",font=j(56/3),fill=RGB["moon"])
    d.rounded_rectangle((8,32,150,56),radius=3,fill=RGB["wall-lit"],outline=RGB["ink"])
    d.text((13,36),"Waiting for your yes",font=j(56/3),fill=RGB["ink"])
    d.rounded_rectangle((160,36,196,50),radius=2,fill=RGB["ok"],outline=RGB["ink"])
    d.text((165,39),"LIVE",font=ImageFont.truetype(S,8),fill=RGB["ink"])
    d.text((202,40),"Q2 of 5",font=j(28/3*2),fill=RGB["glow"])
    d.rounded_rectangle((8,68,292,196),radius=4,fill=RGB["ground"],outline=RGB["wall-shade"])
    d.text((16,74),"Ledger",font=inter(14,650),fill=RGB["moon"])
    d.text((16,94),"Mira says she can meet after the call at noon,",font=inter(12,400),fill=RGB["cloud-hi"])
    d.text((16,110),"so I moved your Tue 2-4 pm block to Thursday.",font=inter(12,400),fill=RGB["cloud-hi"])
    d.text((16,130),"shared: Tue 2-4 pm",font=inter(11,500),fill=RGB["cloud-lo"])
    d.rounded_rectangle((16,152,86,176),radius=5,fill=RGB["glow"],outline=RGB["ink"])
    d.text((28,156),"Join call",font=inter(13,600),fill=RGB["ink"])
    d.text((100,158),"Calm mode",font=inter(13,500),fill=RGB["cloud-hi"])
    img=img.resize((900,600),Image.NEAREST); img.save(os.path.join(HERE,"pairing-3x.png"))
pairing()
