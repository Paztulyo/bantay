# Writes js/lang/tl.js and js/lang/ilo.js from strings_*.py and patterns.py, plus review.csv (English, Tagalog,
# Ilocano side by side) for a native speaker to check. Run from anywhere: python3 i18n/gen.py
import json, csv, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from strings_a import A
from strings_b import B
from strings_c import C, CAL
from patterns import P, EXTRA
OUT = os.path.join(os.path.dirname(HERE), 'js', 'lang') + os.sep
rows = A + B + C + EXTRA
seen, problems = {}, []
for en, tl, ilo in rows:
    if en in seen and seen[en] != (tl, ilo): problems.append(f'conflict: {en!r}: {seen[en]} vs {(tl, ilo)}')
    seen[en] = (tl, ilo)
    for x in (tl, ilo):
        if '—' in x and '—' not in en: problems.append(f'em dash added: {en!r}')
        if '{' in en and any(v not in x for v in __import__('re').findall(r'\{\w+\}', en)): problems.append(f'placeholder lost: {en!r} -> {x!r}')
EN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
EN_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
EN_DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
EN_DY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
NAME = {'tl': 'Tagalog', 'ilo': 'Ilocano'}
HEAD = {lang: (
 f"// {name} for Bantay El Niño, used by js/i18n.js. Made by i18n/gen.py from i18n/strings_*.py and i18n/patterns.py:\n"
 "// edit those and run python3 i18n/gen.py, not this file. Each key is the English exactly as the site shows it.\n"
 "// Names of agencies, towns and sources, and PAGASA's dry-stage and alert names, stay in English so they match the\n"
 "// official advisories. A string missing here shows in English.\n") for lang, name in (('tl', 'Tagalog'), ('ilo', 'Ilocano'))}
for li, lang in ((0, 'tl'), (1, 'ilo')):
    cal = CAL[lang]
    phrases = {}
    for i, m in enumerate(EN_MONTHS): phrases[m] = cal['months'][i]
    for i, m in enumerate(EN_MON): phrases.setdefault(m, cal['mon'][i])
    for i, d in enumerate(EN_DAYS): phrases[d] = cal['days'][i]
    for i, d in enumerate(EN_DY): phrases[d] = cal['dy'][i]
    for en, (tl, ilo) in seen.items(): phrases[en] = (tl, ilo)[li]
    js = [HEAD[lang], 'export default {']
    for k in ('months', 'mon', 'days', 'dy'): js.append(f'  {k}: {json.dumps(cal[k], ensure_ascii=False)},')
    js.append('  phrases: {')
    for en, v in phrases.items(): js.append(f'    {json.dumps(en, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},')
    js.append('  },')
    js.append('  // strings with numbers, dates or names in them: $1.. is the captured piece, translated when it is a known phrase')
    js.append('  patterns: [')
    for rx, tl, ilo in P:
        v = (tl, ilo)[li]
        js.append(f'    [{rx}, {v[3:] if v.startswith("fn:") else json.dumps(v, ensure_ascii=False)}],')
    js.append('  ],')
    js.append('};')
    open(OUT + lang + '.js', 'w').write('\n'.join(js) + '\n')
    print(lang, 'phrases:', len(phrases), 'patterns:', len(P), 'bytes:', len('\n'.join(js).encode()))
# where each line shows, from the "# ---- section" comments in the strings files
import ast
where = {}
for fn in ('strings_a.py', 'strings_b.py', 'strings_c.py', 'patterns.py'):
    src = open(os.path.join(HERE, fn)).read()
    lines = [l.strip() for l in src.split('\n')]
    note = lambda i: lines[i].startswith('#') if 0 <= i < len(lines) else False
    # a "# ---- section" line, or a one-line comment standing alone, names what follows
    marks = [(i + 1, re.split(r'[:;(]', l.lstrip('# -'))[0].strip()) for i, l in enumerate(lines)
             if l.startswith('# ----') or (l.startswith('# ') and not note(i - 1) and not note(i + 1))]
    marks = [(ln, m[:1].upper() + m[1:]) for ln, m in marks]
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Tuple) and len(node.elts) == 3 and isinstance(node.elts[0], ast.Constant):
            before = [m for ln, m in marks if ln < node.lineno]
            where.setdefault(node.elts[0].value, before[-1] if before else '')
def readable(rx):
    # a pattern's English as a reviewer reads it: each captured piece becomes $1, $2.., optional parts go in [ ]
    body = re.match(r'^/(.*)/[a-z]*$', rx, re.S).group(1)
    out, n, i, groups = [], 0, 0, []
    def quant(j):  # skip a quantifier after a group or a character
        if j < len(body) and body[j] == '{': return body.index('}', j) + 1
        return j + 1 if j < len(body) and body[j] in '?*+' else j
    while i < len(body):
        c = body[i]
        if c == '\\': out.append(body[i + 1] if body[i + 1] not in 'dws' else '…'); i = quant(i + 2); continue
        if c == '(' and body.startswith('(?:', i): groups.append(len(out)); out.append('['); i += 3; continue
        if c == '(':
            n += 1; out.append(f'${n}'); depth, i = 1, i + 1
            while depth:
                if body[i] == '\\': i += 2; continue
                if body[i] == '(': depth += 1; n += not body.startswith('(?', i)
                elif body[i] == ')': depth -= 1
                i += 1
            i = quant(i); continue
        if c == ')': groups.pop(); out.append(']'); i = quant(i + 1); continue
        if c == '[': i = quant(body.index(']', i + 1) + 1); out.append('…'); continue
        if c == '|': out.append(' / '); i += 1; continue
        if c in '^$': i += 1; continue
        out.append(c); i += 1
        if i < len(body) and body[i] == '?': i += 1  # "days?" reads as "days"
    return ''.join(out)
with open(os.path.join(HERE, 'review.csv'), 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['Where it shows', 'English', 'Tagalog', 'Ilocano'])
    for en, (tl, ilo) in seen.items(): w.writerow([where.get(en, ''), en, tl, ilo])
    w.writerow(['Lines with numbers, dates or names: the site fills in $1, $2.. A line starting with fn: is built in code, read its quoted words', '', '', ''])
    for rx, tl, ilo in P: w.writerow([where.get(rx, ''), readable(rx), tl, ilo])
print('\n'.join(problems) or 'no problems')
