# Draws the app icon from the same pixel grid as ui/sprites.js: the terracotta mochi on a sage tile.
import sys
from PIL import Image
MOCHI = ['....ooooo....','..oobbbbboo..','.obbbbbbbbbo.','.obbbbbbbbbo.','obbeebbbeebbo','obbeebbbeebbo',
         'obppbbbbbppbo','obbbbbbbbbbso','.obbbbbbbsso.','..oosssssoo..','....ooooo....']
EYES = {(3,4):'e',(4,4):'w',(3,5):'e',(4,5):'e',(8,4):'e',(9,4):'w',(8,5):'e',(9,5):'e'}
C = {'o':(58,34,24),'b':(217,119,87),'s':(184,92,62),'p':(244,154,171),'e':(58,34,24),'w':(255,255,255)}
W, H, S = 13, 11, 28
img = Image.new('RGBA', (512, 512), (166,193,114,255))
ox, oy = (512 - W*S)//2, (512 - H*S)//2 + 8
for y,row in enumerate(MOCHI):
    for x,ch in enumerate(row):
        ch = EYES.get((x,y), 'b' if ch == 'e' else ch)
        if ch == '.': continue
        img.paste(Image.new('RGBA',(S,S),C[ch]+(255,)), (ox+x*S, oy+y*S))
img.save(sys.argv[1])
