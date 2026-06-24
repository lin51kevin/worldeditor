import re, io, sys

with io.open(sys.argv[1], 'r', encoding='utf-8') as f:
    content = f.read()

road_pat = re.compile(
    r'<road\b[^>]*\bid="([^"]+)"[^>]*\blength="([^"]+)"[^>]*>.*?</road>',
    re.DOTALL
)
cw_pat = re.compile(
    r'<object\b[^>]*\btype="crosswalk"[^>]*\bs="([^"]+)"[^>]*\bid="([^"]+)"'
)

print("road         road_len        cw_id        cw_s         overshoot")
print("-" * 70)
for rm in road_pat.finditer(content):
    rl = float(rm.group(2))
    rid = rm.group(1)
    for cw in cw_pat.finditer(rm.group(0)):
        cs = float(cw.group(1))
        cid = cw.group(2)
        ov = cs - rl
        flag = " *** OVERSHOOT" if ov > 0.5 else (" minor" if ov > 0.01 else "")
        print("road=%-10s len=%10.4f  cw=%-10s s=%12.4f  ov=%10.4f%s" % (
            rid, rl, cid, cs, ov, flag))
