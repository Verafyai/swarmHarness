"""Build harness.verafy.ai.

    python3 site/build.py        (needs: pip install markdown)

Writes site/index.html from site/src/, and site/run.html, site/testnet.html and
site/coin-agnostic.html from the guides in docs/. Run it after any change to
those guides, and commit the output: Vercel serves site/ as static files with
no build step.
"""
import html as H
import pathlib
import re

import markdown

SITE = pathlib.Path(__file__).resolve().parent
REPO = SITE.parent
SRC = SITE / 'src'
GH = 'https://github.com/Verafyai/verafyHarness/blob/main/'
HOST = 'https://harness.verafy.ai'

MARK = ('<svg class="mark" viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">'
        '<path d="M6 20V6h14M44 6h14v14M58 44v14H44M20 58H6V44" stroke="currentColor" stroke-width="5" stroke-linecap="square" fill="none"/>'
        '<path d="M32 13v7M32 44v7M13 32h7M44 32h7" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>'
        '<circle cx="32" cy="32" r="11" fill="var(--accent)"/><circle cx="32" cy="32" r="4" fill="var(--paper)"/></svg>')

TABS = [
    ('https://chain.verafy.ai', 'Verafy Chain'),
    ('https://chain.verafy.ai/constitution', 'Constitution'),
    ('/', 'Verafy Harness'),
    ('/run', 'Run a harness'),
    ('/testnet', 'Testnet'),
    ('/coin-agnostic', 'Coin Agnostic'),
    ('/economics', 'Economics'),
    ('https://asc.verafy.ai', 'Actually Smart Contracts'),
    ('https://github.com/Verafyai/verafyHarness', 'GitHub'),
    ('https://chain.verafy.ai/#roadmap', 'Roadmap'),
]

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800'
         '&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">')

COINFREE = '''<section class="coinfree" aria-labelledby="coinfreeH">
  <div class="wrap">
    <h2 id="coinfreeH">Coin-free guarantee.</h2>
    <p>There is no coin, and Verafy Harness will never need one. A harness is paid in whatever token a contract offers and pays its own AI and hosting bills from that. No presale, no airdrop, no points, no treasury. <a href="/coin-agnostic">How payment works</a></p>
  </div>
</section>'''

FOOT = f'''<footer class="wrap foot">
  <p>Verafy Harness is the validator for Verafy Chain, a Verafy research concept. It is a prototype, not a running network, and there is no token.</p>
  <p>Code: <a href="https://github.com/Verafyai/verafyHarness">Verafyai/verafyHarness</a>, MIT, built on <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>. The concept: <a href="https://chain.verafy.ai">chain.verafy.ai</a>.</p>
</footer>'''


def head(title, desc, path, css):
    url = HOST + path
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{H.escape(title)}</title>
<meta name="description" content="{H.escape(desc)}">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Verafy Harness">
<meta property="og:title" content="{H.escape(title)}">
<meta property="og:description" content="{H.escape(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{HOST}/banner.png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{HOST}/banner.png">
{FONTS}
<style>
{css}
</style>
</head>
<body>
'''


def header(current):
    links = []
    for href, label in TABS:
        cur = ' aria-current="page"' if label == current else ''
        links.append(f'    <a href="{href}"{cur}>{label}</a>')
    return (f'''<header class="wrap top">
  <a class="brand" href="/">{MARK}Verafy Harness</a>
  <nav class="tabs" aria-label="Verafy Chain and Verafy Harness">
''' + '\n'.join(links) + '''
  </nav>
  <span class="status">Prototype. Not a running network.</span>
</header>
''')


def check(name, text):
    low = text.lower()
    # The names from before the rename, with or without a space. Planned commands
    # are written `verafy harness ...`; nothing should still say the old names.
    old = re.search(r'swarm\s?(chain|harness|testnet)', low)
    assert not old, f'{name}: still says "{old.group(0) if old else ""}"'
    assert '\u2014' not in text and '\u2013' not in text, f'{name}: em or en dash'


LANDING_EXTRA = '''
.hero-lead{font-size:20px;max-width:38em}
.cta{display:flex;flex-wrap:wrap;gap:10px}
.cta .btn{text-decoration:none;display:inline-block}
.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-top:12px;max-width:1040px}
@media (max-width:760px){.facts{grid-template-columns:minmax(0,1fr)}}
.fact{border-top:2px solid var(--ink);padding-top:12px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.fact .big{font-family:var(--display);font-weight:800;font-stretch:80%;font-size:40px;line-height:1;color:var(--accent)}
.fact p{font-size:16.5px;color:var(--mute)}
pre{background:var(--sheet);border:1px solid var(--rule);border-radius:3px;padding:14px 16px;overflow-x:auto;font-size:14px;line-height:1.55;margin:0}
code{font-family:var(--mono);font-size:.88em}
pre code{font-size:inherit}
td code{background:var(--paper);padding:1px 5px;border-radius:2px}
a.card.go{text-decoration:none;color:var(--ink)}
a.card.go:hover{border-color:var(--accent)}
a.card.go h3{color:var(--accent)}
.col .tag{align-self:flex-start}
'''


def landing():
    css = (SRC / 'landing.css').read_text() + LANDING_EXTRA
    body = (SRC / 'landing.html').read_text().replace('@@FIGURE@@', (SRC / 'harness-figure.html').read_text().rstrip())
    out = (head('Verafy Harness', 'An AI validator anyone can run: one model in a harness that rules on contracts written in words, holds its own keys and pays its own bills. No token.', '/', css)
           + COINFREE + '\n' + header('Verafy Harness') + '\n<main class="wrap">\n' + body + '</main>\n\n' + FOOT + '\n</body>\n</html>\n')
    check('index.html', out)
    (SITE / 'index.html').write_text(out)


DOC_CSS = r'''
:root{--paper:#EDF0F3;--sheet:#FFFFFF;--ink:#16212C;--mute:#566473;--rule:#CDD5DD;--accent:#3640C9;--accent-soft:#DADDF7;--allow:#1C7A4E;--hold:#A0561A;--code:#F4F6F8;
--display:"Archivo","Helvetica Neue",Arial,sans-serif;--body:"Source Serif 4",Georgia,serif;--mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--paper:#0F151B;--sheet:#161E26;--ink:#E4EAF0;--mute:#93A1AF;--rule:#2A3541;--accent:#8A92FF;--accent-soft:#252A55;--allow:#5CC995;--hold:#E0A060;--code:#1B242E;color-scheme:dark}}
:root[data-theme="dark"]{--paper:#0F151B;--sheet:#161E26;--ink:#E4EAF0;--mute:#93A1AF;--rule:#2A3541;--accent:#8A92FF;--accent-soft:#252A55;--allow:#5CC995;--hold:#E0A060;--code:#1B242E;color-scheme:dark}
*{box-sizing:border-box}body{background:var(--paper);color:var(--ink);font-family:var(--body);font-size:17.5px;line-height:1.6;margin:0}
a{color:var(--accent);text-underline-offset:3px}
a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
img{max-width:100%;height:auto}
.wrap{max-width:1240px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.coinfree{background:var(--sheet);border-top:3px solid var(--accent);border-bottom:1px solid var(--rule)}
.coinfree .wrap{padding-block:18px 20px;display:flex;flex-direction:column;gap:6px}
.coinfree h2{font-family:var(--display);font-weight:750;font-size:clamp(22px,2.4vw,28px);margin:0}
.coinfree p{max-width:46em;margin:0;overflow-wrap:break-word}
.top{display:flex;align-items:center;gap:16px;padding-block:20px;border-bottom:1px solid var(--rule);flex-wrap:wrap}
.brand{font-family:var(--display);font-weight:800;font-size:20px;font-stretch:110%;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;gap:10px}
.brand .mark{color:var(--ink);flex:none}
.tabs{display:flex;flex-wrap:wrap;gap:4px;margin-right:auto;margin-left:12px}
.tabs a{font-family:var(--display);font-weight:600;font-size:15px;color:var(--mute);text-decoration:none;padding:6px 10px;border-radius:2px;border:1px solid transparent}
.tabs a:hover{color:var(--ink);border-color:var(--rule)}.tabs a[aria-current="page"]{color:var(--ink);border-color:var(--ink)}
.status{font-family:var(--mono);font-size:12.5px;color:var(--hold);border:1px solid currentColor;padding:4px 10px;border-radius:2px}
.tabs{order:3;width:100%;margin:0 0 0 -10px}
.top .status{margin-left:auto}
@media (max-width:560px){.top .status{margin-left:0}}
.layout{display:grid;grid-template-columns:250px minmax(0,1fr);gap:48px;padding-block:40px 80px}
@media (max-width:900px){.layout{grid-template-columns:minmax(0,1fr)}.side{position:static!important;max-height:none!important}}
.side{position:sticky;top:16px;align-self:start;max-height:calc(100vh - 32px);overflow:auto;font-size:15px}
.side .lbl{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);display:block;margin-bottom:8px}
.side ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.side ul ul{padding-left:14px;margin:2px 0 6px}
.side a{color:var(--mute);text-decoration:none;display:block;padding:3px 8px;border-left:2px solid transparent}
.side a:hover{color:var(--ink)}.side a.on{color:var(--ink);border-left-color:var(--accent)}
article{min-width:0;max-width:52rem}
article h1{font-family:var(--display);font-weight:800;font-size:clamp(34px,4.6vw,52px);line-height:1.05;letter-spacing:-.015em;margin:0 0 18px}
article h2{font-family:var(--display);font-weight:750;font-size:28px;line-height:1.15;margin:48px 0 14px;padding-top:18px;border-top:1px solid var(--rule)}
article h3{font-family:var(--display);font-weight:700;font-size:20px;margin:28px 0 10px}
article p,article li{max-width:44em}
article img{display:block;border:1px solid var(--rule);border-radius:3px;background:#fff}
article blockquote{margin:18px 0;padding:14px 18px;background:var(--sheet);border:1px solid var(--hold);border-radius:2px;color:var(--ink)}
article blockquote p{margin:0}
code{font-family:var(--mono);font-size:.86em;background:var(--code);padding:1px 5px;border-radius:2px}
pre{background:var(--code);border:1px solid var(--rule);border-radius:3px;padding:14px 16px;overflow-x:auto;font-size:14px;line-height:1.5}
pre code{background:none;padding:0;font-size:inherit}
.tbl{overflow-x:auto;border:1px solid var(--rule);border-radius:3px;background:var(--sheet);margin:16px 0}
table{border-collapse:collapse;width:100%;min-width:560px;font-size:15.5px}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);font-weight:400}
tr:last-child td{border-bottom:0}
.foot{padding-block:24px 48px;border-top:1px solid var(--rule);font-size:15px;color:var(--mute);display:flex;flex-direction:column;gap:6px}
.foot p{margin:0}
'''

TOC_JS = '''<script>(function(){var links=[].slice.call(document.querySelectorAll('.side a'));var hs=links.map(function(a){return document.getElementById(decodeURIComponent(a.hash.slice(1)))}).filter(Boolean);function on(){var y=window.scrollY+120,cur=null;hs.forEach(function(h){if(h.offsetTop<=y)cur=h.id});links.forEach(function(a){a.classList.toggle('on',decodeURIComponent(a.hash.slice(1))===cur)})}window.addEventListener('scroll',on,{passive:true});on()})();</script>'''


def fix_links(md):
    md = md.replace('](testnet.md', '](/testnet').replace('](coin-agnostic.md', '](/coin-agnostic').replace('](run-a-harness.md', '](/run')
    md = md.replace('](assets/', '](/assets/')
    md = re.sub(r'\]\(\.\./([^)#]+)', lambda m: f']({GH}{m.group(1)}', md)
    md = re.sub(r'\]\(((?:dsh|simds|blog)[^)]*)', lambda m: f']({GH}docs/{m.group(1)}', md)
    return md


def doc(src, out, path, tab, desc):
    text = fix_links((REPO / 'docs' / src).read_text())
    title = re.search(r'^# (.+)$', text, re.M).group(1).strip()
    m = markdown.Markdown(extensions=['tables', 'fenced_code', 'toc'], extension_configs={'toc': {'toc_depth': '2-3'}})
    body = m.convert(text)
    body = body.replace('<table>', '<div class="tbl"><table>').replace('</table>', '</table></div>')
    page = (head(title, desc, path, DOC_CSS) + COINFREE + '\n' + header(tab)
            + f'<div class="wrap layout"><aside class="side" aria-label="On this page"><span class="lbl">On this page</span>{m.toc}</aside><article>{body}</article></div>\n'
            + FOOT + '\n' + TOC_JS + '\n</body>\n</html>\n')
    check(out, page)
    (SITE / out).write_text(page)


ECON_CSS = r"""
article.wide{max-width:none}
.lede{font-size:19px;max-width:44em}
.note{font-size:15px;color:var(--mute);max-width:52em}
.facts3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:18px 0 10px}
@media (max-width:760px){.facts3{grid-template-columns:minmax(0,1fr)}}
.fact{border-top:2px solid var(--ink);padding-top:10px}
.fact .big{font-family:var(--display);font-weight:800;font-stretch:80%;font-size:40px;line-height:1;color:var(--accent);display:block}
.fact p{font-size:15.5px;color:var(--mute);margin:8px 0 0}
.presets{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 4px}
.presets button{font-family:var(--display);font-weight:600;font-size:14.5px;padding:8px 12px;border:1px solid var(--ink);background:var(--sheet);color:var(--ink);border-radius:2px;cursor:pointer}
.presets button:hover{border-color:var(--accent);color:var(--accent)}
#share{border-style:dashed}
.calc{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:28px;margin-top:14px;align-items:start}
@media (max-width:1100px){.calc{grid-template-columns:minmax(0,1fr)}}
.inputs fieldset{border:1px solid var(--rule);border-radius:3px;background:var(--sheet);margin:0 0 14px;padding:10px 14px 12px}
.inputs legend{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);padding:0 6px}
.in{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--rule);font-size:15px}
.in:last-child{border-bottom:0}
.in .nm{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.in input[type=number]{width:120px;font-family:var(--mono);font-size:14px;padding:5px 8px;border:1px solid var(--rule);border-radius:2px;background:var(--paper);color:var(--ink)}
.in input[type=checkbox]{width:20px;height:20px;justify-self:end;accent-color:var(--accent)}
.tag{font-family:var(--mono);font-size:10.5px;padding:1px 6px;border:1px solid var(--rule);border-radius:2px;color:var(--mute);white-space:nowrap}
.tag.vr{color:var(--hold);border-color:currentColor}.tag.m{color:var(--allow);border-color:currentColor}.tag.mo{color:var(--accent);border-color:currentColor}
.outputs{background:var(--sheet);border:1px solid var(--rule);border-top:3px solid var(--accent);border-radius:3px;padding:14px 18px 18px;position:sticky;top:12px}
@media (max-width:1100px){.outputs{position:static}}
.ohead{display:flex;justify-content:space-between;align-items:baseline;margin:6px 0 4px}
.ohead .lbl{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.pill{font-family:var(--mono);font-size:12px;color:var(--accent);border:1px solid currentColor;padding:2px 8px;border-radius:2px}
.kv{display:grid;grid-template-columns:minmax(9em,1fr) minmax(0,1.4fr);gap:7px 14px;margin:6px 0 14px;font-size:15px}
.kv dt{color:var(--mute)}.kv dd{margin:0;font-family:var(--mono);font-size:14.5px;text-align:right;font-variant-numeric:tabular-nums}
.bar{display:flex;height:16px;border:1px solid var(--rule);border-radius:2px;overflow:hidden;margin:4px 0 8px}
.bar span{display:block;height:100%}
.legend{list-style:none;padding:0;margin:0 0 12px;display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13.5px;color:var(--mute)}
.legend i{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:1px}
.warn{color:var(--hold);border:1px solid currentColor;padding:8px 10px;border-radius:2px;font-size:14.5px}
.steps{display:flex;flex-direction:column;gap:10px}
.callout{background:var(--sheet);border:1px solid var(--rule);border-left:3px solid var(--accent);border-radius:2px;padding:12px 16px;margin:16px 0;max-width:52em}
td.v{font-family:var(--mono);font-size:14px;white-space:nowrap;font-variant-numeric:tabular-nums}
td.k{color:var(--mute)}
td.neg{color:var(--deny,#B3263A)}td.pos{color:var(--allow)}
.chart{background:var(--sheet);border:1px solid var(--rule);border-radius:3px;padding:8px;overflow-x:auto}
.chart svg{display:block;width:100%;min-width:560px;height:auto}
.figure{background:var(--sheet);border:1px solid var(--rule);border-radius:3px;overflow-x:auto;margin:16px 0}
.figure svg{display:block;width:100%;min-width:640px;height:auto}
article section{scroll-margin-top:16px}
"""

ECON_MENU = [('overview', 'The short version'), ('calculator', 'Calculator'), ('packing', 'Proof packing'),
             ('machine', 'The proving machine'), ('earnings', 'Who earns what'), ('sources', 'Assumptions and sources')]


def economics():
    lib = (REPO / 'packages' / 'economics' / 'src' / 'index.js').read_text()
    lib = re.sub(r'^export ', '', lib, flags=re.M)
    js = lib + '\n' + (SRC / 'economics.js').read_text()
    menu = '<ul>' + ''.join(f'<li><a href="#{a}">{t}</a></li>' for a, t in ECON_MENU) + '</ul>'
    body = (SRC / 'economics.html').read_text()
    page = (head('Economics and proof packing', 'What it costs to prove AI rulings, how proof packing cuts it, and what proving operators and verifiers earn. Modeled, with every source named.', '/economics', DOC_CSS + ECON_CSS)
            + COINFREE + '\n' + header('Economics')
            + f'<div class="wrap layout"><aside class="side" aria-label="On this page"><span class="lbl">Economics</span>{menu}</aside><article class="wide">{body}</article></div>\n'
            + FOOT + '\n' + TOC_JS.replace("hs.forEach(function(h){if(h.offsetTop<=y)cur=h.id})", "hs.forEach(function(h){if(h.offsetTop<=y)cur=h.id})") + f'\n<script>\n{js}\n</script>\n</body>\n</html>\n')
    check('economics.html', page)
    (SITE / 'economics.html').write_text(page)


if __name__ == '__main__':
    landing()
    economics()
    doc('run-a-harness.md', 'run.html', '/run', 'Run a harness',
        'How to run a Verafy Harness: machine requirements, models, how a model is proven, install, configure, costs and earnings.')
    doc('testnet.md', 'testnet.html', '/testnet', 'Testnet',
        'The Verafy Chain local devnet you can run now, and the plan for Testnet 0.')
    doc('coin-agnostic.md', 'coin-agnostic.html', '/coin-agnostic', 'Coin Agnostic',
        'Why there is no coin, what the money pays for, and how the Verafy Harness routing agent moves it.')
    print('built', ', '.join(p.name for p in sorted(SITE.glob('*.html'))))
